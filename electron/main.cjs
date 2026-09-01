/**
 * main.js — Electron main process.
 *
 * Owns the window, the native menu bar, and all filesystem access. The
 * renderer never touches disk directly; it asks through the narrow preload
 * bridge, which keeps context isolation on.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { enqueueAtomicWrite } = require('./atomic-write.cjs');
const { createFileAccess } = require('./file-access.cjs');
const { isAllowedExternalUrl } = require('./navigation-policy.cjs');
const { openPathFromArguments } = require('./open-path.cjs');

// Scriptum is an offline application. Disable Chromium background services
// before the browser process starts; a session-level request guard below is
// the second, enforceable boundary.
app.commandLine.appendSwitch('disable-background-networking');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const isDev = process.argv.includes('--dev');
const MAX_IMPORT_BYTES = 96 * 1024 * 1024;
const MAX_WRITE_BYTES = 128 * 1024 * 1024;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let pendingOpenPath = null; // a file double-clicked before the window existed
let rendererReady = false;
const fileAccess = createFileAccess();
let pdfPrintInFlight = false;
let pendingFileWrites = 0;

/**
 * Quit bookkeeping.
 *
 * `quitting` records that the user asked to quit, because vetoing the window
 * close in order to ask about unsaved work also cancels the quit itself.
 *
 * `dialogDepth` counts modal prompts currently on screen, so the failsafe
 * below never fires while someone is deciding whether to save.
 */
let quitting = false;
let dialogDepth = 0;
let closeFailsafe = null;

/**
 * If the renderer is wedged it will never answer `app:request-close`, and the
 * vetoed close would leave a window that cannot be shut. After a short grace
 * period, close it anyway — an application the user cannot quit is worse than
 * one that closes without a prompt.
 */
function armCloseFailsafe() {
  clearTimeout(closeFailsafe);
  closeFailsafe = setTimeout(() => {
    if (dialogDepth > 0 || pendingFileWrites > 0) {
      armCloseFailsafe(); // a prompt or durable file write is still in progress
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.warn('Renderer did not respond to the close request; closing anyway.');
      mainWindow.__forceClose = true;
      mainWindow.close();
    }
    if (quitting) app.quit();
  }, 4000);
}

function cancelCloseFailsafe() {
  clearTimeout(closeFailsafe);
  closeFailsafe = null;
}

/** Wrap a modal prompt so the failsafe knows to hold off. */
async function withDialog(fn) {
  dialogDepth += 1;
  try {
    return await fn();
  } finally {
    dialogDepth -= 1;
  }
}

async function withFileWrite(fn) {
  pendingFileWrites += 1;
  try {
    return await fn();
  } finally {
    pendingFileWrites -= 1;
  }
}

