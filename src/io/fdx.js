/**
 * fdx.js — Final Draft (.fdx) import and export.
 *
 * FDX is plain XML, so round-tripping is a matter of mapping element names and
 * the Style attribute. This is the door in and out of the industry standard:
 * a writer can be handed an FDX by a producer, work here, and send back an FDX
 * that opens cleanly on the other side.
 */

import { ElementType } from '../core/format.js';
import { createDocument, createElement, normalizeStyles } from '../core/model.js';

/* Final Draft's paragraph names ↔ our element types. */
const FDX_TO_TYPE = {
  'Scene Heading': ElementType.SCENE_HEADING,
  Action: ElementType.ACTION,
  Character: ElementType.CHARACTER,
  Parenthetical: ElementType.PARENTHETICAL,
  Dialogue: ElementType.DIALOGUE,
  Transition: ElementType.TRANSITION,
  Shot: ElementType.SHOT,
  General: ElementType.GENERAL,
  'New Act': ElementType.ACT_BREAK,
  'End of Act': ElementType.ACT_BREAK,
  'Cast List': ElementType.GENERAL,
};

const TYPE_TO_FDX = {
  [ElementType.SCENE_HEADING]: 'Scene Heading',
  [ElementType.ACTION]: 'Action',
  [ElementType.CHARACTER]: 'Character',
  [ElementType.PARENTHETICAL]: 'Parenthetical',
  [ElementType.DIALOGUE]: 'Dialogue',
  [ElementType.TRANSITION]: 'Transition',
  [ElementType.SHOT]: 'Shot',
  [ElementType.GENERAL]: 'General',
  [ElementType.ACT_BREAK]: 'New Act',
};

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export function parseFDX(xml) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(xml, 'application/xml');

  const err = dom.querySelector('parsererror');
  if (err) throw new Error(`This does not look like a valid .fdx file.\n${err.textContent.slice(0, 200)}`);

  const root = dom.documentElement;
  if (root.nodeName !== 'FinalDraft') {
    throw new Error('This file is not a Final Draft document.');
  }

  const doc = createDocument({ elements: [] });

  // ---- Revision sets ----
  const revisions = [...dom.querySelectorAll('Revisions > Revision')];
  doc.revisions.sets = revisions.map((r, i) => ({
    id: r.getAttribute('Number') || String(i + 1),
    name: r.getAttribute('Name') || `Revision ${i + 1}`,
    color: normalizeColor(r.getAttribute('Color')) || REV_COLORS[i % REV_COLORS.length].color,
    mark: r.getAttribute('Mark') || '*',
    date: r.getAttribute('RevisionDate') || '',
    active: true,
  }));

  // ---- Body ----
  const content = dom.querySelector('FinalDraft > Content');
  if (content) {
    for (const node of content.children) {
      if (node.nodeName === 'Paragraph') {
        const el = readParagraph(node);
        if (el) doc.elements.push(el);
      } else if (node.nodeName === 'DualDialogue') {
        const paras = [...node.querySelectorAll('Paragraph')].map(readParagraph).filter(Boolean);
        // The first speech is the left column, the second the right.
        let side = 'left';
        let seenCue = false;
        for (const p of paras) {
          if (p.type === ElementType.CHARACTER) {
            if (seenCue) side = 'right';
            seenCue = true;
          }
          p.dual = side;
          doc.elements.push(p);
        }
      }
    }
  }

  // ---- Title page ----
  const titlePage = dom.querySelector('TitlePage > Content');
  if (titlePage) {
    const lines = [...titlePage.querySelectorAll('Paragraph')]
      .map((p) => textOf(p).trim())
      .filter(Boolean);
    applyTitleLines(doc, lines);
  }

  // ---- Scene numbering ----
  const numbered = doc.elements.filter(
    (e) => e.type === ElementType.SCENE_HEADING && e.sceneNumber
  );
  if (numbered.length) {
    doc.sceneNumbering.enabled = true;
    doc.sceneNumbering.locked = true;
    numbered.forEach((e) => {
      e.sceneNumberLocked = true;
    });
  }

  if (!doc.elements.length) doc.elements.push(createElement(ElementType.SCENE_HEADING, ''));
  return doc;
}

