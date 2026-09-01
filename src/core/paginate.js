/**
 * paginate.js — The formatting engine.
 *
 * Produces the exact set of printed lines for a screenplay. Because Courier is
 * metrically fixed, wrapping is done by counting characters, not by measuring
 * rendered text. The screen renderer and the PDF writer both consume this same
 * output, which is why the page count you see is the page count you print.
 *
 * Break rules implemented here (all standard production practice):
 *   - A scene heading may not be the last thing on a page.
 *   - A character cue may not be orphaned from its dialogue.
 *   - A parenthetical may not be separated from the dialogue it modifies.
 *   - Split dialogue gets "(MORE)" below and "NAME (CONT'D)" above.
 *   - Action and dialogue keep at least two lines on either side of a break.
 *   - A transition is never stranded alone at the top of a page.
 */

import {
  ElementType,
  applyCase,
  DUAL,
  charsBetween,
} from './format.js';
import { baseCharacterName, characterExtension } from './model.js';

const SPLITTABLE = new Set([
  ElementType.ACTION,
  ElementType.DIALOGUE,
  ElementType.GENERAL,
]);

/* ------------------------------------------------------------------ *
 * Text wrapping
 * ------------------------------------------------------------------ */

/**
 * Greedy word wrap at a fixed character width.
 * @returns {{text:string,start:number,end:number}[]} one entry per printed line
 */
export function wrapText(text, width) {
  if (!text) return [{ text: '', start: 0, end: 0 }];

  const lines = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    // Consume up to `width` characters, then walk back to a space.
    let end = Math.min(i + width, n);

    if (end < n) {
      let brk = -1;
      for (let j = end; j > i; j -= 1) {
        if (text[j] === ' ' || text[j] === '\t') {
          brk = j;
          break;
        }
      }
      // A single word longer than the line gets hard-broken.
      if (brk > i) end = brk;
    }

    lines.push({
      text: text.slice(i, end).replace(/\s+$/, ''),
      start: i,
      end,
    });

    // Skip the space we broke on.
    i = end;
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i += 1;
  }

  return lines.length ? lines : [{ text: '', start: 0, end: 0 }];
}

