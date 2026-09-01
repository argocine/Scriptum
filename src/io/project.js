/**
 * project.js — The native document format, plus plain-text export.
 *
 * The native format is unobfuscated JSON. If this application vanished
 * tomorrow, a writer could still recover every word with a text editor — which
 * is the whole point of a free tool.
 */

import { ElementType, ELEMENT_ORDER, applyCase } from '../core/format.js';
import { createDocument, createElement, normalizeStyles } from '../core/model.js';
import { normalizeAlternateDialogue } from '../core/alternates.js';
import { normalizeElementTags, normalizeProductionRegistry } from '../core/production.js';
import { normalizeRevisionRoom } from '../features/snapshots.js';

const FORMAT = 'scriptum-screenplay';
const FORMAT_VERSION = 1;

export function serializeProject(doc) {
  return `${JSON.stringify(
    {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      document: doc,
    },
    null,
    2
  )}\n`;
}

/** Apply the same defensive hydration used for files to an in-memory recovery copy. */
export function normalizeDocument(doc) {
  return parseProject(JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    document: doc,
  }));
}

export function parseProject(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid Scriptum JSON.');
  }

  if (!isRecord(parsed) || parsed.format !== FORMAT) {
    throw new Error('This file was not written by Scriptum.');
  }
  if (
    parsed.formatVersion !== undefined &&
    (!Number.isInteger(parsed.formatVersion) || parsed.formatVersion < 1)
  ) {
    throw new Error('This file has an invalid Scriptum format version.');
  }
  if (parsed.formatVersion > FORMAT_VERSION) {
    throw new Error(
      'This screenplay was saved by a newer version of Scriptum. Update the app to open it.'
    );
  }

  // Layer the saved document over a fresh one so files written by older
  // versions gain any fields added since, with sane defaults.
  const base = createDocument({ elements: [] });
  const d = isRecord(parsed.document) ? parsed.document : {};
  const title = isRecord(d.title) ? d.title : {};
  const sceneNumbering = isRecord(d.sceneNumbering) ? d.sceneNumbering : {};
  const revisions = isRecord(d.revisions) ? d.revisions : {};
  const pageLock = isRecord(d.pageLock) ? d.pageLock : {};
  const meta = isRecord(d.meta) ? d.meta : {};
  const production = normalizeProductionRegistry(d.production);
  const seenIds = new Set();

  const doc = {
    ...base,
    title: {
      ...base.title,
      ...Object.fromEntries(
        Object.keys(base.title)
          .filter((key) => key !== 'showTitlePage' && typeof title[key] === 'string')
          .map((key) => [key, title[key]])
      ),
      showTitlePage:
        typeof title.showTitlePage === 'boolean'
          ? title.showTitlePage
          : base.title.showTitlePage,
    },
    sceneNumbering: {
      ...base.sceneNumbering,
      enabled: booleanOr(sceneNumbering.enabled, base.sceneNumbering.enabled),
      showLeft: booleanOr(sceneNumbering.showLeft, base.sceneNumbering.showLeft),
      showRight: booleanOr(sceneNumbering.showRight, base.sceneNumbering.showRight),
      startAt: positiveIntegerOr(sceneNumbering.startAt, base.sceneNumbering.startAt),
      locked: booleanOr(sceneNumbering.locked, base.sceneNumbering.locked),
    },
    revisions: {
      ...base.revisions,
      ...revisions,
      current: typeof revisions.current === 'string' ? revisions.current : null,
      showMarks: booleanOr(revisions.showMarks, base.revisions.showMarks),
      sets: Array.isArray(revisions.sets)
        ? revisions.sets.filter(isRecord).map((set, index) => ({
            ...set,
            id: typeof set.id === 'string' && set.id ? set.id : String(index + 1),
            name: typeof set.name === 'string' ? set.name : `Revision ${index + 1}`,
            color: typeof set.color === 'string' ? set.color : '#ffffff',
            mark: typeof set.mark === 'string' ? set.mark : '*',
            date: typeof set.date === 'string' ? set.date : '',
            active: booleanOr(set.active, true),
          }))
        : [],
    },
    pageLock: {
      ...base.pageLock,
      ...pageLock,
      locked: booleanOr(pageLock.locked, base.pageLock.locked),
      anchors: Array.isArray(pageLock.anchors)
        ? pageLock.anchors
            .filter(
              (anchor) =>
                isRecord(anchor) &&
                typeof anchor.elementId === 'string' &&
                typeof anchor.page === 'string'
            )
            .map((anchor) => ({ elementId: anchor.elementId, page: anchor.page }))
        : [],
    },
    meta: { ...base.meta, ...meta },
    production,
    revisionRoom: normalizeRevisionRoom(d.revisionRoom, {
      // Snapshot bodies cross the same hostile file boundary as the live
      // document. Hydrate them through the identical whitelist/ID repair path
      // before Revision Room can compare or restore them.
      normalizeState: (state) => normalizeDocument(state),
    }),
    styleOverrides: isRecord(d.styleOverrides) ? d.styleOverrides : {},
    pageOverrides: isRecord(d.pageOverrides) ? d.pageOverrides : {},
    elements: (Array.isArray(d.elements) ? d.elements : []).filter(isRecord).map((e) => {
      const type = ELEMENT_ORDER.includes(e.type) ? e.type : ElementType.ACTION;
      const text = typeof e.text === 'string' ? e.text : '';
      const fresh = createElement(type, text);
      const element = {
        ...fresh,
        ...e,
        type,
        text,
        styles: normalizeStyles(Array.isArray(e.styles) ? e.styles.filter(isRecord) : [], text.length),
        notes: Array.isArray(e.notes)
          ? e.notes.filter(isRecord).map((note, index) => ({
              ...note,
              id: typeof note.id === 'string' && note.id ? note.id : `n${index}`,
              text: typeof note.text === 'string' ? note.text : '',
            }))
          : [],
        tags: normalizeElementTags(e.tags, text.length, production),
      };
      element.sceneNumber =
        typeof e.sceneNumber === 'string' && e.sceneNumber ? e.sceneNumber : null;
      element.sceneNumberLocked = booleanOr(e.sceneNumberLocked, false);
      element.revisionId = typeof e.revisionId === 'string' ? e.revisionId : null;
      element.dual = e.dual === 'left' || e.dual === 'right' ? e.dual : null;
      element.omitted = booleanOr(e.omitted, false);
      element.alternateDialogue =
        type === ElementType.DIALOGUE ? normalizeAlternateDialogue(e.alternateDialogue) : null;
      if (typeof element.id !== 'string' || !element.id || seenIds.has(element.id)) {
        element.id = fresh.id;
      }
      seenIds.add(element.id);
      return element;
    }),
  };

  if (!doc.elements.length) doc.elements.push(createElement(ElementType.SCENE_HEADING, ''));
  return doc;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function positiveIntegerOr(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/* ------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------ */

/**
 * Fixed-width plain text laid out with real spaces, so it reads correctly in
 * any monospaced viewer — an email body, a terminal, a plain-text archive.
 */
export function toPlainText(doc, pagination, styles) {
  const out = [];
  const width = (inches) => Math.round(inches * 10);

  pagination.pages.forEach((page, pi) => {
    if (pi > 0) out.push('', `${' '.repeat(65)}${page.number}.`, '');

    for (const line of page.lines) {
      if (line.kind === 'blank') {
        out.push('');
        continue;
      }
      if (line.kind === 'dualrow') {
        const l = line.left ? padTo(line.left.text, width(line.left.x)) : '';
        const r = line.right ? padTo(line.right.text, width(line.right.x)) : '';
        out.push(mergeColumns(l, r));
        continue;
      }
      const spec = styles.elements[line.type];
      let text = line.text;
      let indent = width(line.x);
      if (line.align === 'right') indent = width(line.right) - text.length;
      else if (line.align === 'center') {
        indent = Math.round((width(line.x) + width(line.right) - text.length) / 2);
      }
      out.push(`${' '.repeat(Math.max(0, indent))}${applyCase(text, spec)}`);
    }
  });

  const header = doc.title.showTitlePage
    ? [
        doc.title.title?.toUpperCase() || '',
        '',
        doc.title.credit || '',
        doc.title.author || '',
        '',
        '',
      ]
    : [];

  return `${[...header, ...out].join('\n').replace(/\s+$/gm, '')}\n`;
}

function padTo(text, indent) {
  return `${' '.repeat(Math.max(0, indent))}${text}`;
}

function mergeColumns(a, b) {
  const len = Math.max(a.length, b.length);
  const out = new Array(len).fill(' ');
  for (let i = 0; i < a.length; i += 1) if (a[i] !== ' ') out[i] = a[i];
  for (let i = 0; i < b.length; i += 1) if (b[i] !== ' ') out[i] = b[i];
  return out.join('').replace(/\s+$/, '');
}

/* ------------------------------------------------------------------ *
 * Autosave / crash recovery
 * ------------------------------------------------------------------ */

const AUTOSAVE_KEY = 'scriptum:autosave';

/**
 * Desktop recovery survives an app restart. The hosted browser build uses
 * tab-scoped storage instead: a screenplay written on a shared computer must
 * not be offered to the next person who opens Scriptum in a new tab/session.
 */
function autosaveStorage() {
  try {
    if (typeof window === 'undefined') return globalThis.localStorage || null;
    return window.scriptum ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeAutosave(doc, filePath) {
  try {
    const storage = autosaveStorage();
    if (!storage) return false;
    storage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({ at: Date.now(), filePath: filePath || null, document: doc })
    );
    return true;
  } catch {
    // Quota exceeded on a very large script; not fatal.
    return false;
  }
}

export function readAutosave() {
  try {
    // Versions before 1.0 used persistent browser storage. Remove that legacy
    // copy automatically; the browser build now keeps screenplay recovery in
    // the current tab only. Desktop still intentionally uses localStorage.
    if (typeof window !== 'undefined' && !window.scriptum) {
      window.localStorage.removeItem(AUTOSAVE_KEY);
    }
    const raw = autosaveStorage()?.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  // Clear both stores so this is also a migration path for browser users who
  // visited a version that kept recovery data persistently.
  const storeNames = typeof window === 'undefined'
    ? ['localStorage']
    : ['localStorage', 'sessionStorage'];
  for (const name of storeNames) {
    try {
      const owner = typeof window === 'undefined' ? globalThis : window;
      const store = owner[name];
      store?.removeItem(AUTOSAVE_KEY);
    } catch {
      /* unavailable storage is harmless */
    }
  }
}