function readParagraph(node) {
  const fdxType = node.getAttribute('Type') || 'Action';
  const type = FDX_TO_TYPE[fdxType] || ElementType.ACTION;

  let text = '';
  const styles = [];
  for (const t of node.children) {
    if (t.nodeName !== 'Text') continue;
    const chunk = t.textContent || '';
    const style = t.getAttribute('Style') || '';
    if (chunk) {
      const start = text.length;
      text += chunk;
      if (style) {
        styles.push({
          start,
          end: text.length,
          bold: /Bold/i.test(style),
          italic: /Italic/i.test(style),
          underline: /Underline/i.test(style),
        });
      }
    }
  }

  // Final Draft stores hard line breaks inside a paragraph; a screenplay
  // element is a single flowing paragraph here, so collapse them.
  text = text.replace(/\r?\n/g, ' ').replace(/\s+$/, '');
  if (!text && type === ElementType.ACTION) return null;

  const el = createElement(type, text, {
    styles: normalizeStyles(styles, text.length),
    sceneNumber: node.getAttribute('Number') || null,
  });

  const rev = node.getAttribute('RevisionID') || node.getAttribute('Revision');
  if (rev) el.revisionId = rev;

  // Inline notes ride along as ScriptNote children.
  for (const n of node.querySelectorAll('ScriptNote')) {
    el.notes.push({
      id: `n${el.notes.length}`,
      text: textOf(n).trim(),
      color: '#f2c94c',
    });
  }

  return el;
}

function textOf(node) {
  return [...node.querySelectorAll('Text')].map((t) => t.textContent).join('');
}

function applyTitleLines(doc, lines) {
  if (!lines.length) return;
  doc.title.title = lines[0] || 'UNTITLED';
  const byIndex = lines.slice(1);
  const creditIdx = byIndex.findIndex((l) => /^(written|created|screenplay|story)\b/i.test(l));
  if (creditIdx !== -1) {
    doc.title.credit = byIndex[creditIdx];
    doc.title.author = byIndex[creditIdx + 1] || '';
    const rest = byIndex.slice(creditIdx + 2);
    if (rest.length) doc.title.contact = rest.join('\n');
  } else {
    doc.title.credit = 'Written by';
    doc.title.author = byIndex[0] || '';
    if (byIndex.length > 1) doc.title.contact = byIndex.slice(1).join('\n');
  }
  doc.title.showTitlePage = true;
}

function normalizeColor(c) {
  if (!c) return null;
  // Final Draft writes 16-bit-per-channel hex like "#FFFFFFFF0000".
  const m = /^#?([0-9A-F]{4})([0-9A-F]{4})([0-9A-F]{4})$/i.exec(c);
  if (m) {
    const to8 = (h) => Math.round((parseInt(h, 16) / 65535) * 255);
    return `#${[m[1], m[2], m[3]].map((h) => to8(h).toString(16).padStart(2, '0')).join('')}`;
  }
  return /^#[0-9a-f]{6}$/i.test(c) ? c : null;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export function toFDX(doc) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    '  <Content>',
  ];

  let i = 0;
  while (i < doc.elements.length) {
    const el = doc.elements[i];

    if (el.dual === 'left') {
      lines.push('    <DualDialogue>');
      while (i < doc.elements.length && (doc.elements[i].dual === 'left' || doc.elements[i].dual === 'right')) {
        lines.push(paragraphXML(doc.elements[i], '      '));
        i += 1;
      }
      lines.push('    </DualDialogue>');
      continue;
    }

    lines.push(paragraphXML(el, '    '));
    i += 1;
  }

  lines.push('  </Content>');

  // ---- Title page ----
  const t = doc.title;
  if (t.showTitlePage) {
    lines.push('  <TitlePage>');
    lines.push('    <Content>');
    for (const line of [t.title, '', t.credit, t.author, '', t.source, t.contact, t.draftDate]) {
      if (line === undefined || line === null) continue;
      for (const part of String(line).split('\n')) {
        lines.push(
          `      <Paragraph Alignment="Center"><Text>${xmlEscape(part)}</Text></Paragraph>`
        );
      }
    }
    lines.push('    </Content>');
    lines.push('  </TitlePage>');
  }

  // ---- Revisions ----
  if (doc.revisions.sets.length) {
    lines.push('  <Revisions>');
    doc.revisions.sets.forEach((s, idx) => {
      lines.push(
        `    <Revision Number="${xmlEscape(s.id || String(idx + 1))}" Name="${xmlEscape(s.name)}" ` +
          `Mark="${xmlEscape(s.mark || '*')}" Color="${xmlEscape(s.color || '#ffffff')}" ` +
          `RevisionDate="${xmlEscape(s.date || '')}"/>`
      );
    });
    lines.push('  </Revisions>');
  }

  lines.push('</FinalDraft>');
  return `${lines.join('\n')}\n`;
}

