/**
 * find.js — Find and replace across the script.
 *
 * Searching operates on the model, not the rendered DOM, so a match is found
 * even when it falls on a page the renderer has virtualized away.
 */

import { replaceElementText } from '../core/model.js';
import { ELEMENT_LABEL } from '../core/format.js';

export class Finder {
  constructor(editor) {
    this.editor = editor;
    this.matches = [];
    this.index = -1;
    this.query = '';
    this.options = { caseSensitive: false, wholeWord: false, elementType: null };
  }

  search(query, options = {}) {
    this.query = query;
    this.options = { ...this.options, ...options };
    this.matches = [];
    this.index = -1;
    if (!query) return this.matches;

    const flags = this.options.caseSensitive ? 'g' : 'gi';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = this.options.wholeWord ? `\\b${escaped}\\b` : escaped;

    for (const [elementIndex, el] of this.editor.doc.elements.entries()) {
      if (this.options.elementType && el.type !== this.options.elementType) continue;
      const re = new RegExp(pattern, flags);
      let m;
      while ((m = re.exec(el.text)) !== null) {
        this.matches.push({
          elementId: el.id,
          elementIndex,
          start: m.index,
          end: m.index + m[0].length,
          type: el.type,
          context: contextAround(el.text, m.index, m[0].length),
        });
        if (m.index === re.lastIndex) re.lastIndex += 1; // zero-length guard
      }
    }
    return this.matches;
  }

  /** Move to the next/previous match and put the caret on it. */
  step(delta) {
    if (!this.matches.length) return null;
    this.index = (this.index + delta + this.matches.length) % this.matches.length;
    return this.reveal();
  }

  /** Jump to the first match at or after the caret. */
  seekFromCaret() {
    const caret = this.editor.getCaret();
    if (!caret || !this.matches.length) return this.step(1);
    const idx = this.editor.doc.elements.findIndex((e) => e.id === caret.elementId);
    const found = this.matches.findIndex(
      (m) => m.elementIndex > idx || (m.elementIndex === idx && m.start >= caret.offset)
    );
    this.index = found === -1 ? 0 : found;
    return this.reveal();
  }

  reveal() {
    const m = this.matches[this.index];
    if (!m) return null;
    this.editor.renderer.scrollToElement(m.elementId);
    this.editor.setCaret(m.elementId, m.start, { scroll: true });
    this.editor.selectRange({
      start: { elementId: m.elementId, offset: m.start },
      end: { elementId: m.elementId, offset: m.end },
      startIndex: m.elementIndex,
      endIndex: m.elementIndex,
      collapsed: false,
    });
    return m;
  }

  replaceCurrent(replacement) {
    const m = this.matches[this.index];
    if (!m) return false;

    this.editor.commit(() => {
      const el = this.editor.doc.elements.find((e) => e.id === m.elementId);
      if (!el) return null;
      replaceElementText(el, m.start, m.end, replacement);
      this.editor.markRevised(el);
      return { elementId: el.id, offset: m.start + replacement.length };
    }, { rebuildVocab: true });

    const keep = this.index;
    this.search(this.query, this.options);
    this.index = Math.min(keep, this.matches.length - 1);
    return true;
  }

  replaceAll(replacement) {
    if (!this.matches.length) return 0;
    const count = this.matches.length;

    this.editor.commit(() => {
      // Work backwards so earlier offsets stay valid.
      for (let i = this.matches.length - 1; i >= 0; i -= 1) {
        const m = this.matches[i];
        const el = this.editor.doc.elements.find((e) => e.id === m.elementId);
        if (!el) continue;
        replaceElementText(el, m.start, m.end, replacement);
        this.editor.markRevised(el);
      }
      return null;
    }, { rebuildVocab: true });

    this.search(this.query, this.options);
    return count;
  }

  label() {
    if (!this.query) return '';
    if (!this.matches.length) return 'No results';
    return `${this.index + 1} / ${this.matches.length}`;
  }

  /** Grouped summary used by the sidebar. */
  summary() {
    const byType = new Map();
    for (const m of this.matches) {
      byType.set(m.type, (byType.get(m.type) || 0) + 1);
    }
    return [...byType.entries()].map(([type, n]) => ({
      type,
      label: ELEMENT_LABEL[type] || type,
      count: n,
    }));
  }
}

function contextAround(text, start, len) {
  const from = Math.max(0, start - 24);
  const to = Math.min(text.length, start + len + 24);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}
