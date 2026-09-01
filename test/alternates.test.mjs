import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType, resolveStyles } from '../src/core/format.js';
import { cloneDocument, createDocument, createElement } from '../src/core/model.js';
import {
  activateAlternate,
  addAlternate,
  alternateCount,
  alternateStatus,
  deleteActiveAlternate,
  documentHasAlternates,
  hasAlternateDialogue,
  normalizeAlternateDialogue,
  stepAlternate,
} from '../src/core/alternates.js';
import { paginate } from '../src/core/paginate.js';
import { serializeProject, parseProject } from '../src/io/project.js';
import { toFountain } from '../src/io/fountain.js';
import { toFDX } from '../src/io/fdx.js';
import { auditDocument } from '../src/features/format-assistant.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nAlternate dialogue');

function dialogue(text = 'The first line.') {
  return createElement(ElementType.DIALOGUE, text, {
    styles: [{ start: 4, end: 9, italic: true }],
    revisionId: 'r1',
  });
}

t('adding an alternate preserves the original and opens a blank active choice', () => {
  const el = dialogue();
  assert.equal(addAlternate(el), true);
  assert.equal(el.text, '');
  assert.deepEqual(el.styles, []);
  assert.equal(alternateCount(el), 2);
  assert.equal(el.alternateDialogue.choices[0].text, 'The first line.');
  assert.deepEqual(el.alternateDialogue.choices[0].styles, [
    { start: 4, end: 9, italic: true },
  ]);
  assert.equal(documentHasAlternates({ elements: [el] }), true);
});

t('switching choices atomically preserves edits, styles, order, and revision identity', () => {
  const el = dialogue('One.');
  addAlternate(el);
  el.text = 'Two.';
  el.styles = [{ start: 0, end: 4, bold: true }];
  el.revisionId = 'r2';
  const originalId = el.alternateDialogue.choices[0].id;
  activateAlternate(el, originalId);
  assert.equal(el.text, 'One.');
  assert.equal(el.revisionId, 'r1');
  assert.deepEqual(alternateStatus(el), { position: 1, count: 2 });
  stepAlternate(el, 1);
  assert.equal(el.text, 'Two.');
  assert.equal(el.revisionId, 'r2');
  assert.deepEqual(el.styles, [{ start: 0, end: 4, bold: true }]);
});

t('deleting the active choice selects a stored choice and collapses the last pair', () => {
  const el = dialogue('One.');
  addAlternate(el);
  el.text = 'Two.';
  assert.equal(deleteActiveAlternate(el), true);
  assert.equal(el.text, 'One.');
  assert.equal(el.alternateDialogue, null);
});

t('alternate collections survive native save/open and undo clones without aliasing', () => {
  const el = dialogue('One.');
  addAlternate(el);
  el.text = 'Two.';
  const doc = createDocument({ elements: [el] });
  const opened = parseProject(serializeProject(doc));
  assert.equal(opened.elements[0].alternateDialogue.choices[0].text, 'One.');
  assert.equal(opened.elements[0].text, 'Two.');

  const cloned = cloneDocument(opened);
  cloned.elements[0].alternateDialogue.choices[0].text = 'Changed only in clone.';
  assert.equal(opened.elements[0].alternateDialogue.choices[0].text, 'One.');
});

t('malformed collections are repaired with unique identifiers and clipped styles', () => {
  const normalized = normalizeAlternateDialogue({
    activeId: 'same',
    activeOrder: 2.8,
    choices: [
      { id: 'same', order: 1, text: 'A', styles: [{ start: 0, end: 20, bold: true }] },
      { id: 'same', order: 'bad', text: 'B', styles: [] },
      null,
    ],
  });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(new Set([normalized.activeId, ...normalized.choices.map((c) => c.id)]).size, 3);
  assert.deepEqual(normalized.choices[0].styles, [
    { start: 0, end: 1, bold: true, italic: false, underline: false },
  ]);
  assert.equal(normalized.activeOrder, 2);
});

t('future schemas fail closed and malformed live collections are never treated as usable', () => {
  assert.throws(
    () => normalizeAlternateDialogue({ schemaVersion: 2, choices: [] }),
    /newer version of Scriptum/
  );
  const malformed = dialogue('One.');
  malformed.alternateDialogue = {
    schemaVersion: 1,
    activeId: 'active',
    activeOrder: 1,
    nextOrder: 2,
    choices: [{ id: 'stored', order: 2, text: 'Two.' }],
  };
  assert.equal(hasAlternateDialogue(malformed), false);
  assert.deepEqual(alternateStatus(malformed), { position: 1, count: 1 });
  const doc = createDocument({ elements: [malformed] });
  const issues = auditDocument(doc, paginate(doc, resolveStyles()));
  assert.ok(issues.some((issue) => issue.code === 'malformed-alternate-dialogue'));
  assert.doesNotThrow(() => cloneDocument(doc));
});

t('visible exports and pagination use only the selected dialogue', () => {
  const cue = createElement(ElementType.CHARACTER, 'MARA');
  const el = dialogue('Visible words.');
  addAlternate(el);
  el.text = 'Selected words.';
  const doc = createDocument({ elements: [cue, el] });
  const printed = paginate(doc, resolveStyles()).pages.flatMap((page) => page.lines.map((line) => line.text));
  assert.ok(printed.includes('Selected words.'));
  assert.ok(!printed.includes('Visible words.'));
  assert.match(toFountain(doc), /Selected words\./);
  assert.doesNotMatch(toFountain(doc), /Visible words\./);
  assert.match(toFDX(doc), /Selected words\./);
  assert.doesNotMatch(toFDX(doc), /Visible words\./);
});

t('Format Assistant identifies empty active and stored alternatives', () => {
  const el = dialogue('One.');
  addAlternate(el);
  const doc = createDocument({ elements: [createElement(ElementType.CHARACTER, 'MARA'), el] });
  const issues = auditDocument(doc, paginate(doc, resolveStyles()));
  assert.ok(issues.some((issue) => issue.code === 'empty-alternate-dialogue'));
});

t('toolbar, native menu, renderer controls, guards, and export warning are wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/ui/editor.js', import.meta.url), 'utf8');
  const render = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(html, /id="tb-alt"/);
  assert.match(main, /menu:add-alternate/);
  assert.match(preload, /menu:add-alternate/);
  assert.match(render, /aria-label', 'Alternate dialogue choices'/);
  assert.match(editor, /closest\?\.\('\.alt-controls'\)/);
  assert.match(editor, /selectionTouchesAlternates/);
  assert.match(editor, /requestDeleteAlternate/);
  assert.match(app, /Export Active Choices/);
  assert.match(app, /involved\.some\(hasAlternateDialogue\)/);
});

console.log(`\n${pass} alternate-dialogue checks passed.`);
