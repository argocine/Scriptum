/**
 * app.js — Application shell: wiring, file commands, and the surrounding UI.
 *
 * Runs under Electron via the `window.scriptum` bridge, and degrades to a
 * browser-only mode (download links instead of native save dialogs) so the
 * same code can be opened directly for testing.
 */

import { ElementType, ELEMENT_ORDER, ELEMENT_LABEL } from './core/format.js';
import { createDocument, createElement, getScenes, getElement, indexOfElement } from './core/model.js';
import { estimateRuntime } from './core/paginate.js';
import { ScriptEditor, inferElements } from './ui/editor.js';
import { CardBoard } from './features/cards.js';
import { Finder } from './features/find.js';
import { parseFountain, toFountain } from './io/fountain.js';
import { parseFDX, toFDX } from './io/fdx.js';
import { exportPDF } from './io/pdf.js';
import { pdfSupportIssues } from './features/format-assistant.js';
import {
  serializeProject,
  parseProject,
  toPlainText,
  writeAutosave,
  readAutosave,
  clearAutosave,
} from './io/project.js';
import {
  titlePageDialog,
  elementSettingsDialog,
  pageSetupDialog,
  sceneNumbersDialog,
  revisionsDialog,
  reportsDialog,
  formatAssistantDialog,
  notesDialog,
  gotoSceneDialog,
  pageLockDialog,
  lockScenesAction,
  shortcutsDialog,
  openDialog,
  h,
} from './ui/dialogs.js';

/* ------------------------------------------------------------------ *
 * Platform bridge
 * ------------------------------------------------------------------ */

const native = window.scriptum || null;

const platform = {
  isNative: !!native,

  async open(kinds) {
    if (native) return native.openDialog(kinds);
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.scriptum,.fdx,.fountain,.txt,.spmd';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        resolve({ path: file.name, data: await file.text() });
      };
      input.click();
    });
  },

  async save(text, { defaultName, kind }) {
    if (native) {
      const path = await native.saveDialog({ defaultName, kind });
      if (!path) return null;
      await native.writeFile(path, text);
      return path;
    }
    downloadBlob(new Blob([text], { type: 'text/plain' }), defaultName);
    return defaultName;
  },

  async saveBinary(bytes, { defaultName, kind }) {
    if (native) {
      const path = await native.saveDialog({ defaultName, kind });
      if (!path) return null;
      await native.writeBinary(path, bytes);
      return path;
    }
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), defaultName);
    return defaultName;
  },

  async writeTo(path, text) {
    if (native) return native.writeFile(path, text);
    downloadBlob(new Blob([text], { type: 'text/plain' }), path);
    return true;
  },

  async confirm(opts) {
    if (native) return native.confirm(opts);
    return window.confirm(`${opts.message}\n\n${opts.detail || ''}`) ? 0 : opts.buttons.length - 1;
  },

  async error({ message, detail }) {
    if (native) return native.error({ message, detail });
    window.alert(`${message}\n\n${detail || ''}`);
    return undefined;
  },

  setTitle(title, edited) {
    document.getElementById('doc-title').textContent = title;
    document.getElementById('doc-dirty').textContent = edited ? '— Edited' : '';
    native?.setTitle(`${title}${edited ? ' — Edited' : ''}`, edited);
  },

  onMenu(channel, handler) {
    native?.onMenu(channel, handler);
  },
};

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const dom = {
  pages: document.getElementById('pages'),
  scroll: document.getElementById('script-scroll'),
  autocomplete: document.getElementById('autocomplete'),
  elementSelect: document.getElementById('element-select'),
  sidebar: document.getElementById('sidebar'),
  paneScenes: document.getElementById('pane-scenes'),
  paneCharacters: document.getElementById('pane-characters'),
  paneNotes: document.getElementById('pane-notes'),
  cardsView: document.getElementById('cards-view'),
  cardGrid: document.getElementById('card-grid'),
  findbar: document.getElementById('findbar'),
  toast: document.getElementById('toast'),
  stPage: document.getElementById('st-page'),
  stScene: document.getElementById('st-scene'),
  stRuntime: document.getElementById('st-runtime'),
  stWords: document.getElementById('st-words'),
  stElement: document.getElementById('st-element'),
  zoom: document.getElementById('zoom-range'),
  zoomLabel: document.getElementById('zoom-label'),
};