/** Clip inline style ranges to a line and rebase them to line-local offsets. */
function clipStyles(styles, start, end) {
  if (!styles || !styles.length) return [];
  const out = [];
  for (const r of styles) {
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    if (e > s) {
      out.push({
        start: s - start,
        end: e - start,
        bold: !!r.bold,
        italic: !!r.italic,
        underline: !!r.underline,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Blocks
 *
 * Dual dialogue occupies two side-by-side columns that must be paginated as a
 * single unit, so elements are grouped into blocks before packing.
 * ------------------------------------------------------------------ */

function buildBlocks(elements) {
  const blocks = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i];
    if (el.dual === 'left') {
      const left = [];
      const right = [];
      while (i < elements.length && elements[i].dual === 'left') {
        left.push(elements[i]);
        i += 1;
      }
      while (i < elements.length && elements[i].dual === 'right') {
        right.push(elements[i]);
        i += 1;
      }
      blocks.push({ kind: 'dual', left, right });
    } else {
      blocks.push({ kind: 'single', element: el });
      i += 1;
    }
  }
  return blocks;
}

/* ------------------------------------------------------------------ *
 * Laying out a single element into lines
 * ------------------------------------------------------------------ */

function layoutElement(el, styles, opts = {}) {
  const spec = styles.elements[el.type];
  const left = opts.left ?? spec.left;
  const right = opts.right ?? spec.right;
  const width = charsBetween(left, right);

  // Wrap the ORIGINAL text so that charStart/charEnd index the model string
  // the editor holds; case is a presentation rule applied per printed line.
  // (Upper-casing never changes character count for the Latin range used in
  // screenplays, so the two agree line for line.)
  const text = el.text || '';
  const wrapped = wrapText(text, width);

  return wrapped.map((w, idx) => ({
    kind: 'text',
    elementId: el.id,
    type: el.type,
    text: applyCase(w.text, spec),
    rawText: w.text,
    lineInElement: idx,
    lineCount: wrapped.length,
    charStart: w.start,
    charEnd: w.end,
    isFirst: idx === 0,
    isLast: idx === wrapped.length - 1,
    x: left,
    right,
    width,
    align: spec.align,
    bold: spec.bold,
    italic: spec.italic,
    underline: spec.underline,
    styles: clipStyles(el.styles, w.start, w.end),
    dual: el.dual || null,
    sceneNumber: el.type === ElementType.SCENE_HEADING ? el.sceneNumber : null,
    revisionId: el.revisionId || null,
    omitted: !!el.omitted,
    hasNotes: (el.notes && el.notes.length > 0) || false,
    alternateKey: el.alternateDialogue
      ? `${el.alternateDialogue.activeId}:${el.alternateDialogue.choices?.length || 0}`
      : '',
  }));
}

function spaceBefore(el, styles) {
  return styles.elements[el.type].spaceBefore ?? 1;
}

/**
 * Suppress the blank line inside a dialogue run so CHARACTER / PARENTHETICAL /
 * DIALOGUE stay tight, and avoid doubling space between stacked elements.
 */
function effectiveSpaceBefore(el, prev, styles) {
  if (!prev) return 0;
  const base = spaceBefore(el, styles);

  const inSpeech =
    (prev.type === ElementType.CHARACTER &&
      (el.type === ElementType.DIALOGUE ||
        el.type === ElementType.PARENTHETICAL)) ||
    (prev.type === ElementType.PARENTHETICAL &&
      el.type === ElementType.DIALOGUE) ||
    (prev.type === ElementType.DIALOGUE &&
      el.type === ElementType.PARENTHETICAL);

  if (inSpeech) return 0;
  return base;
}

/* ------------------------------------------------------------------ *
 * Look-ahead used by keep-with-next
 * ------------------------------------------------------------------ */

/**
 * How many body lines are required to satisfy `want` lines of content
 * following block index `bi` — walking forward across elements so that a
 * CHARACTER cue followed by a one-line PARENTHETICAL still pulls real dialogue
 * onto the page with it.
 */
function linesNeededAfter(blocks, bi, want, styles, prevEl) {
  let need = 0;
  let got = 0;
  let prev = prevEl;

  for (let k = bi + 1; k < blocks.length && got < want; k += 1) {
    const b = blocks[k];
    const els = b.kind === 'dual' ? [...b.left, ...b.right] : [b.element];
    for (const el of els) {
      const sb = effectiveSpaceBefore(el, prev, styles);
      const lines = layoutElement(el, styles).length;
      need += sb + Math.min(lines, want - got);
      got += lines;
      prev = el;
      if (got >= want) break;
    }
  }
  return need;
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

/**
 * @param {object} doc
 * @param {object} styles  from resolveStyles()
 * @returns {{pages: Array, totalPages: number, lineIndex: Map}}
 */
export function paginate(doc, styles) {
  const perPage = styles.page.linesPerPage;
  const blocks = buildBlocks(doc.elements);
  const pages = [];

  let cur = [];
  let cursor = 0; // lines consumed on the current page
  let prevEl = null;
  let contdCue = null; // pending "NAME (CONT'D)" for the top of the next page

  const activeRevisions = new Set(
    (doc.revisions?.sets || []).filter((s) => s.active !== false).map((s) => s.id)
  );

  function pushPage() {
    pages.push({ lines: cur, startElementId: cur.find((l) => l.elementId)?.elementId || null });
    cur = [];
    cursor = 0;
  }

  function emit(line) {
    cur.push(line);
    cursor += 1;
  }

  function emitBlank(n) {
    for (let i = 0; i < n; i += 1) {
      if (cursor === 0) return; // never open a page with blank lines
      cur.push({ kind: 'blank' });
      cursor += 1;
    }
  }

  function startNewPage() {
    pushPage();
    if (contdCue) {
      const { el, name } = contdCue;
      const spec = styles.elements[ElementType.CHARACTER];
      emit({
        kind: 'contd',
        elementId: el.id,
        type: ElementType.CHARACTER,
        text: name,
        x: el.dual
          ? (el.dual === 'left' ? DUAL.leftLeft : DUAL.rightLeft) + DUAL.characterInset
          : spec.left,
        align: 'left',
        styles: [],
        synthetic: true,
      });
      contdCue = null;
    }
  }

  for (let bi = 0; bi < blocks.length; bi += 1) {
    const block = blocks[bi];

    if (block.kind === 'dual') {
      placeDual(block, bi);
      continue;
    }

    const el = block.element;

    if (el.type === ElementType.ACT_BREAK && styles.elements[el.type].startsNewPage && cursor > 0) {
      startNewPage();
    }

    const lines = layoutElement(el, styles);
    const sb = effectiveSpaceBefore(el, prevEl, styles);
    const remaining = perPage - cursor;

    // --- Does the whole element fit, including any keep-with-next demand? ---
    const spec = styles.elements[el.type];
    const keep = spec.keepWithNext || 0;
    const keepNeed = keep ? linesNeededAfter(blocks, bi, keep, styles, el) : 0;

    if (sb + lines.length + keepNeed <= remaining) {
      emitBlank(sb);
      lines.forEach(decorateAndEmit);
      prevEl = el;
      continue;
    }

    // --- It does not fit. Can it be split? ---
    const canSplit = SPLITTABLE.has(el.type) && !el.dual;
    if (canSplit && cursor > 0) {
      const isDialogue = el.type === ElementType.DIALOGUE;
      const reserve = isDialogue ? 1 : 0; // room for "(MORE)"
      const avail = remaining - sb - reserve;
      const minBefore = spec.minLinesBeforeBreak ?? 2;
      const minAfter = spec.minLinesAfterBreak ?? 2;

      if (avail >= minBefore && lines.length - avail >= minAfter) {
        emitBlank(sb);
        for (let i = 0; i < avail; i += 1) decorateAndEmit(lines[i]);

        if (isDialogue) {
          emit({
            kind: 'more',
            elementId: el.id,
            type: ElementType.DIALOGUE,
            text: '(MORE)',
            x: styles.elements[ElementType.PARENTHETICAL].left,
            align: 'left',
            styles: [],
            synthetic: true,
          });
          contdCue = { el, name: contdName(doc, el) };
        }

        startNewPage();
        for (let i = avail; i < lines.length; i += 1) decorateAndEmit(lines[i]);
        prevEl = el;
        continue;
      }
    }

    // --- Push the whole element to the next page. ---
    if (cursor > 0) {
      startNewPage();
    }
    // At the top of a fresh page it must be placed regardless; if it is still
    // too tall (a pathological single paragraph), split it hard.
    if (lines.length > perPage) {
      let i = 0;
      while (i < lines.length) {
        const room = perPage - cursor;
        const take = Math.min(room, lines.length - i);
        for (let k = 0; k < take; k += 1) decorateAndEmit(lines[i + k]);
        i += take;
        if (i < lines.length) startNewPage();
      }
    } else {
      lines.forEach(decorateAndEmit);
    }
    prevEl = el;
  }

  if (cur.length) pushPage();
  if (!pages.length) pages.push({ lines: [], startElementId: null });

  /* ---------- decoration helpers (closures over the loop state) ---------- */

  function decorateAndEmit(line) {
    const marked =
      line.revisionId && activeRevisions.has(line.revisionId)
        ? revisionMarkFor(doc, line.revisionId)
        : null;
    emit({ ...line, revisionMark: doc.revisions?.showMarks ? marked : null });
  }

  function placeDual(block, bi) {
    const leftLines = block.left.flatMap((el, i) =>
      layoutElement(el, styles, dualBounds(el, 'left')).map((l) => ({
        ...l,
        dualIndex: i,
      }))
    );
    const rightLines = block.right.flatMap((el, i) =>
      layoutElement(el, styles, dualBounds(el, 'right')).map((l) => ({
        ...l,
        dualIndex: i,
      }))
    );
    const height = Math.max(leftLines.length, rightLines.length);
    const sb = effectiveSpaceBefore(block.left[0] || block.right[0], prevEl, styles);

    if (cursor > 0 && sb + height > perPage - cursor) startNewPage();
    emitBlank(sb);

    for (let i = 0; i < height; i += 1) {
      const l = leftLines[i] || null;
      const r = rightLines[i] || null;
      cur.push({ kind: 'dualrow', left: l, right: r });
      cursor += 1;
    }
    prevEl = block.right[block.right.length - 1] || block.left[block.left.length - 1];
  }

  function dualBounds(el, side) {
    const isCue = el.type === ElementType.CHARACTER;
    if (side === 'left') {
      return {
        left: DUAL.leftLeft + (isCue ? DUAL.characterInset : 0),
        right: DUAL.leftRight,
      };
    }
    return {
      left: DUAL.rightLeft + (isCue ? DUAL.characterInset : 0),
      right: DUAL.rightRight,
    };
  }

  /* ---------- page numbering, including locked A-pages ---------- */

  assignPageNumbers(pages, doc);

  const lineIndex = new Map();
  pages.forEach((p, pi) => {
    p.lines.forEach((l, li) => {
      const id = l.elementId || l.left?.elementId || l.right?.elementId;
      if (!id) return;
      if (!lineIndex.has(id)) lineIndex.set(id, { page: pi, line: li });
    });
  });

  return { pages, totalPages: pages.length, lineIndex, styles };
}

function contdName(doc, dialogueEl) {
  // Walk back to the cue that owns this dialogue.
  const idx = doc.elements.findIndex((e) => e.id === dialogueEl.id);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const e = doc.elements[i];
    if (e.type === ElementType.CHARACTER) {
      const ext = characterExtension(e.text);
      const base = baseCharacterName(e.text);
      if (/CONT'D/i.test(ext)) return e.text.toUpperCase();
      return ext ? `${base} (${ext.toUpperCase()}) (CONT'D)` : `${base} (CONT'D)`;
    }
    if (e.type === ElementType.SCENE_HEADING) break;
  }
  return "(CONT'D)";
}

function revisionMarkFor(doc, revisionId) {
  const set = (doc.revisions?.sets || []).find((s) => s.id === revisionId);
  return set?.mark || '*';
}

/**
 * Number the pages. When pages are locked for production, pages inserted after
 * a locked anchor become A-pages (12, 12A, 12B, 13...) so that existing
 * distributed pages keep their numbers.
 */
function assignPageNumbers(pages, doc) {
  const lock = doc.pageLock;
  if (!lock?.locked || !lock.anchors?.length) {
    pages.forEach((p, i) => {
      p.number = String(i + 1);
      p.isAPage = false;
    });
    return;
  }

  const anchorByElement = new Map(lock.anchors.map((a) => [a.elementId, a.page]));
  let lastLabel = '0';
  let suffix = 0;

  pages.forEach((p, i) => {
    const anchor = p.startElementId ? anchorByElement.get(p.startElementId) : null;
    if (anchor) {
      p.number = anchor;
      p.isAPage = false;
      lastLabel = anchor;
      suffix = 0;
    } else if (i === 0) {
      p.number = '1';
      p.isAPage = false;
      lastLabel = '1';
      suffix = 0;
    } else {
      p.number = `${lastLabel}${letterSuffix(suffix)}`;
      p.isAPage = true;
      suffix += 1;
    }
  });
}

function letterSuffix(n) {
  // 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA
  let s = '';
  let v = n;
  do {
    s = String.fromCharCode(65 + (v % 26)) + s;
    v = Math.floor(v / 26) - 1;
  } while (v >= 0);
  return s;
}

/* ------------------------------------------------------------------ *
 * Scene numbering
 * ------------------------------------------------------------------ */

/**
 * Assign scene numbers in place. Locked numbers are preserved and newly
 * inserted scenes take A-numbers (12, 12A, 13) exactly as a shooting script
 * requires, so existing scene numbers never shift under a crew's feet.
 */
export function assignSceneNumbers(doc) {
  const cfg = doc.sceneNumbering;
  const headings = doc.elements.filter((e) => e.type === ElementType.SCENE_HEADING);

  if (!cfg.enabled) {
    headings.forEach((h) => {
      if (!h.sceneNumberLocked) h.sceneNumber = null;
    });
    return doc;
  }

  if (!cfg.locked) {
    let n = cfg.startAt || 1;
    headings.forEach((h) => {
      h.sceneNumber = String(n);
      n += 1;
    });
    return doc;
  }

  // Locked: keep every locked number, letter-suffix the new ones.
  let lastLocked = null;
  let suffix = 0;
  headings.forEach((h) => {
    if (h.sceneNumberLocked && h.sceneNumber) {
      lastLocked = h.sceneNumber;
      suffix = 0;
    } else {
      h.sceneNumber = lastLocked
        ? `${lastLocked}${letterSuffix(suffix)}`
        : String((cfg.startAt || 1) + suffix);
      suffix += 1;
    }
  });
  return doc;
}

/** Freeze the current numbers so future edits produce A-scenes. */
export function lockSceneNumbers(doc) {
  doc.elements
    .filter((e) => e.type === ElementType.SCENE_HEADING)
    .forEach((h) => {
      if (h.sceneNumber) h.sceneNumberLocked = true;
    });
  doc.sceneNumbering.locked = true;
  return doc;
}

/** Freeze current page boundaries so future edits produce A-pages. */
export function lockPages(doc, pagination) {
  doc.pageLock.locked = true;
  doc.pageLock.anchors = pagination.pages
    .filter((p) => p.startElementId)
    .map((p) => ({ page: p.number, elementId: p.startElementId }));
  return doc;
}

export function unlockPages(doc) {
  doc.pageLock.locked = false;
  doc.pageLock.anchors = [];
  return doc;
}

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/** One page ≈ one minute of screen time is the working assumption. */
export function estimateRuntime(pagination) {
  const pages = pagination.totalPages;
  const minutes = pages;
  return {
    pages,
    minutes,
    label: `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
  };
}