function paragraphXML(el, indent) {
  const type = TYPE_TO_FDX[el.type] || 'Action';
  const attrs = [`Type="${type}"`];
  if (el.type === ElementType.SCENE_HEADING && el.sceneNumber) {
    attrs.push(`Number="${xmlEscape(el.sceneNumber)}"`);
  }
  if (el.revisionId) attrs.push(`RevisionID="${xmlEscape(String(el.revisionId))}"`);

  const runs = styleRuns(el.text, el.styles);
  const body = runs
    .map((r) => {
      const style = [r.bold && 'Bold', r.italic && 'Italic', r.underline && 'Underline']
        .filter(Boolean)
        .join('+');
      return style
        ? `<Text Style="${style}">${xmlEscape(r.text)}</Text>`
        : `<Text>${xmlEscape(r.text)}</Text>`;
    })
    .join('');

  const notes = (el.notes || [])
    .map((n) => `<ScriptNote><Paragraph><Text>${xmlEscape(n.text)}</Text></Paragraph></ScriptNote>`)
    .join('');

  return `${indent}<Paragraph ${attrs.join(' ')}>${body}${notes}</Paragraph>`;
}

/** Split text into runs of uniform emphasis. */
export function styleRuns(text, styles) {
  if (!text) return [{ text: '', bold: false, italic: false, underline: false }];
  if (!styles || !styles.length) {
    return [{ text, bold: false, italic: false, underline: false }];
  }

  const attrs = Array.from({ length: text.length }, () => ({
    bold: false,
    italic: false,
    underline: false,
  }));
  for (const r of styles) {
    for (let i = Math.max(0, r.start); i < Math.min(text.length, r.end); i += 1) {
      if (r.bold) attrs[i].bold = true;
      if (r.italic) attrs[i].italic = true;
      if (r.underline) attrs[i].underline = true;
    }
  }

  const runs = [];
  let i = 0;
  while (i < text.length) {
    const a = attrs[i];
    let j = i + 1;
    while (
      j < text.length &&
      attrs[j].bold === a.bold &&
      attrs[j].italic === a.italic &&
      attrs[j].underline === a.underline
    ) {
      j += 1;
    }
    runs.push({ text: text.slice(i, j), ...a });
    i = j;
  }
  return runs;
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* The standard production revision colour order. */
export const REV_COLORS = [
  { name: 'Blue', color: '#7fb2ff' },
  { name: 'Pink', color: '#ff9ec4' },
  { name: 'Yellow', color: '#ffe27a' },
  { name: 'Green', color: '#8fdba0' },
  { name: 'Goldenrod', color: '#e6c25a' },
  { name: 'Buff', color: '#efd8a6' },
  { name: 'Salmon', color: '#ffa585' },
  { name: 'Cherry', color: '#e06a80' },
  { name: 'Tan', color: '#d6c1a0' },
  { name: 'Gray', color: '#c3c9d1' },
  { name: 'Ivory', color: '#f4efdf' },
  { name: 'White', color: '#ffffff' },
];