const state = {
  filePath: null,
  dirty: false,
  savedSnapshot: '',
  zoom: 100,
  theme: storedTheme(),
  cardsOpen: false,
  recoveryEnabled: true,
};

const editor = new ScriptEditor({
  container: dom.pages,
  scroller: dom.scroll,
  autocompleteEl: dom.autocomplete,
  onUpdate: (ed, extra) => onEditorUpdate(ed, extra),
});

const finder = new Finder(editor);
const board = new CardBoard(dom.cardGrid, editor, { onJumpToScene: jumpToScene });

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  applyTheme(state.theme);
  buildElementSelect();
  wireToolbar();
  wireSidebar();
  wireFindBar();
  wireMenus();
  wireZoom();

  const recovered = readAutosave();
  if (recovered?.document && recovered.at > Date.now() - 1000 * 60 * 60 * 24 * 14) {
    offerRecovery(recovered);
  } else {
    if (recovered) clearAutosave();
    editor.load(sampleDocument());
    markClean();
  }

  setInterval(() => {
    if (state.dirty && state.recoveryEnabled) writeAutosave(editor.doc, state.filePath);
  }, 20000);

  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    if (state.recoveryEnabled) writeAutosave(editor.doc, state.filePath);

    // Only the browser build may veto here. Electron treats a cancelled
    // beforeunload as a silent, absolute refusal to close — there is no
    // "leave site?" prompt to answer — so vetoing would make the window
    // impossible to shut and the application impossible to quit. Under
    // Electron the native close flow has already asked about unsaved work.
    if (platform.isNative) return;

    e.preventDefault();
    e.returnValue = '';
  });
}

async function offerRecovery(recovered) {
  editor.load(sampleDocument());
  markClean();
  const when = new Date(recovered.at).toLocaleString();
  const choice = await platform.confirm({
    message: 'Recover unsaved work?',
    detail: `Scriptum has an autosave from ${when}${
      recovered.filePath ? ` of ${recovered.filePath}` : ''
    }. Would you like to restore it?`,
    buttons: ['Recover', 'Discard'],
  });
  if (choice === 0) {
    editor.load(recovered.document);
    state.filePath = recovered.filePath;
    markDirty();
    toast('Recovered your last autosave.');
  } else {
    clearAutosave();
  }
}

/* ------------------------------------------------------------------ *
 * UI wiring
 * ------------------------------------------------------------------ */

function buildElementSelect() {
  dom.elementSelect.innerHTML = '';
  ELEMENT_ORDER.forEach((type, i) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = `${ELEMENT_LABEL[type]}   ⌘${i + 1}`;
    dom.elementSelect.appendChild(opt);
  });
  dom.elementSelect.addEventListener('change', () => {
    editor.setElementType(dom.elementSelect.value);
    dom.pages.focus();
  });
}

function wireToolbar() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

  on('tb-sidebar', toggleSidebar);
  on('tb-bold', () => editor.toggleStyle('bold'));
  on('tb-italic', () => editor.toggleStyle('italic'));
  on('tb-underline', () => editor.toggleStyle('underline'));
  on('tb-dual', toggleDualDialogue);
  on('tb-note', () => {
    const el = editor.currentElement();
    if (el) notesDialog(editor, el.id);
  });
  on('tb-omit', omitScene);
  on('tb-cards', toggleCards);
  on('tb-find', openFind);
  on('tb-revision', () => revisionsDialog(editor, toast));
  on('tb-format-assistant', openFormatAssistant);
  on('tb-reports', openReports);
  on('tb-title', () => titlePageDialog(editor));
  on('tb-privacy', privacyDialog);
  on('tb-pdf', exportPdf);
}

function wireSidebar() {
  const tabs = [...document.querySelectorAll('.side-tab')];
  const activate = (tab, focus = false, refresh = true) => {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.classList.toggle('active', selected);
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const pane = document.getElementById(`pane-${t.dataset.pane}`);
      pane.classList.toggle('active', selected);
      pane.hidden = !selected;
    });
    if (focus) tab.focus();
    if (refresh) refreshSidebar();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        activate(next, true);
      }
    });
  });
  // Boot has not loaded a document or pagination yet; only establish the tab
  // semantics here. The first markClean() call populates the active pane.
  activate(tabs.find((tab) => tab.classList.contains('active')) || tabs[0], false, false);
}

