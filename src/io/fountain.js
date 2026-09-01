/**
 * fountain.js — Fountain (fountain.io) import and export.
 *
 * Fountain is the plain-text lingua franca of screenwriting: it opens in any
 * editor, diffs cleanly in git, and will still be readable in thirty years.
 * Supporting it properly is the single best guarantee that a writer's work is
 * never trapped inside this application.
 */

import { ElementType } from '../core/format.js';
import { createDocument, createElement, normalizeStyles } from '../core/model.js';

/* ------------------------------------------------------------------ *
 * Inline emphasis
 * ------------------------------------------------------------------ */

/**
 * Convert Fountain emphasis markers into text plus style ranges.
 * Handles ***bold italic***, **bold**, *italic*, _underline_ and the
 * backslash escape.
 */
export function parseInline(raw) {
  let text = '';
  const styles = [];
  const stack = { bold: [], italic: [], underline: [] };

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];

    if (ch === '\\' && i + 1 < raw.length) {
      text += raw[i + 1];
      i += 2;
      continue;
    }

    if (ch === '*') {
      const run = countRun(raw, i, '*');
      const kinds = run >= 3 ? ['bold', 'italic'] : run === 2 ? ['bold'] : ['italic'];
      const consumed = run >= 3 ? 3 : run;
      for (const k of kinds) toggle(stack, k, text.length, styles);
      i += consumed;
      continue;
    }

    if (ch === '_') {
      toggle(stack, 'underline', text.length, styles);
      i += 1;
      continue;
    }

    text += ch;
    i += 1;
  }

  // Any marker left open applies to the end of the line.
  for (const k of Object.keys(stack)) {
    while (stack[k].length) {
      styles.push({ start: stack[k].pop(), end: text.length, [k]: true });
    }
  }

  return { text, styles: normalizeStyles(styles, text.length) };
}

function countRun(s, i, ch) {
  let n = 0;
  while (i + n < s.length && s[i + n] === ch) n += 1;
  return n;
}

function toggle(stack, kind, pos, styles) {
  if (stack[kind].length) {
    styles.push({ start: stack[kind].pop(), end: pos, [kind]: true });
  } else {
    stack[kind].push(pos);
  }
}

/** Re-apply Fountain markers to text carrying style ranges. */
export function serializeInline(text, styles) {
  if (!styles || !styles.length) return escapeFountain(text);

  // Build per-character attributes, then emit markers at every change.
  const at = (i) => {
    let b = false;
    let it = false;
    let u = false;
    for (const r of styles) {
      if (i >= r.start && i < r.end) {
        b ||= !!r.bold;
        it ||= !!r.italic;
        u ||= !!r.underline;
      }
    }
    return { b, it, u };
  };

  let out = '';
  let prev = { b: false, it: false, u: false };
  for (let i = 0; i <= text.length; i += 1) {
    const cur = i < text.length ? at(i) : { b: false, it: false, u: false };

    // Close in reverse order of opening so markers nest correctly.
    if (prev.u && !cur.u) out += '_';
    if (prev.it && !cur.it) out += '*';
    if (prev.b && !cur.b) out += '**';
    if (!prev.b && cur.b) out += '**';
    if (!prev.it && cur.it) out += '*';
    if (!prev.u && cur.u) out += '_';

    if (i < text.length) out += escapeChar(text[i]);
    prev = cur;
  }
  return out;
}

