/**
 * preload.js — The only bridge between the renderer and the system.
 *
 * Deliberately narrow: the renderer can ask for a file dialog and read/write
 * a path the user chose, and can subscribe to menu commands. It cannot
 * enumerate the filesystem or run arbitrary code in the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

const MENU_CHANNELS = [
  'menu:new',
  'menu:open',
  'menu:open-path',
  'menu:save',
  'menu:save-as',
  'menu:import-fdx',
  'menu:import-fountain',
  'menu:import-text',
  'menu:export-pdf',
  'menu:export-fdx',
  'menu:export-fountain',
  'menu:export-text',
  'menu:undo',
  'menu:redo',
  'menu:find',
  'menu:find-next',
  'menu:find-prev',
  'menu:goto-scene',
  'menu:bold',
  'menu:italic',
  'menu:underline',
  'menu:dual',
  'menu:add-alternate',
  'menu:production-tag',
  'menu:toggle-production-tags',
  'menu:format-assistant',
  'menu:element-settings',
  'menu:page-setup',
  'menu:scene-numbers',
  'menu:lock-scenes',
  'menu:revisions',
  'menu:revision-room',
  'menu:lock-pages',
  'menu:unlock-pages',
  'menu:omit-scene',
  'menu:title-page',
  'menu:toggle-sidebar',
  'menu:cards',
  'menu:timeline',
  'menu:focus',
  'menu:sprint',
  'menu:sprint-pause',
  'menu:sprint-end',
  'menu:reports',
  'menu:zoom-in',
  'menu:zoom-out',
  'menu:zoom-reset',
  'menu:toggle-theme',
  'menu:preferences',
  'menu:shortcuts',
  'menu:privacy',
  'app:request-close',
];

// Element-type commands are generated from the same list the menu uses.
const TYPE_CHANNELS = [
  'scene_heading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
  'act_break',
].map((t) => `menu:type-${t}`);

contextBridge.exposeInMainWorld('scriptum', {
  isElectron: true,
  platform: process.platform,

  openDialog: (kinds) => ipcRenderer.invoke('dialog:open', kinds),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  writeFile: (path, data) => ipcRenderer.invoke('file:write', { path, data }),
  writeBinary: (path, data) => ipcRenderer.invoke('file:write-binary', { path, data }),
  showInFolder: (path) => ipcRenderer.invoke('shell:show', path),

  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),
  error: (opts) => ipcRenderer.invoke('dialog:error', opts),

  setTitle: (title, edited) => ipcRenderer.invoke('window:set-title', { title, edited }),
  /** @param {boolean} confirmed false when the user cancelled the close. */
  closeWindow: (confirmed = true) => ipcRenderer.invoke('window:close', { confirmed }),

  /** Subscribe to a menu command. Returns an unsubscribe function. */
  onMenu: (channel, handler) => {
    if (![...MENU_CHANNELS, ...TYPE_CHANNELS].includes(channel)) {
      throw new Error(`Unknown menu channel: ${channel}`);
    }
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