function wireZoom() {
  dom.zoom.addEventListener('input', () => setZoom(Number(dom.zoom.value)));
}

function setZoom(pct) {
  state.zoom = Math.max(40, Math.min(220, pct));
  dom.zoom.value = String(state.zoom);
  dom.zoomLabel.textContent = `${state.zoom}%`;
  dom.pages.style.transform = `scale(${state.zoom / 100})`;
  dom.pages.style.marginBottom = `${(state.zoom / 100 - 1) * 200}px`;
}

function wireFindBar() {
  const input = document.getElementById('find-input');
  const replace = document.getElementById('replace-input');
  const count = document.getElementById('find-count');
  const caseBox = document.getElementById('find-case');

  const run = () => {
    finder.search(input.value, { caseSensitive: caseBox.checked });
    count.textContent = finder.label();
  };

  input.addEventListener('input', () => {
    run();
    if (finder.matches.length) finder.seekFromCaret();
    count.textContent = finder.label();
  });
  caseBox.addEventListener('change', run);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finder.step(e.shiftKey ? -1 : 1);
      count.textContent = finder.label();
    } else if (e.key === 'Escape') {
      closeFind();
    }
  });

  document.getElementById('find-next').addEventListener('click', () => {
    finder.step(1);
    count.textContent = finder.label();
  });
  document.getElementById('find-prev').addEventListener('click', () => {
    finder.step(-1);
    count.textContent = finder.label();
  });
  document.getElementById('find-close').addEventListener('click', closeFind);
  document.getElementById('find-replace').addEventListener('click', () => {
    finder.replaceCurrent(replace.value);
    count.textContent = finder.label();
    markDirty();
  });
  document.getElementById('find-replace-all').addEventListener('click', () => {
    const n = finder.replaceAll(replace.value);
    count.textContent = finder.label();
    toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'}.`);
    markDirty();
  });
}

function openFind() {
  dom.findbar.classList.add('open');
  const input = document.getElementById('find-input');
  input.focus();
  input.select();
}

function closeFind() {
  dom.findbar.classList.remove('open');
  dom.pages.focus();
}

/* ------------------------------------------------------------------ *
 * Menu commands
 * ------------------------------------------------------------------ */

function wireMenus() {
  const m = platform.onMenu;

  m('menu:new', newDocument);
  m('menu:open', () => openFile());
  m('menu:open-path', (path) => openPath(path));
  m('menu:save', () => saveFile(false));
  m('menu:save-as', () => saveFile(true));

  m('menu:import-fdx', () => openFile(['fdx']));
  m('menu:import-fountain', () => openFile(['fountain']));
  m('menu:import-text', () => openFile(['text']));

  m('menu:export-pdf', exportPdf);
  m('menu:export-fdx', () => exportText(toFDX(editor.doc), 'fdx'));
  m('menu:export-fountain', () => exportText(toFountain(editor.doc), 'fountain'));
  m('menu:export-text', () =>
    exportText(toPlainText(editor.doc, editor.pagination, editor.styles), 'text'));

  m('menu:undo', () => editor.undo());
  m('menu:redo', () => editor.redo());

  m('menu:find', openFind);
  m('menu:find-next', () => finder.step(1));
  m('menu:find-prev', () => finder.step(-1));
  m('menu:goto-scene', () => gotoSceneDialog(editor, jumpToScene));

  m('menu:bold', () => editor.toggleStyle('bold'));
  m('menu:italic', () => editor.toggleStyle('italic'));
  m('menu:underline', () => editor.toggleStyle('underline'));
  m('menu:dual', toggleDualDialogue);

  for (const type of ELEMENT_ORDER) {
    m(`menu:type-${type}`, () => editor.setElementType(type));
  }

  m('menu:element-settings', () => elementSettingsDialog(editor));
  m('menu:page-setup', () => pageSetupDialog(editor));
  m('menu:format-assistant', openFormatAssistant);
  m('menu:scene-numbers', () => sceneNumbersDialog(editor));
  m('menu:lock-scenes', () => lockScenesAction(editor, toast));
  m('menu:revisions', () => revisionsDialog(editor, toast));
  m('menu:lock-pages', () => pageLockDialog(editor, true, toast));
  m('menu:unlock-pages', () => pageLockDialog(editor, false, toast));
  m('menu:omit-scene', omitScene);
  m('menu:title-page', () => titlePageDialog(editor));

  m('menu:toggle-sidebar', toggleSidebar);
  m('menu:cards', toggleCards);
  m('menu:reports', openReports);
  m('menu:zoom-in', () => setZoom(state.zoom + 10));
  m('menu:zoom-out', () => setZoom(state.zoom - 10));
  m('menu:zoom-reset', () => setZoom(100));
  m('menu:toggle-theme', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  m('menu:preferences', () => pageSetupDialog(editor));
  m('menu:shortcuts', shortcutsDialog);
  m('menu:privacy', privacyDialog);
  m('app:request-close', requestClose);

  // Shortcuts that must also work without the native menu (browser mode).
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    const map = {
      s: () => saveFile(e.shiftKey),
      o: () => openFile(),
      p: exportPdf,
      f: openFind,
      j: () => gotoSceneDialog(editor, jumpToScene),
      r: openReports,
      '\\': toggleSidebar,
    };
    if (k === 'b' && e.shiftKey) {
      e.preventDefault();
      toggleCards();
      return;
    }
    if (map[k] && !(k === 'b' || k === 'i' || k === 'u')) {
      e.preventDefault();
      map[k]();
    }
  });
}

