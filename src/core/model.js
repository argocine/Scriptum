/**
 * model.js — The screenplay document model.
 *
 * A screenplay is a flat, ordered list of elements. Flat is deliberate: scenes
 * are derived by scanning for scene headings rather than stored as a tree, so
 * there is no structure to corrupt when a writer deletes a heading mid-edit.
 *
 * Inline emphasis is stored as character ranges over `text` rather than as
 * markup, which keeps text offsets stable for pagination, find-and-replace and
 * mid-element page splits.
 */

import { ElementType } from './format.js';

let idCounter = 0;
export function newId(prefix = 'e') {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/**
 * @typedef {Object} StyleRange
 * @property {number} start  inclusive character offset
 * @property {number} end    exclusive character offset
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underline]
 */

export function createElement(type = ElementType.ACTION, text = '', extra = {}) {
  return {
    id: newId(),
    type,
    text,
    styles: [], // StyleRange[]
    sceneNumber: null, // scene headings only
    sceneNumberLocked: false,
    revisionId: null, // which revision set last touched this element
    dual: null, // null | 'left' | 'right'
    notes: [], // {id, text, color, author, created}
    tags: [], // {category, value} — production tagging
    omitted: false,
    ...extra,
  };
}

export function createDocument(overrides = {}) {
  return {
    version: 1,
    title: {
      title: 'UNTITLED',
      credit: 'Written by',
      author: '',
      source: '',
      draftDate: '',
      contact: '',
      notes: '',
      showTitlePage: true,
    },
    elements: [createElement(ElementType.SCENE_HEADING, '')],
    /** User overrides layered onto DEFAULT_ELEMENTS / DEFAULT_PAGE. */
    styleOverrides: {},
    pageOverrides: {},
    sceneNumbering: {
      enabled: false,
      showLeft: true,
      showRight: true,
      startAt: 1,
      locked: false,
    },
    revisions: {
      current: null, // id of the active revision set, or null for the base draft
      sets: [], // {id, name, color, mark, date, active}
      showMarks: true,
    },
    pageLock: {
      locked: false,
      anchors: [], // {page: '12', elementId} captured at lock time
    },
    characters: {}, // name -> {name, count, extension}
    meta: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * Element classification helpers
 * ------------------------------------------------------------------ */

export function isDialogueBlock(type) {
  return (
    type === ElementType.CHARACTER ||
    type === ElementType.PARENTHETICAL ||
    type === ElementType.DIALOGUE
  );
}

/**
 * What element should follow this one when the writer presses Enter?
 * This is the single biggest ergonomic win over a word processor: the writer
 * never has to reach for a menu in the normal flow of a scene.
 */
export function nextTypeOnEnter(type) {
  switch (type) {
    case ElementType.SCENE_HEADING:
      return ElementType.ACTION;
    case ElementType.CHARACTER:
      return ElementType.DIALOGUE;
    case ElementType.PARENTHETICAL:
      return ElementType.DIALOGUE;
    case ElementType.DIALOGUE:
      return ElementType.CHARACTER;
    case ElementType.TRANSITION:
      return ElementType.SCENE_HEADING;
    case ElementType.SHOT:
      return ElementType.ACTION;
    case ElementType.ACT_BREAK:
      return ElementType.SCENE_HEADING;
    default:
      return ElementType.ACTION;
  }
}

/**
 * Tab cycles between the plausible alternatives for the current position,
 * mirroring Final Draft's behaviour where Tab on an empty Action becomes a
 * Character cue.
 */
export function nextTypeOnTab(type, isEmpty) {
  if (isEmpty) {
    switch (type) {
      case ElementType.ACTION:
        return ElementType.CHARACTER;
      case ElementType.CHARACTER:
        return ElementType.TRANSITION;
      case ElementType.TRANSITION:
        return ElementType.SCENE_HEADING;
      case ElementType.SCENE_HEADING:
        return ElementType.ACTION;
      case ElementType.DIALOGUE:
        return ElementType.PARENTHETICAL;
      case ElementType.PARENTHETICAL:
        return ElementType.DIALOGUE;
      default:
        return ElementType.ACTION;
    }
  }
  // With content, Tab moves to the "sibling" element type.
  switch (type) {
    case ElementType.CHARACTER:
      return ElementType.DIALOGUE;
    case ElementType.DIALOGUE:
      return ElementType.CHARACTER;
    default:
      return type;
  }
}

/* ------------------------------------------------------------------ *
 * Automatic element detection
 *
 * Applied as the writer types so that "INT. " becomes a Scene Heading without
 * anyone choosing it from a menu.
 * ------------------------------------------------------------------ */

const SCENE_PREFIX =
  /^(INT|EXT|EST|INT\.?\/EXT|I\/E|EXT\.?\/INT)[\.\s]/i;
const TRANSITION_RE =
  /^(FADE (IN|OUT|TO BLACK)|CUT TO|DISSOLVE TO|SMASH CUT TO|MATCH CUT TO|JUMP CUT TO|WIPE TO|IRIS (IN|OUT)|TIME CUT|INTERCUT WITH|BACK TO|FLASH CUT TO)\b.*:?\s*$/i;
const SHOT_RE =
  /^(ANGLE ON|CLOSE ON|CLOSE UP|CLOSEUP|WIDE ON|WIDE SHOT|POV|REVERSE ANGLE|INSERT|AERIAL SHOT|TRACKING SHOT|PAN TO|TIGHT ON|SERIES OF SHOTS|MONTAGE)\b/i;

/**
 * Guess the element type for freshly typed text.
 * Returns null when the current type should be left alone.
 */
export function detectType(text, currentType) {
  const t = text.trim();
  if (!t) return null;

  // Only reinterpret "neutral" elements. Never fight an explicit choice on
  // dialogue, which would be maddening mid-speech.
  const neutral =
    currentType === ElementType.ACTION ||
    currentType === ElementType.GENERAL ||
    currentType === ElementType.SCENE_HEADING ||
    currentType === ElementType.TRANSITION ||
    currentType === ElementType.SHOT;
  if (!neutral) return null;

  if (SCENE_PREFIX.test(t)) return ElementType.SCENE_HEADING;
  if (TRANSITION_RE.test(t)) return ElementType.TRANSITION;
  if (SHOT_RE.test(t)) return ElementType.SHOT;

  // A scene heading that no longer looks like one falls back to Action.
  if (currentType === ElementType.SCENE_HEADING && !SCENE_PREFIX.test(t)) {
    return ElementType.ACTION;
  }
  if (currentType === ElementType.TRANSITION && !TRANSITION_RE.test(t)) {
    return ElementType.ACTION;
  }
  if (currentType === ElementType.SHOT && !SHOT_RE.test(t)) {
    return ElementType.ACTION;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Scenes
 * ------------------------------------------------------------------ */

/** Derive the scene list from the element array. */
export function getScenes(doc) {
  const scenes = [];
  let current = null;

  doc.elements.forEach((el, index) => {
    if (el.type === ElementType.SCENE_HEADING) {
      current = {
        id: el.id,
        index: scenes.length,
        heading: el.text,
        sceneNumber: el.sceneNumber,
        startIndex: index,
        endIndex: index,
        elements: [el],
        omitted: el.omitted,
        summary: sceneSummary(doc, index),
        color: el.cardColor || null,
      };
      scenes.push(current);
    } else if (current) {
      current.endIndex = index;
      current.elements.push(el);
    }
  });

  return scenes;
}

function sceneSummary(doc, headingIndex) {
  // First action or dialogue line after the heading, trimmed for the card.
  for (let i = headingIndex + 1; i < doc.elements.length; i += 1) {
    const el = doc.elements[i];
    if (el.type === ElementType.SCENE_HEADING) break;
    if (el.text.trim()) return el.text.trim();
  }
  return '';
}

/** Parse a heading into its production-meaningful parts. */
export function parseHeading(text) {
  const m = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s*(.*)$/i.exec(
    text.trim()
  );
  if (!m) return { prefix: '', location: text.trim(), time: '' };

  const prefix = m[1].toUpperCase().replace(/\.?$/, '.');
  const rest = m[2];
  const dash = rest.lastIndexOf(' - ');
  if (dash === -1) return { prefix, location: rest.trim(), time: '' };
  return {
    prefix,
    location: rest.slice(0, dash).trim(),
    time: rest.slice(dash + 3).trim(),
  };
}

/* ------------------------------------------------------------------ *
 * Characters
 * ------------------------------------------------------------------ */

/** Strip "(V.O.)", "(CONT'D)" and friends from a character cue. */
export function baseCharacterName(cue) {
  return cue
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function characterExtension(cue) {
  const m = /\(([^)]*)\)\s*$/.exec(cue.trim());
  return m ? m[1].trim() : '';
}

/** Index every speaking character with line and word counts. */
export function collectCharacters(doc) {
  const map = new Map();
  let pending = null;

  for (const el of doc.elements) {
    if (el.type === ElementType.CHARACTER) {
      const name = baseCharacterName(el.text);
      if (!name) {
        pending = null;
        continue;
      }
      if (!map.has(name)) {
        map.set(name, {
          name,
          cues: 0,
          words: 0,
          scenes: new Set(),
          extensions: new Set(),
        });
      }
      const rec = map.get(name);
      rec.cues += 1;
      const ext = characterExtension(el.text);
      if (ext) rec.extensions.add(ext.toUpperCase());
      pending = rec;
    } else if (el.type === ElementType.DIALOGUE && pending) {
      pending.words += countWords(el.text);
    } else if (el.type === ElementType.SCENE_HEADING) {
      pending = null;
    }
  }

  // Attribute scenes in a second pass so a character is credited to the scene
  // they actually speak in.
  let sceneKey = null;
  let speaker = null;
  for (const el of doc.elements) {
    if (el.type === ElementType.SCENE_HEADING) {
      sceneKey = el.id;
      speaker = null;
    } else if (el.type === ElementType.CHARACTER) {
      speaker = baseCharacterName(el.text);
      const rec = map.get(speaker);
      if (rec && sceneKey) rec.scenes.add(sceneKey);
    }
  }

  return [...map.values()].sort((a, b) => b.words - a.words);
}

export function countWords(text) {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/* ------------------------------------------------------------------ *
 * Inline style ranges
 * ------------------------------------------------------------------ */

/** Merge overlapping/adjacent ranges with identical attributes. */
export function normalizeStyles(styles, textLength) {
  const clipped = styles
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, textLength)),
      end: Math.max(0, Math.min(r.end, textLength)),
      bold: !!r.bold,
      italic: !!r.italic,
      underline: !!r.underline,
    }))
    .filter((r) => r.end > r.start && (r.bold || r.italic || r.underline));

  if (clipped.length === 0) return [];

  // Rebuild as a per-character attribute map, then re-run into ranges. This is
  // O(n) in text length and removes every overlap pathology in one pass.
  const attrs = new Array(textLength).fill(0);
  const BOLD = 1;
  const ITALIC = 2;
  const UNDER = 4;
  for (const r of clipped) {
    const bits =
      (r.bold ? BOLD : 0) | (r.italic ? ITALIC : 0) | (r.underline ? UNDER : 0);
    for (let i = r.start; i < r.end; i += 1) attrs[i] |= bits;
  }

  const out = [];
  let i = 0;
  while (i < textLength) {
    if (attrs[i] === 0) {
      i += 1;
      continue;
    }
    const bits = attrs[i];
    let j = i + 1;
    while (j < textLength && attrs[j] === bits) j += 1;
    out.push({
      start: i,
      end: j,
      bold: !!(bits & BOLD),
      italic: !!(bits & ITALIC),
      underline: !!(bits & UNDER),
    });
    i = j;
  }
  return out;
}

/** Shift style ranges after a text insertion/deletion at `at`. */
export function adjustStyles(styles, at, delta) {
  if (!delta) return styles;
  return styles
    .map((r) => ({
      ...r,
      start: r.start >= at ? Math.max(at, r.start + delta) : r.start,
      end: r.end > at ? Math.max(at, r.end + delta) : r.end,
    }))
    .filter((r) => r.end > r.start);
}

/** Split style ranges for an element cut at character offset `at`. */
export function splitStyles(styles, at) {
  const left = [];
  const right = [];
  for (const r of styles) {
    if (r.end <= at) left.push({ ...r });
    else if (r.start >= at) right.push({ ...r, start: r.start - at, end: r.end - at });
    else {
      left.push({ ...r, end: at });
      right.push({ ...r, start: 0, end: r.end - at });
    }
  }
  return [left, right];
}

/** Attributes active at a character offset — drives toolbar button state. */
export function stylesAt(styles, offset) {
  const active = { bold: false, italic: false, underline: false };
  for (const r of styles) {
    if (offset >= r.start && offset < r.end) {
      active.bold ||= !!r.bold;
      active.italic ||= !!r.italic;
      active.underline ||= !!r.underline;
    }
  }
  return active;
}

/* ------------------------------------------------------------------ *
 * Document mutation helpers (pure — they return new arrays)
 * ------------------------------------------------------------------ */

export function indexOfElement(doc, id) {
  return doc.elements.findIndex((e) => e.id === id);
}

export function getElement(doc, id) {
  return doc.elements.find((e) => e.id === id) || null;
}

export function touch(doc) {
  doc.meta.modified = new Date().toISOString();
  return doc;
}

/** Deep-ish clone used by the undo stack. Elements are plain data. */
export function cloneDocument(doc) {
  return {
    ...doc,
    title: { ...doc.title },
    elements: doc.elements.map((e) => ({
      ...e,
      styles: e.styles.map((s) => ({ ...s })),
      notes: e.notes.map((n) => ({ ...n })),
      tags: e.tags.map((t) => ({ ...t })),
    })),
    styleOverrides: JSON.parse(JSON.stringify(doc.styleOverrides || {})),
    pageOverrides: { ...doc.pageOverrides },
    sceneNumbering: { ...doc.sceneNumbering },
    revisions: {
      ...doc.revisions,
      sets: doc.revisions.sets.map((s) => ({ ...s })),
    },
    pageLock: {
      ...doc.pageLock,
      anchors: doc.pageLock.anchors.map((a) => ({ ...a })),
    },
    meta: { ...doc.meta },
  };
}