async function readLimitedUtf8(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('The selected path is not a regular file.');
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new Error('That file is too large for Scriptum to open safely (96 MiB maximum).');
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function checkedText(data) {
  if (typeof data !== 'string') throw new Error('Refused non-text document data.');
  if (Buffer.byteLength(data, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error('That document is too large for Scriptum to save safely.');
  }
  return data;
}

function checkedBytes(data) {
  const bytes = Buffer.from(data);
  if (bytes.byteLength > MAX_WRITE_BYTES) {
    throw new Error('That export is too large for Scriptum to save safely.');
  }
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Custom protocol so ES modules load without a bundler
 * ------------------------------------------------------------------ */

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function registerProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // Everything is served from src/, and traversal outside it is refused.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(SRC, rel);
    // The separator matters: a bare prefix test would also accept a sibling
    // directory whose name merely starts with "src".
    if (target !== SRC && !target.startsWith(SRC + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function openAllowedExternal(candidate) {
  if (isAllowedExternalUrl(candidate)) void shell.openExternal(candidate);
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    backgroundColor: '#d7dade',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // macOS uses its on-device spellchecker. Electron downloads Hunspell
      // dictionaries on Windows/Linux, so keep it off there for zero network.
      spellcheck: process.platform === 'darwin',
    },
  });
  rendererReady = false;

  // No page inside Scriptum may make an HTTP(S) request. This blocks data
  // exfiltration even if future UI code accidentally introduces a fetch or a
  // user-controlled CSS URL. Approved help links open outside the app.
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true })
  );

  mainWindow.loadURL('app://scriptum/index.html');

  // Surface renderer problems on the terminal in dev, so a blank window is
  // never a silent mystery.
  if (isDev) {
    const LEVELS = ['debug', 'info', 'warning', 'error'];
    mainWindow.webContents.on('console-message', (e) => {
      const level = LEVELS[e.level] ?? e.level;
      console.log(`[renderer:${level}] ${e.message}`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[load-failed] ${code} ${desc} — ${url}`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      console.error('[renderer-gone]', details)
    );
  }

  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true;
    if (pendingOpenPath) {
      const candidate = pendingOpenPath;
      pendingOpenPath = null;
      sendOpenPath(candidate);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('close', (e) => {
    if (mainWindow.__forceClose) return;

    // Ask the renderer whether there is unsaved work. Cancelling the close
    // here also cancels an in-progress Quit, which is why `quitting` is
    // remembered: once the renderer approves, the quit has to be restarted
    // explicitly or the application would simply never exit.
    e.preventDefault();
    send('app:request-close');
    armCloseFailsafe();
  });

  mainWindow.on('closed', () => {
    rendererReady = false;
    mainWindow = null;
  });

  // Open external links in the user's browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url);
    return { action: 'deny' };
  });

  // Never navigate this privileged renderer away from the packaged app. If an
  // external page inherited the preload bridge it could otherwise ask the
  // main process to access local files.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try {
      const target = new URL(url);
      allowed = target.protocol === 'app:' && target.host === 'scriptum';
    } catch {
      /* malformed URLs are refused */
    }
    if (!allowed) {
      event.preventDefault();
      openAllowedExternal(url);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendOpenPath(candidate) {
  const filePath = fileAccess.grant(candidate, {
    read: true,
    write: path.extname(candidate).toLowerCase() === '.scriptum',
  });
  send('menu:open-path', filePath);
}

function queueOpenPath(candidate) {
  const filePath = openPathFromArguments([candidate]);
  if (!filePath) return false;
  if (mainWindow && rendererReady) sendOpenPath(filePath);
  else pendingOpenPath = filePath;
  return true;
}

function requireTrustedSender(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Refused an IPC request from an unknown renderer.');
  }
}

function requireFileGrant(candidate, mode) {
  const allowed = mode === 'write' ? fileAccess.canWrite(candidate) : fileAccess.canRead(candidate);
  if (!allowed) throw new Error(`File ${mode} was not authorized by the user.`);
  return path.resolve(candidate);
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

const cmd = (label, accelerator, channel, extra = {}) => ({
  label,
  accelerator,
  click: () => send(channel),
  ...extra,
});

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              cmd('Preferences…', 'CmdOrCtrl+,', 'menu:preferences'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd('New', 'CmdOrCtrl+N', 'menu:new'),
        cmd('Open…', 'CmdOrCtrl+O', 'menu:open'),
        { type: 'separator' },
        cmd('Save', 'CmdOrCtrl+S', 'menu:save'),
        cmd('Save As…', 'CmdOrCtrl+Shift+S', 'menu:save-as'),
        { type: 'separator' },
        {
          label: 'Import',
          submenu: [
            cmd('Final Draft (.fdx)…', null, 'menu:import-fdx'),
            cmd('Fountain (.fountain)…', null, 'menu:import-fountain'),
            cmd('Plain Text…', null, 'menu:import-text'),
          ],
        },
        {
          label: 'Export',
          submenu: [
            cmd('PDF…', 'CmdOrCtrl+P', 'menu:export-pdf'),
            cmd('Final Draft (.fdx)…', null, 'menu:export-fdx'),
            cmd('Fountain (.fountain)…', null, 'menu:export-fountain'),
            cmd('Plain Text…', null, 'menu:export-text'),
          ],
        },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'CmdOrCtrl+Z', 'menu:undo'),
        cmd('Redo', 'CmdOrCtrl+Shift+Z', 'menu:redo'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle', label: 'Paste as Plain Text' },
        { role: 'selectAll' },
        { type: 'separator' },
        cmd('Find & Replace…', 'CmdOrCtrl+F', 'menu:find'),
        cmd('Find Next', 'CmdOrCtrl+G', 'menu:find-next'),
        cmd('Find Previous', 'CmdOrCtrl+Shift+G', 'menu:find-prev'),
        { type: 'separator' },
        cmd('Go to Scene…', 'CmdOrCtrl+J', 'menu:goto-scene'),
        { type: 'separator' },
        ...(isMac ? [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] : []),
      ],
    },
    {
      label: 'Format',
      submenu: [
        cmd('Scene Heading', 'CmdOrCtrl+1', 'menu:type-scene_heading'),
        cmd('Action', 'CmdOrCtrl+2', 'menu:type-action'),
        cmd('Character', 'CmdOrCtrl+3', 'menu:type-character'),
        cmd('Parenthetical', 'CmdOrCtrl+4', 'menu:type-parenthetical'),
        cmd('Dialogue', 'CmdOrCtrl+5', 'menu:type-dialogue'),
        cmd('Transition', 'CmdOrCtrl+6', 'menu:type-transition'),
        cmd('Shot', 'CmdOrCtrl+7', 'menu:type-shot'),
        cmd('General', 'CmdOrCtrl+8', 'menu:type-general'),
        cmd('Act Break', 'CmdOrCtrl+9', 'menu:type-act_break'),
        { type: 'separator' },
        cmd('Bold', 'CmdOrCtrl+B', 'menu:bold'),
        cmd('Italic', 'CmdOrCtrl+I', 'menu:italic'),
        cmd('Underline', 'CmdOrCtrl+U', 'menu:underline'),
        { type: 'separator' },
        cmd('Dual Dialogue', 'CmdOrCtrl+Alt+D', 'menu:dual'),
        cmd('Add Alternate Dialogue', 'CmdOrCtrl+Alt+L', 'menu:add-alternate'),
        cmd('Previous Alternate Dialogue', 'CmdOrCtrl+Alt+Left', 'menu:previous-alternate'),
        cmd('Next Alternate Dialogue', 'CmdOrCtrl+Alt+Right', 'menu:next-alternate'),
        cmd('Remove Alternate Dialogue', 'CmdOrCtrl+Alt+Backspace', 'menu:remove-alternate'),
        cmd('Format Assistant…', null, 'menu:format-assistant'),
        cmd('Element Settings…', null, 'menu:element-settings'),
        cmd('Page Setup…', null, 'menu:page-setup'),
      ],
    },
    {
      label: 'Production',
      submenu: [
        cmd('Scene Numbers…', null, 'menu:scene-numbers'),
        cmd('Lock Scene Numbers', null, 'menu:lock-scenes'),
        { type: 'separator' },
        cmd('Revisions…', null, 'menu:revisions'),
        cmd('Revision Room…', 'CmdOrCtrl+Alt+R', 'menu:revision-room'),
        cmd('Lock Pages', null, 'menu:lock-pages'),
        cmd('Unlock Pages', null, 'menu:unlock-pages'),
        { type: 'separator' },
        cmd('Mark Scene Omitted', null, 'menu:omit-scene'),
        cmd('Tag Selection…', 'CmdOrCtrl+Alt+T', 'menu:production-tag'),
        cmd('Toggle Production Tags', null, 'menu:toggle-production-tags'),
        cmd('Title Page…', null, 'menu:title-page'),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Toggle Sidebar', 'CmdOrCtrl+\\', 'menu:toggle-sidebar'),
        cmd('Index Cards', 'CmdOrCtrl+Shift+B', 'menu:cards'),
        cmd('Story Timeline', 'CmdOrCtrl+Shift+T', 'menu:timeline'),
        cmd('Focus Mode', 'CmdOrCtrl+Shift+F', 'menu:focus'),
        cmd('Writing Sprint…', 'CmdOrCtrl+Shift+K', 'menu:sprint'),
        cmd('Pause / Resume Sprint', 'CmdOrCtrl+Shift+Space', 'menu:sprint-pause'),
        cmd('End Sprint', 'CmdOrCtrl+Shift+E', 'menu:sprint-end'),
        cmd('Table Read…', 'CmdOrCtrl+Shift+Y', 'menu:table-read'),
        cmd('Reports…', 'CmdOrCtrl+R', 'menu:reports'),
        { type: 'separator' },
        cmd('Zoom In', 'CmdOrCtrl+Plus', 'menu:zoom-in'),
        cmd('Zoom Out', 'CmdOrCtrl+-', 'menu:zoom-out'),
        cmd('Actual Size', 'CmdOrCtrl+0', 'menu:zoom-reset'),
        { type: 'separator' },
        cmd('Toggle Dark Mode', null, 'menu:toggle-theme'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [])],
    },
    {
      role: 'help',
      submenu: [
        ...(!isMac ? [{ role: 'about' }, { type: 'separator' }] : []),
        cmd('Keyboard Shortcuts', null, 'menu:shortcuts'),
        cmd('Privacy & Local Data', null, 'menu:privacy'),
        {
          label: 'Fountain Syntax Reference',
          click: () => openAllowedExternal('https://fountain.io/syntax'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ *
 * IPC — filesystem
 * ------------------------------------------------------------------ */

const FILTERS = {
  scriptum: { name: 'Scriptum Screenplay', extensions: ['scriptum'] },
  fdx: { name: 'Final Draft', extensions: ['fdx'] },
  fountain: { name: 'Fountain', extensions: ['fountain', 'spmd'] },
  text: { name: 'Plain Text', extensions: ['txt'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
  csv: { name: 'CSV', extensions: ['csv'] },
};

ipcMain.handle('dialog:open', async (event, kinds = ['scriptum', 'fdx', 'fountain']) =>
  withDialog(async () => {
    requireTrustedSender(event);
    const filters = kinds.map((k) => FILTERS[k]).filter(Boolean);
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Screenplays', extensions: [...new Set(filters.flatMap((f) => f.extensions))] },
        ...filters,
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const selected = res.filePaths[0];
    const filePath = fileAccess.grant(selected, {
      read: true,
      write: path.extname(selected).toLowerCase() === '.scriptum',
    });
    const data = await readLimitedUtf8(filePath);
    return { path: filePath, data };
  })
);

ipcMain.handle('dialog:save', async (event, { defaultName, kind = 'scriptum' }) =>
  withDialog(async () => {
    requireTrustedSender(event);
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [FILTERS[kind] || FILTERS.scriptum],
    });
    return res.canceled ? null : fileAccess.grant(res.filePath, { write: true });
  })
);

ipcMain.handle('file:read', async (event, filePath) => {
  requireTrustedSender(event);
  return readLimitedUtf8(requireFileGrant(filePath, 'read'));
});

ipcMain.handle('file:write', async (event, { path: filePath, data }) => {
  requireTrustedSender(event);
  const target = requireFileGrant(filePath, 'write');
  await withFileWrite(() => enqueueAtomicWrite(target, checkedText(data), { encoding: 'utf8' }));
  return true;
});

ipcMain.handle('file:write-binary', async (event, { path: filePath, data }) => {
  requireTrustedSender(event);
  const target = requireFileGrant(filePath, 'write');
  await withFileWrite(() => enqueueAtomicWrite(target, checkedBytes(data)));
  return true;
});

ipcMain.handle('recovery:read', async (event) => {
  requireTrustedSender(event);
  const recoveryPath = path.join(app.getPath('userData'), 'recovery.json');
  try {
    return await readLimitedUtf8(recoveryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('recovery:write', async (event, data) => {
  requireTrustedSender(event);
  const recoveryPath = path.join(app.getPath('userData'), 'recovery.json');
  await withFileWrite(() =>
    enqueueAtomicWrite(recoveryPath, checkedText(data), { encoding: 'utf8' })
  );
  return true;
});

ipcMain.handle('recovery:clear', async (event) => {
  requireTrustedSender(event);
  const recoveryPath = path.join(app.getPath('userData'), 'recovery.json');
  await fs.unlink(recoveryPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return true;
});

ipcMain.handle('document:print-pdf', async (event, { width, height } = {}) => {
  requireTrustedSender(event);
  const paperWidth = Number(width);
  const paperHeight = Number(height);
  if (
    !Number.isFinite(paperWidth) || !Number.isFinite(paperHeight) ||
    paperWidth < 4 || paperWidth > 20 || paperHeight < 4 || paperHeight > 20
  ) {
    throw new Error('Refused invalid PDF page dimensions.');
  }
  if (pdfPrintInFlight) throw new Error('A PDF export is already in progress.');

  pdfPrintInFlight = true;
  try {
    // Chromium shapes Unicode using local system fonts and embeds the glyphs
    // it uses. No document text or font request leaves this WebContents.
    return await event.sender.printToPDF({
      pageSize: { width: paperWidth, height: paperHeight },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      printBackground: true,
      generateTaggedPDF: true,
    });
  } finally {
    pdfPrintInFlight = false;
  }
});

ipcMain.handle('shell:show', async (event, filePath) => {
  requireTrustedSender(event);
  const granted = fileAccess.canWrite(filePath)
    ? requireFileGrant(filePath, 'write')
    : requireFileGrant(filePath, 'read');
  shell.showItemInFolder(granted);
});

ipcMain.handle('dialog:confirm', async (event, { message, detail, buttons, defaultId = 0 }) =>
  withDialog(async () => {
    requireTrustedSender(event);
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      message,
      detail,
      buttons,
      defaultId,
      cancelId: buttons.length - 1,
    });
    return res.response;
  })
);

ipcMain.handle('dialog:error', async (event, { message, detail }) =>
  withDialog(() => {
    requireTrustedSender(event);
    return dialog.showMessageBox(mainWindow, { type: 'error', message, detail, buttons: ['OK'] });
  })
);

ipcMain.handle('window:set-title', (event, { title, edited }) => {
  requireTrustedSender(event);
  if (!mainWindow) return;
  mainWindow.setTitle(typeof title === 'string' ? title.slice(0, 256) : 'Untitled');
  if (process.platform === 'darwin') mainWindow.setDocumentEdited(!!edited);
});

/**
 * The renderer's verdict on a close request.
 *
 * `confirmed: false` means the user cancelled, so the pending quit — if any —
 * has to be forgotten too, otherwise the next window close would quit the
 * application without asking.
 */
ipcMain.handle('window:close', (event, { confirmed = true } = {}) => {
  requireTrustedSender(event);
  cancelCloseFailsafe();

  if (!confirmed) {
    quitting = false;
    return false;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.__forceClose = true;
    mainWindow.close();
  }

  // Vetoing the close cancelled the original quit, so restart it here.
  if (quitting) app.quit();
  return true;
});

/* ------------------------------------------------------------------ *
 * App lifecycle
 * ------------------------------------------------------------------ */

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  registerProtocol();
  buildMenu();
  pendingOpenPath ||= openPathFromArguments(process.argv.slice(1));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', (_event, argv) => {
  queueOpenPath(openPathFromArguments(argv));
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Remember that a quit is in flight before any window veto can cancel it.
app.on('before-quit', () => {
  quitting = true;
});

// Test hook. `SCRIPTUM_TEST_QUIT=<ms> npm start` quits after the given delay
// through exactly the path Cmd+Q takes, so the shutdown sequence can be
// exercised in CI without synthesising keystrokes — which on macOS would mean
// granting broad accessibility permissions just to press one key.
if (process.env.SCRIPTUM_TEST_QUIT) {
  app.whenReady().then(() => {
    setTimeout(() => app.quit(), Number(process.env.SCRIPTUM_TEST_QUIT) || 3000);
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenPath(filePath);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