function privacyDialog() {
  const recovery = platform.isNative
    ? 'Crash recovery is stored only on this computer and is removed after a clean save, discard, or quit.'
    : 'Crash recovery is stored only in this browser tab. Closing the tab ends that recovery session.';
  const body = h(
    'div',
    {},
    h('p', {}, 'Scriptum has no accounts, analytics, advertising, telemetry, cloud sync, or crash reporting.'),
    h('p', {}, 'Your screenplay is read only when you choose a file and written only to a destination you choose.'),
    h('p', {}, recovery),
    h('p', { class: 'hint' }, 'The hosted browser version is delivered by GitHub Pages, whose normal web-server privacy terms apply.')
  );
  openDialog({
    title: 'Privacy & Local Data',
    body,
    buttons: [
      {
        label: 'Clear & Disable Recovery',
        onClick: () => {
          state.recoveryEnabled = false;
          clearAutosave();
          toast('Recovery cleared and disabled until restart.');
        },
      },
      { label: 'Close', primary: true },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * File commands
 * ------------------------------------------------------------------ */

async function confirmDiscard() {
  if (!state.dirty) return true;
  const choice = await platform.confirm({
    message: 'Save changes before continuing?',
    detail: 'Your screenplay has unsaved changes.',
    buttons: ['Save', "Don't Save", 'Cancel'],
  });
  if (choice === 2) return false;
  if (choice === 0) return !!(await saveFile(false));
  return true;
}

async function newDocument() {
  if (!(await confirmDiscard())) return;
  editor.load(createDocument());
  state.filePath = null;
  clearAutosave();
  markClean();
  toast('New screenplay.');
}

async function openFile(kinds) {
  if (!(await confirmDiscard())) return;
  const picked = await platform.open(kinds);
  if (!picked) return;
  loadFromText(picked.path, picked.data);
}

async function openPath(path) {
  if (!native) return;
  if (!(await confirmDiscard())) return;
  try {
    const data = await native.readFile(path);
    loadFromText(path, data);
  } catch (err) {
    platform.error({ message: 'Could not open that file.', detail: String(err.message || err) });
  }
}

function loadFromText(path, data) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  try {
    let doc;
    if (ext === 'fdx') doc = parseFDX(data);
    else if (ext === 'fountain' || ext === 'spmd') doc = parseFountain(data);
    else if (ext === 'scriptum') doc = parseProject(data);
    else if (ext === 'txt') doc = docFromPlainText(data);
    else doc = data.trimStart().startsWith('{') ? parseProject(data) : parseFountain(data);

    clearAutosave();
    editor.load(doc);
    state.filePath = ext === 'scriptum' ? path : null; // imports save to a new file
    markClean();
    if (ext !== 'scriptum') markDirty();
    toast(`Opened ${baseName(path)} — ${editor.pagination.totalPages} pages.`);
  } catch (err) {
    platform.error({
      message: `Could not read ${baseName(path)}.`,
      detail: String(err.message || err),
    });
  }
}

function docFromPlainText(text) {
  const doc = createDocument({ elements: [] });
  doc.elements = inferElements(text.replace(/\r\n?/g, '\n').split('\n'));
  return doc;
}

async function saveFile(forceDialog) {
  const name = suggestedName('scriptum');
  const text = serializeProject(editor.doc);

  if (state.filePath && !forceDialog) {
    try {
      await platform.writeTo(state.filePath, text);
      clearAutosave();
      markClean();
      toast(`Saved ${baseName(state.filePath)}.`);
      return state.filePath;
    } catch (err) {
      platform.error({ message: 'Could not save.', detail: String(err.message || err) });
      return null;
    }
  }

  const path = await platform.save(text, { defaultName: name, kind: 'scriptum' });
  if (!path) return null;
  state.filePath = path;
  clearAutosave();
  markClean();
  toast(`Saved ${baseName(path)}.`);
  return path;
}

async function exportText(text, kind) {
  const ext = { fdx: 'fdx', fountain: 'fountain', text: 'txt', csv: 'csv' }[kind] || 'txt';
  const path = await platform.save(text, { defaultName: suggestedName(ext), kind });
  if (path) toast(`Exported ${baseName(path)}.`);
}

async function exportPdf() {
  try {
    const unsupported = pdfSupportIssues(editor.doc, editor.pagination);
    if (unsupported.length) {
      const characterCount = unsupported.reduce((total, issue) => total + issue.count, 0);
      const choice = await platform.confirm({
        message: 'Some characters cannot be printed by the current PDF font.',
        detail:
          `${characterCount} ${characterCount === 1 ? 'character' : 'characters'} in ` +
          `${unsupported.length} ${unsupported.length === 1 ? 'place will' : 'places will'} ` +
          'appear as ?. Format Assistant can take you to each affected screenplay element.',
        buttons: ['Export Anyway', 'Cancel'],
        defaultId: 1,
      });
      if (choice !== 0) return;
    }
    const bytes = exportPDF(editor.doc, editor.pagination, editor.styles);
    const path = await platform.saveBinary(bytes, {
      defaultName: suggestedName('pdf'),
      kind: 'pdf',
    });
    if (path) toast(`Exported ${editor.pagination.totalPages} pages to ${baseName(path)}.`);
  } catch (err) {
    platform.error({ message: 'PDF export failed.', detail: String(err.message || err) });
  }
}

/**
 * Answer the main process's close request. The verdict is always reported
 * back, including a refusal: the main process needs to know to forget the
 * pending quit, and staying silent would leave a window that cannot be closed.
 */
async function requestClose() {
  let confirmed = false;
  try {
    confirmed = await confirmDiscard();
    if (confirmed) clearAutosave();
  } catch (err) {
    // Never let a failure here trap the user inside the application.
    console.error('Close check failed, allowing the close anyway:', err);
    confirmed = true;
  }
  native?.closeWindow(confirmed);
}

function suggestedName(ext) {
  const title = (editor.doc.title.title || 'Untitled').replace(/[^\w\s-]/g, '').trim() || 'Untitled';
  return `${title}.${ext}`;
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}

/* ------------------------------------------------------------------ *
 * Editing commands
 * ------------------------------------------------------------------ */

function toggleDualDialogue() {
  const el = editor.currentElement();
  if (!el) return;

  editor.commit(() => {
    const doc = editor.doc;
    const idx = indexOfElement(doc, el.id);

    // Find the speech containing the caret.
    let start = idx;
    while (start > 0 && isSpeech(doc.elements[start - 1])) start -= 1;
    if (!isSpeech(doc.elements[start])) return null;
    let end = start;
    while (end + 1 < doc.elements.length && isSpeech(doc.elements[end + 1]) &&
           doc.elements[end + 1].type !== ElementType.CHARACTER) {
      end += 1;
    }

    // Already dual? Turn it off for both halves.
    if (doc.elements[start].dual) {
      let a = start;
      while (a > 0 && doc.elements[a - 1].dual) a -= 1;
      let b = end;
      while (b + 1 < doc.elements.length && doc.elements[b + 1].dual) b += 1;
      for (let i = a; i <= b; i += 1) doc.elements[i].dual = null;
      return { elementId: el.id, offset: 0 };
    }

    // Otherwise pair this speech with the one above it.
    let prevEnd = start - 1;
    while (prevEnd >= 0 && !isSpeech(doc.elements[prevEnd])) prevEnd -= 1;
    if (prevEnd < 0) {
      toast('Dual dialogue needs a speech above this one to pair with.');
      return null;
    }
    let prevStart = prevEnd;
    while (prevStart > 0 && isSpeech(doc.elements[prevStart - 1])) prevStart -= 1;

    for (let i = prevStart; i <= prevEnd; i += 1) doc.elements[i].dual = 'left';
    for (let i = start; i <= end; i += 1) doc.elements[i].dual = 'right';
    return { elementId: el.id, offset: 0 };
  });

  editor.hardRender(null);
  markDirty();
}

function isSpeech(el) {
  return (
    el &&
    (el.type === ElementType.CHARACTER ||
      el.type === ElementType.PARENTHETICAL ||
      el.type === ElementType.DIALOGUE)
  );
}

function omitScene() {
  const el = editor.currentElement();
  if (!el) return;
  const scenes = getScenes(editor.doc);
  const scene = scenes.find((s) => s.elements.some((e) => e.id === el.id));
  if (!scene) {
    toast('Put the caret inside a scene first.');
    return;
  }
  editor.commit(() => {
    const heading = getElement(editor.doc, scene.id);
    heading.omitted = !heading.omitted;
    return { elementId: heading.id, offset: 0 };
  });
  editor.hardRender(null);
  markDirty();
}

function jumpToScene(sceneId) {
  if (state.cardsOpen) toggleCards();
  editor.renderer.scrollToElement(sceneId, 'smooth');
  editor.setCaret(sceneId, 0);
  dom.pages.focus();
  refreshSidebar();
}

function openReports() {
  reportsDialog(editor, {
    onExportCSV: (csv, name) =>
      platform.save(csv, { defaultName: `${suggestedName('csv').replace('.csv', '')}-${name}.csv`, kind: 'csv' }),
    onJumpToScene: jumpToScene,
  });
}

function openFormatAssistant() {
  formatAssistantDialog(editor, { onGoTo: jumpToFormatIssue });
}

function jumpToFormatIssue(issue) {
  if (issue?.field?.startsWith('title.')) {
    titlePageDialog(editor);
    return;
  }
  if (issue?.field?.startsWith('revisions.')) {
    revisionsDialog(editor, toast);
    return;
  }
  if (!issue?.elementId) return;
  if (state.cardsOpen) toggleCards();
  const index = indexOfElement(editor.doc, issue.elementId);
  if (index === -1) return;
  editor.renderer.scrollToElement(issue.elementId, 'smooth');
  const start = Math.max(0, issue.range?.start || 0);
  const end = Math.max(start, issue.range?.end || start);
  editor.setCaret(issue.elementId, start, { scroll: true });
  if (end > start) {
    editor.selectRange({
      start: { elementId: issue.elementId, offset: start },
      end: { elementId: issue.elementId, offset: end },
      startIndex: index,
      endIndex: index,
      collapsed: false,
    });
  }
  dom.pages.focus();
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function toggleSidebar() {
  const collapsed = dom.sidebar.classList.toggle('collapsed');
  document.getElementById('tb-sidebar').setAttribute('aria-expanded', String(!collapsed));
}

function toggleCards() {
  state.cardsOpen = !state.cardsOpen;
  dom.cardsView.classList.toggle('open', state.cardsOpen);
  dom.cardsView.setAttribute('aria-hidden', String(!state.cardsOpen));
  dom.scroll.inert = state.cardsOpen;
  const button = document.getElementById('tb-cards');
  button.classList.toggle('active', state.cardsOpen);
  button.setAttribute('aria-pressed', String(state.cardsOpen));
  if (state.cardsOpen) board.render();
  else dom.pages.focus();
}

function applyTheme(theme) {
  state.theme = theme;
  document.body.classList.toggle('theme-dark', theme === 'dark');
  try {
    localStorage.setItem('scriptum:theme', theme);
  } catch {
    // The editor remains usable when a locked-down browser denies storage.
  }
}

function storedTheme() {
  try {
    return localStorage.getItem('scriptum:theme') || 'light';
  } catch {
    return 'light';
  }
}

/* ------------------------------------------------------------------ *
 * Status bar and sidebar
 * ------------------------------------------------------------------ */

let sidebarTimer = null;

function onEditorUpdate(ed, extra) {
  if (extra?.openNotes) {
    notesDialog(ed, extra.openNotes);
    return;
  }
  // Moving the caret or scrolling changes nothing in the document, so it must
  // not flag the file as edited — otherwise every quit asks about saving work
  // that was never done.
  if (!extra?.viewOnly) markDirty();
  refreshStatus();
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(refreshSidebar, 180);
}

function refreshStatus() {
  const p = editor.pagination;
  if (!p) return;
  const caret = editor.getCaret();
  const stats = editor.stats();

  let pageNum = 1;
  if (caret && p.lineIndex.has(caret.elementId)) {
    pageNum = p.lineIndex.get(caret.elementId).page + 1;
  }

  dom.stPage.textContent = `Page ${p.pages[pageNum - 1]?.number || pageNum} of ${p.totalPages}`;
  dom.stRuntime.textContent = estimateRuntime(p).label;
  dom.stWords.innerHTML = `<b>${stats.words.toLocaleString()}</b> words`;

  const el = caret ? getElement(editor.doc, caret.elementId) : null;
  if (el) {
    dom.stElement.textContent = ELEMENT_LABEL[el.type];
    dom.elementSelect.value = el.type;
    syncStyleButtons(el, caret.offset);
  } else {
    dom.stElement.textContent = '';
  }

  // Always recompute, so the readout can never survive a document swap.
  const scenes = getScenes(editor.doc);
  const scene = el ? scenes.find((s) => s.elements.some((e) => e.id === el.id)) : null;
  dom.stScene.textContent = scene
    ? `Scene ${scene.sceneNumber || scene.index + 1} of ${scenes.length}`
    : `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`;
}

function syncStyleButtons(el, offset) {
  const active = { bold: false, italic: false, underline: false };
  for (const r of el.styles) {
    if (offset > r.start && offset <= r.end) {
      active.bold ||= !!r.bold;
      active.italic ||= !!r.italic;
      active.underline ||= !!r.underline;
    }
  }
  document.getElementById('tb-bold').classList.toggle('active', active.bold);
  document.getElementById('tb-italic').classList.toggle('active', active.italic);
  document.getElementById('tb-underline').classList.toggle('active', active.underline);
  document.getElementById('tb-bold').setAttribute('aria-pressed', String(active.bold));
  document.getElementById('tb-italic').setAttribute('aria-pressed', String(active.italic));
  document.getElementById('tb-underline').setAttribute('aria-pressed', String(active.underline));
}

function refreshSidebar() {
  if (dom.sidebar.classList.contains('collapsed')) return;
  const activePane = document.querySelector('.side-pane.active')?.id;
  if (activePane === 'pane-scenes') renderScenePane();
  else if (activePane === 'pane-characters') renderCharacterPane();
  else renderNotesPane();
  if (state.cardsOpen) board.render();
}

function renderScenePane() {
  const scenes = getScenes(editor.doc);
  const caret = editor.getCaret();
  const pane = dom.paneScenes;
  pane.innerHTML = '';

  if (!scenes.length) {
    pane.appendChild(
      h('div', { class: 'side-empty' }, 'No scenes yet. Type a scene heading such as ',
        h('b', {}, 'INT. KITCHEN - DAY'), ' to get started.')
    );
    return;
  }

  const pageOf = new Map();
  editor.pagination.pages.forEach((page) => {
    for (const line of page.lines) {
      const id = line.elementId;
      if (id && !pageOf.has(id)) pageOf.set(id, page.number);
    }
  });

  for (const scene of scenes) {
    const isActive = caret && scene.elements.some((e) => e.id === caret.elementId);
    const heading = getElement(editor.doc, scene.id);
    const row = h(
      'button',
      { type: 'button', class: `nav-scene${isActive ? ' active' : ''}`, onClick: () => jumpToScene(scene.id) },
      h(
        'div',
        { class: 'h' },
        heading?.cardColor
          ? h('span', { class: 'swatch', style: { background: heading.cardColor } })
          : null,
        h('span', { class: 'n' }, scene.sceneNumber || String(scene.index + 1)),
        h('span', { class: 't' }, scene.heading || '(untitled scene)')
      ),
      h(
        'div',
        { class: 'meta' },
        h('span', {}, `p. ${pageOf.get(scene.id) || '—'}`),
        scene.omitted ? h('span', {}, 'OMITTED') : null,
        h('span', {}, `${scene.elements.length - 1} elements`)
      )
    );
    pane.appendChild(row);
  }
}

function renderCharacterPane() {
  const pane = dom.paneCharacters;
  pane.innerHTML = '';
  const chars = editor.vocab.characters;

  if (!chars.length) {
    pane.appendChild(h('div', { class: 'side-empty' }, 'No characters yet.'));
    return;
  }

  const max = Math.max(...chars.map((c) => c.count), 1);
  for (const c of chars) {
    pane.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'nav-scene',
          onClick: () => {
            const el = editor.doc.elements.find(
              (e) => e.type === ElementType.CHARACTER && e.text.toUpperCase().startsWith(c.value)
            );
            if (el) jumpToScene(el.id);
          },
        },
        h('div', { class: 'h' }, h('span', { class: 't' }, c.value)),
        h(
          'div',
          { class: 'meta' },
          h('span', {}, `${c.count} speech${c.count === 1 ? '' : 'es'}`),
          h('div', { class: 'bar', style: { width: `${(c.count / max) * 60}px`, marginTop: '3px' } })
        )
      )
    );
  }
}

function renderNotesPane() {
  const pane = dom.paneNotes;
  pane.innerHTML = '';
  const withNotes = editor.doc.elements.filter((e) => e.notes?.length);

  if (!withNotes.length) {
    pane.appendChild(
      h('div', { class: 'side-empty' },
        'No notes yet. Select an element and press ', h('b', {}, 'Note'), ' in the toolbar.')
    );
    return;
  }

  for (const el of withNotes) {
    for (const note of el.notes) {
      pane.appendChild(
        h(
          'button',
          { type: 'button', class: 'nav-scene', onClick: () => jumpToScene(el.id) },
          h('div', { class: 'h' }, h('span', { class: 't' }, el.text.slice(0, 40) || '(empty)')),
          h('div', { class: 'meta' }, h('span', {}, note.text.slice(0, 80)))
        )
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Dirty tracking
 * ------------------------------------------------------------------ */

function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    platform.setTitle(editor.doc.title.title || 'Untitled', true);
  }
}

function markClean() {
  state.dirty = false;
  platform.setTitle(editor.doc.title.title || 'Untitled', false);
  refreshStatus();
  refreshSidebar();
}

let toastTimer = null;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ *
 * A short sample so the app never opens on a blank void
 * ------------------------------------------------------------------ */

function sampleDocument() {
  const doc = createDocument({ elements: [] });
  doc.title.title = 'UNTITLED';
  doc.title.credit = 'Written by';
  doc.title.author = 'Your Name';
  doc.title.showTitlePage = false;

  const add = (type, text) => doc.elements.push(createElement(type, text));

  add(ElementType.SCENE_HEADING, 'INT. WRITER\'S DESK - NIGHT');
  add(ElementType.ACTION, 'A cursor blinks. It has been blinking for some time.');
  add(ElementType.CHARACTER, 'THE WRITER');
  add(ElementType.PARENTHETICAL, '(to no one)');
  add(ElementType.DIALOGUE, 'Okay. Page one.');
  add(ElementType.ACTION, 'They start typing. Delete this scene and begin.');
  add(ElementType.SCENE_HEADING, '');

  return doc;
}

boot();

// Handy from the console and from automated checks; reads live state only.
window.__scriptum = { editor, finder, board, state, platform };
