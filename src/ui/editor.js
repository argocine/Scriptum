/**
 * editor.js — The editing surface.
 *
 * Owns the document, the pagination, and every mutation path. The DOM is
 * treated as a projection: ordinary typing is allowed to happen natively and
 * is read back afterwards, while any operation that changes *structure*
 * (Enter, Tab, merges, multi-element deletes, paste) is intercepted and
 * performed on the model instead.
 */

import {
  ElementType,
  ELEMENT_ORDER,
  resolveStyles,
} from '../core/format.js';
import {
  createDocument,
  createElement,
  cloneDocument,
  getElement,
  indexOfElement,
  detectType,
  nextTypeOnEnter,
  nextTypeOnTab,
  normalizeStyles,
  splitStyles,
  stylesAt,
  countWords,
  touch,
} from '../core/model.js';
import { paginate, assignSceneNumbers } from '../core/paginate.js';
import { Renderer, cssEscape } from './render.js';
import { buildVocabulary, suggest, previousSpeaker } from '../core/autocomplete.js';

const GUTTER_SELECTOR = '.scene-num, .revision-mark, .note-flag';
const TYPING_COALESCE_MS = 600;
const HISTORY_LIMIT = 80;

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

function closestPart(node) {
  let n = node;
  while (n && n !== document.body) {
    if (n.nodeType === 1 && n.classList?.contains('el')) return n;
    n = n.parentNode;
  }
  return null;
}

function isGutter(node) {
  return node.nodeType === 1 && node.matches?.(GUTTER_SELECTOR);
}

/** Text nodes belonging to a part, excluding gutter decorations. */
function partTextNodes(part) {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out.push(child);
      else if (child.nodeType === 1 && !isGutter(child)) walk(child);
    }
  };
  walk(part);
  return out;
}

function partText(part) {
  return partTextNodes(part)
    .map((n) => n.nodeValue)
    .join('');
}

/** Read text plus inline emphasis out of a rendered part. */
function readPart(part) {
  let text = '';
  const styles = [];
  const walk = (node, active) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const start = text.length;
        text += child.nodeValue;
        if (active.bold || active.italic || active.underline) {
          styles.push({ start, end: text.length, ...active });
        }
      } else if (child.nodeType === 1 && !isGutter(child)) {
        const tag = child.tagName.toLowerCase();
        const next = {
          bold: active.bold || tag === 'b' || tag === 'strong' || isBold(child),
          italic: active.italic || tag === 'i' || tag === 'em' || isItalic(child),
          underline: active.underline || tag === 'u' || isUnderline(child),
        };
        if (tag === 'br') text += '\n';
        walk(child, next);
      }
    }
  };
  walk(part, { bold: false, italic: false, underline: false });
  return { text: text.replace(/\n/g, ' '), styles };
}

function isBold(el) {
  const w = el.style?.fontWeight;
  return w === 'bold' || w === '700' || Number(w) >= 600;
}
function isItalic(el) {
  return el.style?.fontStyle === 'italic';
}
function isUnderline(el) {
  return (el.style?.textDecoration || '').includes('underline');
}