function escapeChar(c) {
  return c === '*' || c === '_' || c === '\\' ? `\\${c}` : c;
}
function escapeFountain(s) {
  return s.replace(/([*_\\])/g, '\\$1');
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E|EXT\.?\/INT)[\.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 '’\-]+(TO:|OUT\.|IN:|BLACK\.)$/;

export function parseFountain(source) {
  const doc = createDocument({ elements: [] });
  let text = source.replace(/\r\n?/g, '\n');

  // Strip boneyard comments before anything else.
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');

  const lines = text.split('\n');
  let i = 0;

  // ---- Title page: key/value pairs terminated by a blank line ----
  const titleMap = {};
  if (/^[A-Za-z ]+:/.test(lines[0] || '')) {
    let key = null;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        break;
      }
      const m = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
      if (m) {
        key = m[1].trim().toLowerCase();
        titleMap[key] = m[2].trim();
      } else if (key) {
        titleMap[key] = `${titleMap[key] ? `${titleMap[key]}\n` : ''}${line.trim()}`;
      }
      i += 1;
    }
    applyTitleMap(doc, titleMap);
  }

  const push = (type, raw, extra = {}) => {
    const { text: t, styles } = parseInline(raw);
    doc.elements.push(createElement(type, t, { styles, ...extra }));
  };

  let prevType = null;

  for (; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (!trimmed) {
      prevType = null;
      continue;
    }

    // Notes on their own line become element notes on the previous element.
    const noteOnly = /^\[\[(.+)\]\]$/.exec(trimmed);
    if (noteOnly) {
      const last = doc.elements[doc.elements.length - 1];
      if (last) last.notes.push({ id: `n${i}`, text: noteOnly[1], color: '#f2c94c' });
      continue;
    }

    // Section headings and synopses become scene-card metadata, not script text.
    if (/^#{1,6}\s/.test(trimmed)) {
      push(ElementType.ACT_BREAK, trimmed.replace(/^#+\s*/, ''));
      prevType = ElementType.ACT_BREAK;
      continue;
    }
    if (/^=(?!=)/.test(trimmed)) {
      const last = doc.elements[doc.elements.length - 1];
      if (last) last.synopsis = trimmed.replace(/^=\s*/, '');
      continue;
    }
    if (/^={3,}$/.test(trimmed)) continue; // explicit page break — repaginated anyway

    // ---- Forced element types ----
    if (trimmed.startsWith('.') && !trimmed.startsWith('..')) {
      const [extra] = sceneNumberOf(trimmed);
      push(ElementType.SCENE_HEADING, stripSceneNumber(trimmed.slice(1).trim()), extra);
      prevType = ElementType.SCENE_HEADING;
      continue;
    }
    if (trimmed.startsWith('!')) {
      push(ElementType.ACTION, trimmed.slice(1));
      prevType = ElementType.ACTION;
      continue;
    }
    if (trimmed.startsWith('@')) {
      const dual = trimmed.endsWith('^');
      push(ElementType.CHARACTER, trimmed.slice(1).replace(/\s*\^$/, '').trim(), {
        dual: dual ? 'right' : null,
      });
      prevType = ElementType.CHARACTER;
      continue;
    }
    if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
      push(ElementType.ACT_BREAK, trimmed.slice(1, -1).trim());
      prevType = ElementType.ACT_BREAK;
      continue;
    }
    if (trimmed.startsWith('>')) {
      push(ElementType.TRANSITION, trimmed.slice(1).trim());
      prevType = ElementType.TRANSITION;
      continue;
    }

    // ---- Inferred types ----
    if (SCENE_RE.test(trimmed)) {
      const [extra] = sceneNumberOf(trimmed);
      push(ElementType.SCENE_HEADING, stripSceneNumber(trimmed), extra);
      prevType = ElementType.SCENE_HEADING;
      continue;
    }

    if (prevType === ElementType.CHARACTER || prevType === ElementType.PARENTHETICAL) {
      if (/^\(.*\)$/.test(trimmed)) {
        push(ElementType.PARENTHETICAL, trimmed);
        prevType = ElementType.PARENTHETICAL;
      } else {
        push(ElementType.DIALOGUE, trimmed);
        prevType = ElementType.DIALOGUE;
      }
      continue;
    }
    if (prevType === ElementType.DIALOGUE) {
      // A blank line ends a speech, so a further line here continues it.
      if (/^\(.*\)$/.test(trimmed)) {
        push(ElementType.PARENTHETICAL, trimmed);
        prevType = ElementType.PARENTHETICAL;
      } else {
        push(ElementType.DIALOGUE, trimmed);
      }
      continue;
    }

    // A character cue is an all-caps line with a non-blank line beneath it.
    const next = lines[i + 1] || '';
    const isCue =
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      next.trim() &&
      !TRANSITION_RE.test(trimmed) &&
      trimmed.length < 60;

    if (isCue) {
      const dual = trimmed.endsWith('^');
      push(ElementType.CHARACTER, trimmed.replace(/\s*\^$/, '').trim(), {
        dual: dual ? 'right' : null,
      });
      prevType = ElementType.CHARACTER;
      continue;
    }

    if (TRANSITION_RE.test(trimmed)) {
      push(ElementType.TRANSITION, trimmed);
      prevType = ElementType.TRANSITION;
      continue;
    }

    push(ElementType.ACTION, line);
    prevType = ElementType.ACTION;
  }

  resolveDualDialogue(doc);
  if (!doc.elements.length) doc.elements.push(createElement(ElementType.SCENE_HEADING, ''));
  return doc;
}

