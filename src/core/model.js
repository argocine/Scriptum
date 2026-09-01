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

/**
 * Re-anchor arbitrary character ranges after replacing [start,end) with text.
 *
 * Range-specific fields are preserved. Insertions at an exact range boundary
 * stay outside that range; insertions strictly inside it expand the range.
 * Replacing text overlapped by a range keeps the replacement in that range.
 * This neutral primitive is shared groundwork for production-tag ranges.
 */
export function adjustRangesForReplacement(ranges, start, end, insertedLength) {
  const safeStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(0, Math.floor(end)) : safeStart;
  const from = Math.min(safeStart, safeEnd);
  const to = Math.max(safeStart, safeEnd);
  const added = Math.max(0, Number.isFinite(insertedLength) ? Math.floor(insertedLength) : 0);
  const delta = added - (to - from);

  return (Array.isArray(ranges) ? ranges : []).flatMap((range) => {
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return [];
    const r = { ...range, start: Math.max(0, range.start), end: Math.max(0, range.end) };
    if (r.end <= r.start) return [];

    // A pure insertion uses non-sticky boundaries: text inserted exactly at
    // either edge is not silently pulled into an existing annotation.
    if (from === to) {
      if (r.end <= from) return [r];
      if (r.start >= from) return [{ ...r, start: r.start + added, end: r.end + added }];
      return [{ ...r, end: r.end + added }];
    }

    if (r.end <= from) return [r];
    if (r.start >= to) return [{ ...r, start: r.start + delta, end: r.end + delta }];

    const next = {
      ...r,
      start: r.start < from ? r.start : from,
      end: r.end > to ? r.end + delta : from + added,
    };
    return next.end > next.start ? [next] : [];
  });
}

/** Split arbitrary offset ranges at `at`, rebasing the right-hand ranges. */
export function splitOffsetRanges(ranges, at) {
  const left = [];
  const right = [];
  const offset = Math.max(0, at);
  for (const range of Array.isArray(ranges) ? ranges : []) {
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
    if (range.end <= offset) left.push({ ...range });
    else if (range.start >= offset) {
      right.push({ ...range, start: range.start - offset, end: range.end - offset });
    } else {
      left.push({ ...range, end: offset });
      right.push({ ...range, start: 0, end: range.end - offset });
    }
  }
  return [left, right];
}

/** Shift ranges from appended text into the target element's coordinate space. */
export function appendOffsetRanges(left, right, offset) {
  const shift = Math.max(0, offset);
  return [
    ...(Array.isArray(left) ? left.map((range) => ({ ...range })) : []),
    ...(Array.isArray(right)
      ? right.map((range) => ({ ...range, start: range.start + shift, end: range.end + shift }))
      : []),
  ];
}

/** Pure text replacement paired with arbitrary anchored ranges. */
export function replaceTextWithRanges(text, ranges, start, end, replacement) {
  const source = String(text ?? '');
  const safeStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(0, Math.floor(end)) : safeStart;
  const from = Math.min(source.length, Math.min(safeStart, safeEnd));
  const to = Math.min(source.length, Math.max(safeStart, safeEnd));
  const inserted = String(replacement ?? '');
  return {
    text: source.slice(0, from) + inserted + source.slice(to),
    ranges: adjustRangesForReplacement(ranges, from, to, inserted.length),
  };
}

/** Split style ranges for an element cut at character offset `at`. */
export function splitStyles(styles, at) {
  return splitOffsetRanges(styles, at);
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