/** Character offset of (node, offset) within its part. */
function offsetInPart(part, node, offset) {
  if (node === part) {
    // Offset counted in child nodes — sum the text before it.
    let total = 0;
    for (let i = 0; i < offset && i < part.childNodes.length; i += 1) {
      const c = part.childNodes[i];
      if (isGutter(c)) continue;
      total += c.textContent.length;
    }
    return total;
  }
  let total = 0;
  for (const tn of partTextNodes(part)) {
    if (tn === node) return total + offset;
    total += tn.nodeValue.length;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

export class ScriptEditor {
  constructor({ container, scroller, autocompleteEl, onUpdate }) {
    this.container = container;
    this.scroller = scroller;
    this.acEl = autocompleteEl;
    this.onUpdate = onUpdate || (() => {});

    this.doc = createDocument();
    this.styles = resolveStyles();
    this.renderer = new Renderer(container, scroller);
    this.pagination = null;
    this.vocab = { characters: [], locations: [], times: [] };

    this.history = [];
    this.future = [];
    this.lastTypingAt = 0;
    this.lastTypingId = null;
    this.suppressInput = false;

    this.ac = { open: false, items: [], index: 0, replaceFrom: 0, elementId: null };
    this.findState = { query: '', matches: [], index: -1, caseSensitive: false };

    this.bind();
  }

  /* ---------------- lifecycle ---------------- */

  load(doc, { resetHistory = true } = {}) {
    this.doc = doc;
    this.styles = resolveStyles(doc.styleOverrides, doc.pageOverrides);
    if (resetHistory) {
      this.history = [];
      this.future = [];
    }
    assignSceneNumbers(this.doc);
    this.renderer.reset();
    this.rebuildVocab();
    this.repaginate();
    this.render({ titleDirty: true });
    this.emit();
  }

  refreshStyles() {
    this.styles = resolveStyles(this.doc.styleOverrides, this.doc.pageOverrides);
    this.renderer.reset();
    this.repaginate();
    this.render({ titleDirty: true });
    this.emit();
  }

  rebuildVocab() {
    this.vocab = buildVocabulary(this.doc);
  }

  repaginate() {
    this.pagination = paginate(this.doc, this.styles);
    return this.pagination;
  }

  render(opts = {}) {
    const caret = opts.keepCaret === false ? null : this.getCaret();
    const focusPage =
      caret && this.pagination.lineIndex.has(caret.elementId)
        ? this.pagination.lineIndex.get(caret.elementId).page
        : this.renderer.currentPageIndex();

    const rebuilt = this.renderer.render(this.doc, this.pagination, this.styles, {
      ...opts,
      focusPage,
    });

    if (caret && rebuilt > 0) this.setCaret(caret.elementId, caret.offset);
    return rebuilt;
  }

  /** Full rebuild — used after undo, import, or a style change. */
  hardRender(caret) {
    const keep = caret || this.getCaret();
    this.renderer.reset();
    // Renumber here too: this is the path taken when settings change rather
    // than when the text does, and scene numbering is one of those settings.
    assignSceneNumbers(this.doc);
    this.repaginate();
    this.renderer.render(this.doc, this.pagination, this.styles, { titleDirty: true });
    if (keep) this.setCaret(keep.elementId, keep.offset);
    this.emit();
  }

  /**
   * @param {{viewOnly?: boolean}} [extra] `viewOnly` marks an update that
   *   changed nothing in the document — moving the caret, or scrolling — so
   *   the shell can refresh its readouts without flagging the file as edited.
   */
  emit(extra) {
    this.onUpdate(this, extra);
  }

  /* ---------------- history ---------------- */

  snapshot(coalesceKey = null) {
    const now = Date.now();
    if (
      coalesceKey &&
      coalesceKey === this.lastTypingId &&
      now - this.lastTypingAt < TYPING_COALESCE_MS
    ) {
      this.lastTypingAt = now;
      return;
    }
    this.lastTypingId = coalesceKey;
    this.lastTypingAt = now;

    this.history.push(cloneDocument(this.doc));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future.length = 0;
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(cloneDocument(this.doc));
    this.doc = this.history.pop();
    this.lastTypingId = null;
    this.rebuildVocab();
    this.hardRender(null);
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(cloneDocument(this.doc));
    this.doc = this.future.pop();
    this.lastTypingId = null;
    this.rebuildVocab();
    this.hardRender(null);
  }

  /** Run a structural change with undo support and a full refresh. */
  commit(fn, { rebuildVocab = false } = {}) {
    this.snapshot(null);
    const caret = fn();
    touch(this.doc);
    assignSceneNumbers(this.doc);
    if (rebuildVocab) this.rebuildVocab();
    this.repaginate();
    this.render({ keepCaret: false });
    if (caret) this.setCaret(caret.elementId, caret.offset, { scroll: true });
    this.emit();
  }

  /* ---------------- caret ---------------- */

  getCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const part = closestPart(range.startContainer);
    if (!part) return null;
    const base = Number(part.dataset.start) || 0;
    return {
      elementId: part.dataset.el,
      offset: base + offsetInPart(part, range.startContainer, range.startOffset),
      collapsed: sel.isCollapsed,
    };
  }

  /** Both ends of the selection, in document order, as model coordinates. */
  getSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const sp = closestPart(range.startContainer);
    const ep = closestPart(range.endContainer);
    if (!sp || !ep) return null;

    const start = {
      elementId: sp.dataset.el,
      offset: (Number(sp.dataset.start) || 0) + offsetInPart(sp, range.startContainer, range.startOffset),
    };
    const end = {
      elementId: ep.dataset.el,
      offset: (Number(ep.dataset.start) || 0) + offsetInPart(ep, range.endContainer, range.endOffset),
    };
    const si = indexOfElement(this.doc, start.elementId);
    const ei = indexOfElement(this.doc, end.elementId);
    if (si === -1 || ei === -1) return null;

    const ordered =
      si < ei || (si === ei && start.offset <= end.offset)
        ? { start, end, startIndex: si, endIndex: ei }
        : { start: end, end: start, startIndex: ei, endIndex: si };
    ordered.collapsed =
      ordered.start.elementId === ordered.end.elementId &&
      ordered.start.offset === ordered.end.offset;
    return ordered;
  }

  setCaret(elementId, offset, { scroll = false } = {}) {
    const parts = [...this.container.querySelectorAll(`.el[data-el="${cssEscape(elementId)}"]`)];
    if (!parts.length) return false;

    let target = parts[0];
    for (const p of parts) {
      const s = Number(p.dataset.start) || 0;
      const e = Number(p.dataset.end) || 0;
      if (offset >= s && offset <= e) {
        target = p;
        if (offset < e) break;
      }
    }

    const base = Number(target.dataset.start) || 0;
    let local = Math.max(0, offset - base);
    const nodes = partTextNodes(target);

    const range = document.createRange();
    if (!nodes.length) {
      range.setStart(target, 0);
    } else {
      let acc = 0;
      let placed = false;
      for (const n of nodes) {
        const len = n.nodeValue.length;
        if (local <= acc + len) {
          range.setStart(n, Math.max(0, local - acc));
          placed = true;
          break;
        }
        acc += len;
      }
      if (!placed) {
        const last = nodes[nodes.length - 1];
        range.setStart(last, last.nodeValue.length);
      }
    }
    range.collapse(true);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    if (scroll) this.scrollCaretIntoView();
    return true;
  }

  scrollCaretIntoView() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const part = closestPart(sel.getRangeAt(0).startContainer);
    if (!part) return;
    const r = part.getBoundingClientRect();
    const host = this.scroller.getBoundingClientRect();
    if (r.top < host.top + 60) {
      this.scroller.scrollTop += r.top - host.top - 120;
    } else if (r.bottom > host.bottom - 60) {
      this.scroller.scrollTop += r.bottom - host.bottom + 120;
    }
  }

  /* ---------------- DOM → model ---------------- */

  readElementFromDOM(elementId) {
    const parts = [...this.container.querySelectorAll(`.el[data-el="${cssEscape(elementId)}"]`)];
    let text = '';
    const styles = [];
    for (const p of parts) {
      const r = readPart(p);
      for (const s of r.styles) {
        styles.push({ ...s, start: s.start + text.length, end: s.end + text.length });
      }
      text += r.text;
    }
    return { text, styles };
  }

  syncElementFromDOM(elementId) {
    const el = getElement(this.doc, elementId);
    if (!el) return null;
    const { text, styles } = this.readElementFromDOM(elementId);
    el.text = text;
    el.styles = normalizeStyles(styles, text.length);
    this.markRevised(el);
    return el;
  }

  markRevised(el) {
    const cur = this.doc.revisions?.current;
    if (cur) el.revisionId = cur;
  }

  /* ---------------- structural commands ---------------- */

  currentElement() {
    const c = this.getCaret();
    return c ? getElement(this.doc, c.elementId) : null;
  }

  setElementType(type, elementId = null) {
    const caret = this.getCaret();
    const id = elementId || caret?.elementId;
    if (!id) return;
    this.commit(() => {
      const el = getElement(this.doc, id);
      if (!el) return null;
      el.type = type;
      this.markRevised(el);
      return caret ? { elementId: id, offset: Math.min(caret.offset, el.text.length) } : null;
    }, { rebuildVocab: true });
  }

  /** Enter: split at the caret, or open a new element of the natural next type. */
  handleEnter() {
    const sel = this.getSelection();
    if (!sel) return;

    this.commit(() => {
      if (!sel.collapsed) this.deleteRangeInModel(sel);

      const id = sel.start.elementId;
      const idx = indexOfElement(this.doc, id);
      const el = this.doc.elements[idx];
      if (!el) return null;
      const offset = Math.min(sel.start.offset, el.text.length);

      // Enter on an empty cue or parenthetical drops back to Action rather
      // than stacking more empty speech elements.
      if (
        !el.text.trim() &&
        (el.type === ElementType.CHARACTER ||
          el.type === ElementType.PARENTHETICAL ||
          el.type === ElementType.TRANSITION)
      ) {
        el.type = ElementType.ACTION;
        return { elementId: el.id, offset: 0 };
      }

      const atEnd = offset >= el.text.length;
      const atStart = offset === 0 && el.text.length > 0;

      if (atEnd) {
        const next = createElement(nextTypeOnEnter(el.type));
        this.markRevised(next);
        this.doc.elements.splice(idx + 1, 0, next);
        return { elementId: next.id, offset: 0 };
      }

      if (atStart) {
        const above = createElement(el.type);
        this.markRevised(above);
        this.doc.elements.splice(idx, 0, above);
        return { elementId: el.id, offset: 0 };
      }

      // Mid-text split keeps the same type on both halves.
      const [ls, rs] = splitStyles(el.styles, offset);
      const rest = createElement(el.type, el.text.slice(offset), { styles: rs, dual: el.dual });
      el.text = el.text.slice(0, offset);
      el.styles = ls;
      this.markRevised(el);
      this.markRevised(rest);
      this.doc.elements.splice(idx + 1, 0, rest);
      return { elementId: rest.id, offset: 0 };
    }, { rebuildVocab: true });
  }

  handleTab(shift) {
    const caret = this.getCaret();
    if (!caret) return;
    const el = getElement(this.doc, caret.elementId);
    if (!el) return;

    // A finished character cue tabs into a parenthetical, matching the way
    // most writers actually move through a speech.
    if (el.type === ElementType.CHARACTER && el.text.trim() && !shift) {
      this.commit(() => {
        const idx = indexOfElement(this.doc, el.id);
        const p = createElement(ElementType.PARENTHETICAL, '()');
        this.markRevised(p);
        this.doc.elements.splice(idx + 1, 0, p);
        return { elementId: p.id, offset: 1 };
      });
      return;
    }

    const isEmpty = !el.text.trim();
    let next;
    if (shift) {
      const i = ELEMENT_ORDER.indexOf(el.type);
      next = ELEMENT_ORDER[(i - 1 + ELEMENT_ORDER.length) % ELEMENT_ORDER.length];
    } else {
      next = nextTypeOnTab(el.type, isEmpty);
      if (next === el.type) {
        const i = ELEMENT_ORDER.indexOf(el.type);
        next = ELEMENT_ORDER[(i + 1) % ELEMENT_ORDER.length];
      }
    }
    this.setElementType(next);
  }

  /** Backspace at offset 0 — merge into the previous element. */
  handleMergeBack() {
    const caret = this.getCaret();
    if (!caret) return;
    const idx = indexOfElement(this.doc, caret.elementId);
    if (idx <= 0) return;

    this.commit(() => {
      const el = this.doc.elements[idx];
      const prev = this.doc.elements[idx - 1];

      // An empty element simply disappears.
      if (!el.text.length) {
        this.doc.elements.splice(idx, 1);
        return { elementId: prev.id, offset: prev.text.length };
      }

      // A non-empty element with a different type first surrenders its type;
      // pressing again merges the text. This mirrors how word processors let
      // you back out of a heading without losing the words.
      if (el.type !== prev.type && el.type !== ElementType.ACTION) {
        el.type = ElementType.ACTION;
        return { elementId: el.id, offset: 0 };
      }

      const at = prev.text.length;
      prev.text += el.text;
      prev.styles = normalizeStyles(
        [...prev.styles, ...el.styles.map((s) => ({ ...s, start: s.start + at, end: s.end + at }))],
        prev.text.length
      );
      this.markRevised(prev);
      this.doc.elements.splice(idx, 1);
      return { elementId: prev.id, offset: at };
    }, { rebuildVocab: true });
  }

  /** Delete at the end of an element — pull the next element up. */
  handleMergeForward() {
    const caret = this.getCaret();
    if (!caret) return;
    const idx = indexOfElement(this.doc, caret.elementId);
    if (idx === -1 || idx >= this.doc.elements.length - 1) return;

    this.commit(() => {
      const el = this.doc.elements[idx];
      const next = this.doc.elements[idx + 1];
      const at = el.text.length;
      el.text += next.text;
      el.styles = normalizeStyles(
        [...el.styles, ...next.styles.map((s) => ({ ...s, start: s.start + at, end: s.end + at }))],
        el.text.length
      );
      this.markRevised(el);
      this.doc.elements.splice(idx + 1, 1);
      return { elementId: el.id, offset: at };
    }, { rebuildVocab: true });
  }

  /** Remove a multi-element selection from the model. Returns the caret. */
  deleteRangeInModel(sel) {
    const { startIndex, endIndex, start, end } = sel;
    const first = this.doc.elements[startIndex];
    const last = this.doc.elements[endIndex];
    if (!first || !last) return null;

    if (startIndex === endIndex) {
      const [ls] = splitStyles(first.styles, start.offset);
      const [, rs] = splitStyles(first.styles, end.offset);
      first.text = first.text.slice(0, start.offset) + first.text.slice(end.offset);
      first.styles = normalizeStyles(
        [...ls, ...rs.map((s) => ({ ...s, start: s.start + start.offset, end: s.end + start.offset }))],
        first.text.length
      );
      this.markRevised(first);
      return { elementId: first.id, offset: start.offset };
    }

    const [headStyles] = splitStyles(first.styles, start.offset);
    const [, tailStyles] = splitStyles(last.styles, end.offset);
    const head = first.text.slice(0, start.offset);
    const tail = last.text.slice(end.offset);

    first.text = head + tail;
    first.styles = normalizeStyles(
      [
        ...headStyles,
        ...tailStyles.map((s) => ({ ...s, start: s.start + head.length, end: s.end + head.length })),
      ],
      first.text.length
    );
    this.markRevised(first);
    this.doc.elements.splice(startIndex + 1, endIndex - startIndex);
    return { elementId: first.id, offset: head.length };
  }

  /* ---------------- inline emphasis ---------------- */

  toggleStyle(attr) {
    const sel = this.getSelection();
    if (!sel || sel.collapsed) return;

    this.commit(() => {
      const active = this.styleActive(attr, sel);
      for (let i = sel.startIndex; i <= sel.endIndex; i += 1) {
        const el = this.doc.elements[i];
        const from = i === sel.startIndex ? sel.start.offset : 0;
        const to = i === sel.endIndex ? sel.end.offset : el.text.length;
        if (to <= from) continue;

        if (active) {
          el.styles = removeAttr(el.styles, from, to, attr);
        } else {
          el.styles = normalizeStyles(
            [...el.styles, { start: from, end: to, [attr]: true }],
            el.text.length
          );
        }
        this.markRevised(el);
      }
      return null;
    });

    // Restore the visual selection so a writer can stack ⌘B then ⌘I.
    this.selectRange(sel);
  }

  styleActive(attr, sel) {
    for (let i = sel.startIndex; i <= sel.endIndex; i += 1) {
      const el = this.doc.elements[i];
      const from = i === sel.startIndex ? sel.start.offset : 0;
      const to = i === sel.endIndex ? sel.end.offset : el.text.length;
      for (let c = from; c < to; c += 1) {
        if (!stylesAt(el.styles, c)[attr]) return false;
      }
    }
    return true;
  }

  selectRange(sel) {
    const startPart = this.partContaining(sel.start.elementId, sel.start.offset);
    const endPart = this.partContaining(sel.end.elementId, sel.end.offset);
    if (!startPart || !endPart) return;
    const a = locateOffset(startPart, sel.start.offset - (Number(startPart.dataset.start) || 0));
    const b = locateOffset(endPart, sel.end.offset - (Number(endPart.dataset.start) || 0));
    if (!a || !b) return;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  partContaining(elementId, offset) {
    const parts = [...this.container.querySelectorAll(`.el[data-el="${cssEscape(elementId)}"]`)];
    for (const p of parts) {
      const s = Number(p.dataset.start) || 0;
      const e = Number(p.dataset.end) || 0;
      if (offset >= s && offset <= e) return p;
    }
    return parts[parts.length - 1] || null;
  }

  /* ---------------- paste ---------------- */

  handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const sel = this.getSelection();
    if (!sel) return;

    // A single line pastes as plain text into the current element.
    if (lines.length === 1) {
      this.commit(() => {
        const caret = sel.collapsed
          ? { elementId: sel.start.elementId, offset: sel.start.offset }
          : this.deleteRangeInModel(sel);
        if (!caret) return null;
        const el = getElement(this.doc, caret.elementId);
        el.text = el.text.slice(0, caret.offset) + lines[0] + el.text.slice(caret.offset);
        this.markRevised(el);
        return { elementId: el.id, offset: caret.offset + lines[0].length };
      }, { rebuildVocab: true });
      return;
    }

    // Multiple lines are interpreted as screenplay structure.
    this.commit(() => {
      const caret = sel.collapsed
        ? { elementId: sel.start.elementId, offset: sel.start.offset }
        : this.deleteRangeInModel(sel);
      if (!caret) return null;

      const idx = indexOfElement(this.doc, caret.elementId);
      const host = this.doc.elements[idx];
      const tailText = host.text.slice(caret.offset);
      const [hostStyles] = splitStyles(host.styles, caret.offset);
      host.text = host.text.slice(0, caret.offset) + lines[0];
      host.styles = normalizeStyles(hostStyles, host.text.length);

      const created = inferElements(lines.slice(1), host.type);
      if (tailText) created.push(createElement(host.type, tailText));
      this.doc.elements.splice(idx + 1, 0, ...created);
      created.forEach((el) => this.markRevised(el));

      const last = created[created.length - 1] || host;
      return { elementId: last.id, offset: last.text.length };
    }, { rebuildVocab: true });
  }

  /**
   * Insert text containing newlines at the caret, interpreting the breaks as
   * element boundaries. Shares the shape of handlePaste but takes a string.
   */
  insertMultilineText(raw) {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    const sel = this.getSelection();
    if (!sel) return;

    this.commit(() => {
      const caret = sel.collapsed
        ? { elementId: sel.start.elementId, offset: sel.start.offset }
        : this.deleteRangeInModel(sel);
      if (!caret) return null;

      const idx = indexOfElement(this.doc, caret.elementId);
      const host = this.doc.elements[idx];
      const tail = host.text.slice(caret.offset);
      const [hostStyles] = splitStyles(host.styles, caret.offset);
      host.text = host.text.slice(0, caret.offset) + lines[0];
      host.styles = normalizeStyles(hostStyles, host.text.length);
      this.markRevised(host);

      // The remaining lines continue the natural element flow rather than
      // being guessed at, because this path is a person pressing Return.
      const created = [];
      let prevType = host.type;
      for (const line of lines.slice(1)) {
        const type = nextTypeOnEnter(prevType);
        const el = createElement(type, line);
        this.markRevised(el);
        created.push(el);
        prevType = detectType(line, type) || type;
        el.type = prevType;
      }
      if (tail) created.push(createElement(host.type, tail));

      this.doc.elements.splice(idx + 1, 0, ...created);
      const last = created[created.length - 1] || host;
      return { elementId: last.id, offset: tail ? 0 : last.text.length };
    }, { rebuildVocab: true });
  }

  /* ---------------- autocomplete ---------------- */

  updateAutocomplete() {
    const caret = this.getCaret();
    if (!caret) return this.closeAutocomplete();
    const el = getElement(this.doc, caret.elementId);
    if (!el) return this.closeAutocomplete();

    const idx = indexOfElement(this.doc, el.id);
    const hit = suggest(this.doc, this.vocab, el, caret.offset, previousSpeaker(this.doc, idx));
    if (!hit) return this.closeAutocomplete();

    this.ac = {
      open: true,
      items: hit.items,
      index: 0,
      replaceFrom: hit.replaceFrom,
      elementId: el.id,
    };
    this.renderAutocomplete();
  }

  renderAutocomplete() {
    const { items, index } = this.ac;
    this.acEl.innerHTML = '';
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = `ac-item${i === index ? ' sel' : ''}`;
      row.textContent = it.value;
      if (it.detail) {
        const d = document.createElement('span');
        d.className = 'dim';
        d.textContent = `  ×${it.detail}`;
        row.appendChild(d);
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.ac.index = i;
        this.acceptAutocomplete();
      });
      this.acEl.appendChild(row);
    });

    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const host = this.acEl.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
      const left = (rect.left || 0) - host.left;
      const top = (rect.bottom || 0) - host.top + 4;
      this.acEl.style.left = `${Math.max(8, left)}px`;
      this.acEl.style.top = `${top}px`;
    }
    this.acEl.classList.add('open');
  }

  closeAutocomplete() {
    if (this.ac.open) this.acEl.classList.remove('open');
    this.ac.open = false;
  }

  moveAutocomplete(delta) {
    if (!this.ac.open) return;
    const n = this.ac.items.length;
    this.ac.index = (this.ac.index + delta + n) % n;
    this.renderAutocomplete();
  }

  acceptAutocomplete() {
    if (!this.ac.open) return false;
    const item = this.ac.items[this.ac.index];
    const { elementId, replaceFrom } = this.ac;
    this.closeAutocomplete();

    this.commit(() => {
      const el = getElement(this.doc, elementId);
      if (!el) return null;
      el.text = el.text.slice(0, replaceFrom) + item.value;
      el.styles = normalizeStyles(el.styles, el.text.length);
      this.markRevised(el);
      return { elementId, offset: el.text.length };
    }, { rebuildVocab: true });
    return true;
  }

  /* ---------------- events ---------------- */

  bind() {
    this.container.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.container.addEventListener('input', () => this.onInput());
    this.container.addEventListener('paste', (e) => this.handlePaste(e));
    this.container.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    this.container.addEventListener('click', (e) => this.onClick(e));

    document.addEventListener('selectionchange', () => {
      if (!this.container.contains(document.getSelection()?.anchorNode || null)) return;
      this.emit({ viewOnly: true });
    });

    let scrollTimer = null;
    this.scroller.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const c = this.getCaret();
        this.renderer.refreshWindow(
          this.doc,
          this.pagination,
          this.styles,
          c ? [c.elementId] : []
        );
        this.emit({ viewOnly: true });
      }, 90);
    });
  }

  onClick(e) {
    const flag = e.target.closest?.('.note-flag');
    if (flag) {
      e.preventDefault();
      this.onUpdate(this, { openNotes: flag.dataset.noteFor });
    }
  }

  onBeforeInput(e) {
    // Paragraph breaks must never reach the browser: contenteditable would
    // clone the current block, producing DOM the model knows nothing about.
    // This is caught here rather than in keydown because a line break can also
    // arrive from an IME, an automation harness, or a dictation engine.
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      this.handleEnter();
      return;
    }

    // Multi-line text arriving as a single insertion is structure, not a word.
    if (e.inputType === 'insertText' && typeof e.data === 'string' && e.data.includes('\n')) {
      e.preventDefault();
      this.insertMultilineText(e.data);
      return;
    }

    // A selection that spans elements must be removed from the model first,
    // otherwise the browser would delete DOM the model does not know about.
    const sel = this.getSelection();
    if (!sel || sel.collapsed) return;
    if (sel.startIndex === sel.endIndex) return;

    const destructive = [
      'insertText',
      'insertCompositionText',
      'deleteContentBackward',
      'deleteContentForward',
      'insertParagraph',
      'insertFromPaste',
    ];
    if (!destructive.includes(e.inputType)) return;
    if (e.inputType === 'insertFromPaste') return; // handled by the paste event

    e.preventDefault();
    const inserted = e.data || '';
    this.commit(() => {
      const caret = this.deleteRangeInModel(sel);
      if (!caret) return null;
      if (inserted) {
        const el = getElement(this.doc, caret.elementId);
        el.text = el.text.slice(0, caret.offset) + inserted + el.text.slice(caret.offset);
        return { elementId: el.id, offset: caret.offset + inserted.length };
      }
      return caret;
    }, { rebuildVocab: true });
  }

  onKeyDown(e) {
    const meta = e.metaKey || e.ctrlKey;

    // Autocomplete first — it owns the arrow keys while open.
    if (this.ac.open) {
      if (e.key === 'ArrowDown') return void (e.preventDefault(), this.moveAutocomplete(1));
      if (e.key === 'ArrowUp') return void (e.preventDefault(), this.moveAutocomplete(-1));
      if (e.key === 'Escape') return void (e.preventDefault(), this.closeAutocomplete());
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.acceptAutocomplete();
        return;
      }
    }

    if (meta) {
      const k = e.key.toLowerCase();
      if (k === 'b') return void (e.preventDefault(), this.toggleStyle('bold'));
      if (k === 'i') return void (e.preventDefault(), this.toggleStyle('italic'));
      if (k === 'u') return void (e.preventDefault(), this.toggleStyle('underline'));
      if (k === 'z' && !e.shiftKey) return void (e.preventDefault(), this.undo());
      if ((k === 'z' && e.shiftKey) || k === 'y') return void (e.preventDefault(), this.redo());

      // ⌘1..⌘9 set the element type, as in Final Draft.
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= ELEMENT_ORDER.length) {
        e.preventDefault();
        this.setElementType(ELEMENT_ORDER[n - 1]);
        return;
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      this.handleEnter();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      this.handleTab(e.shiftKey);
      return;
    }

    if (e.key === 'Escape') {
      this.closeAutocomplete();
      return;
    }

    if (e.key === 'Backspace') {
      const sel = this.getSelection();
      if (sel && sel.collapsed && sel.start.offset === 0) {
        e.preventDefault();
        this.handleMergeBack();
      }
      return;
    }

    if (e.key === 'Delete') {
      const caret = this.getCaret();
      if (!caret) return;
      const el = getElement(this.doc, caret.elementId);
      if (el && caret.offset >= el.text.length) {
        e.preventDefault();
        this.handleMergeForward();
      }
    }
  }

  onInput() {
    if (this.suppressInput) return;
    const caret = this.getCaret();
    if (!caret) {
      this.hardRender(null);
      return;
    }

    // If the browser added or removed a block on its own, the model is about
    // to be read from DOM that does not correspond to it. Take the text we can
    // salvage, then rebuild from scratch so the two agree again.
    const strayBlocks =
      this.container.querySelectorAll('.el').length !== this.renderer.partCount;

    this.snapshot(caret.elementId);
    const el = this.syncElementFromDOM(caret.elementId);
    if (!el) {
      this.hardRender(null);
      return;
    }

    // Promote "INT. " to a scene heading, demote a heading that no longer is.
    const detected = detectType(el.text, el.type);
    let structural = false;
    if (detected && detected !== el.type) {
      el.type = detected;
      structural = true;
    }

    touch(this.doc);
    assignSceneNumbers(this.doc);
    this.repaginate();

    if (strayBlocks) {
      this.hardRender({ elementId: caret.elementId, offset: Math.min(caret.offset, el.text.length) });
      this.updateAutocomplete();
      return;
    }

    if (structural) {
      this.render({ keepCaret: false });
      this.setCaret(caret.elementId, caret.offset);
    } else {
      this.render();
    }

    this.updateAutocomplete();
    this.scrollCaretIntoView();
    this.emit();
  }

  /* ---------------- statistics for the status bar ---------------- */

  stats() {
    let words = 0;
    for (const el of this.doc.elements) words += countWords(el.text);
    return {
      words,
      pages: this.pagination?.totalPages || 0,
      elements: this.doc.elements.length,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Helpers used above
 * ------------------------------------------------------------------ */

function locateOffset(part, local) {
  const nodes = partTextNodes(part);
  if (!nodes.length) return { node: part, offset: 0 };
  let acc = 0;
  for (const n of nodes) {
    const len = n.nodeValue.length;
    if (local <= acc + len) return { node: n, offset: Math.max(0, local - acc) };
    acc += len;
  }
  const last = nodes[nodes.length - 1];
  return { node: last, offset: last.nodeValue.length };
}

function removeAttr(styles, from, to, attr) {
  const out = [];
  for (const r of styles) {
    if (r.end <= from || r.start >= to) {
      out.push({ ...r });
      continue;
    }
    if (r.start < from) out.push({ ...r, end: from });
    if (r.end > to) out.push({ ...r, start: to });
    const mid = { ...r, start: Math.max(r.start, from), end: Math.min(r.end, to) };
    mid[attr] = false;
    if (mid.bold || mid.italic || mid.underline) out.push(mid);
  }
  return out;
}

/**
 * Interpret pasted plain text as screenplay elements. Deliberately
 * conservative: it recognises the unambiguous shapes and leaves everything
 * else as Action rather than guessing wrongly.
 */
export function inferElements(lines, fallbackType = ElementType.ACTION) {
  const out = [];
  let prev = fallbackType;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();

    if (!t) {
      prev = ElementType.ACTION;
      continue;
    }

    let type;
    if (/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[\.\s]/i.test(t)) {
      type = ElementType.SCENE_HEADING;
    } else if (/^[A-Z][A-Z0-9 .'’\-]*(\([A-Z.'’ ]+\))?:?$/.test(t) && t.length < 40 && /[A-Z]/.test(t) && !/[.!?]$/.test(t)) {
      type = /(TO:|OUT\.|IN:|BLACK\.)$/.test(t) ? ElementType.TRANSITION : ElementType.CHARACTER;
    } else if (/^\(.*\)$/.test(t)) {
      type = ElementType.PARENTHETICAL;
    } else if (prev === ElementType.CHARACTER || prev === ElementType.PARENTHETICAL) {
      type = ElementType.DIALOGUE;
    } else {
      type = ElementType.ACTION;
    }

    out.push(createElement(type, type === ElementType.CHARACTER ? t.replace(/:$/, '') : t));
    prev = type;
  }

  return out.length ? out : [createElement(fallbackType, '')];
}