function sceneNumberOf(line) {
  const m = /#([^#\s]+)#\s*$/.exec(line);
  return m ? [{ sceneNumber: m[1], sceneNumberLocked: true }] : [{}];
}
function stripSceneNumber(line) {
  return line.replace(/\s*#[^#\s]+#\s*$/, '').trim();
}

/**
 * Resolve `^` markers once the whole script is parsed.
 *
 * A cue marked `^` is the right-hand column; the speech immediately above it
 * becomes the left. This has to run as a post-pass because the right column's
 * own dialogue has not been read yet at the moment the cue is encountered.
 */
function resolveDualDialogue(doc) {
  const els = doc.elements;
  const isSpeechBody = (el) =>
    el && (el.type === ElementType.DIALOGUE || el.type === ElementType.PARENTHETICAL);

  for (let i = 0; i < els.length; i += 1) {
    if (els[i].type !== ElementType.CHARACTER || els[i].dual !== 'right') continue;

    // Forward: the rest of this speech is the right column.
    let end = i;
    while (end + 1 < els.length && isSpeechBody(els[end + 1])) end += 1;
    for (let k = i; k <= end; k += 1) els[k].dual = 'right';

    // Backward: the previous cue and its body are the left column.
    let prevCue = i - 1;
    while (prevCue >= 0 && isSpeechBody(els[prevCue])) prevCue -= 1;
    if (prevCue < 0 || els[prevCue].type !== ElementType.CHARACTER) {
      // Nothing to pair with — treat it as an ordinary speech.
      for (let k = i; k <= end; k += 1) els[k].dual = null;
      continue;
    }
    for (let k = prevCue; k < i; k += 1) els[k].dual = 'left';

    i = end;
  }
}

function applyTitleMap(doc, map) {
  const pick = (...keys) => {
    for (const k of keys) if (map[k]) return map[k];
    return '';
  };
  doc.title.title = pick('title') || 'UNTITLED';
  doc.title.credit = pick('credit') || 'Written by';
  doc.title.author = pick('author', 'authors', 'written by');
  doc.title.source = pick('source');
  doc.title.draftDate = pick('draft date', 'date');
  doc.title.contact = pick('contact', 'copyright');
  doc.title.notes = pick('notes');
  doc.title.showTitlePage = true;
}

/* ------------------------------------------------------------------ *
 * Serialising
 * ------------------------------------------------------------------ */

export function toFountain(doc) {
  const out = [];
  const t = doc.title;

  if (t.title) out.push(`Title: ${t.title}`);
  if (t.credit) out.push(`Credit: ${t.credit}`);
  if (t.author) out.push(`Author: ${t.author}`);
  if (t.source) out.push(`Source: ${t.source}`);
  if (t.draftDate) out.push(`Draft date: ${t.draftDate}`);
  if (t.contact) out.push(`Contact: ${indentMultiline(t.contact)}`);
  if (out.length) out.push('');

  for (const el of doc.elements) {
    const body = serializeInline(el.text, el.styles);

    switch (el.type) {
      case ElementType.SCENE_HEADING: {
        out.push('');
        const forced = SCENE_RE.test(el.text) ? '' : '.';
        const num = el.sceneNumber ? ` #${el.sceneNumber}#` : '';
        out.push(`${forced}${body.toUpperCase()}${num}`);
        break;
      }
      case ElementType.CHARACTER: {
        out.push('');
        const caret = el.dual === 'right' ? ' ^' : '';
        const upper = body.toUpperCase();
        // Force the cue if it would not be recognised as all-caps on its own.
        const forced = upper === body && /[A-Z]/.test(body) ? '' : '@';
        out.push(`${forced}${upper}${caret}`);
        break;
      }
      case ElementType.PARENTHETICAL:
        out.push(body.startsWith('(') ? body : `(${body})`);
        break;
      case ElementType.DIALOGUE:
        out.push(body);
        break;
      case ElementType.TRANSITION:
        out.push('');
        out.push(TRANSITION_RE.test(el.text.toUpperCase()) ? body.toUpperCase() : `> ${body}`);
        break;
      case ElementType.ACT_BREAK:
        out.push('');
        out.push(`> ${body.toUpperCase()} <`);
        break;
      case ElementType.SHOT:
        out.push('');
        out.push(`!${body.toUpperCase()}`);
        break;
      default:
        out.push('');
        out.push(body);
    }

    for (const note of el.notes || []) out.push(`[[${note.text}]]`);
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function indentMultiline(s) {
  const [first, ...rest] = s.split('\n');
  return rest.length ? `${first}\n${rest.map((r) => `\t${r}`).join('\n')}` : first;
}
