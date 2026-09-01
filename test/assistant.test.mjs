import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType, resolveStyles } from '../src/core/format.js';
import { createDocument, createElement } from '../src/core/model.js';
import { paginate } from '../src/core/paginate.js';
import { auditDocument, pdfSupportIssues } from '../src/features/format-assistant.js';
import {
  encodeWinAnsi,
  sanitizePdfText,
  unsupportedPdfCharacters,
} from '../src/core/pdf-encoding.js';
import { invalidPrintCharacters } from '../src/core/unicode.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

const styles = resolveStyles();
const audit = (doc) => auditDocument(doc, paginate(doc, styles));
const codes = (doc) => audit(doc).map((issue) => issue.code);

console.log('\nFormat Assistant');

t('a new blank screenplay has no nuisance warnings', () => {
  assert.deepEqual(audit(createDocument()), []);
});

t('ordinary prose is not judged for spelling, grammar, or style', () => {
  const doc = createDocument({
    elements: [createElement(ElementType.ACTION, "Ain't nobody here, and the sentence runs on")],
  });
  assert.deepEqual(audit(doc), []);
});

t('empty elements are reported only after writing has begun', () => {
  const doc = createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. ROOM - DAY'),
      createElement(ElementType.ACTION, ''),
      createElement(ElementType.CHARACTER, ''),
    ],
  });
  const issues = audit(doc).filter((issue) => issue.code === 'empty-element');
  assert.equal(issues.length, 2);
  assert.equal(issues.find((issue) => issue.elementId === doc.elements[1].id).severity, 'info');
  assert.equal(issues.find((issue) => issue.elementId === doc.elements[2].id).severity, 'warning');
});

t('valid dialogue and nested balanced parentheticals pass', () => {
  const doc = createDocument({
    elements: [
      createElement(ElementType.CHARACTER, 'MARA'),
      createElement(ElementType.PARENTHETICAL, '(quietly (to Sam))'),
      createElement(ElementType.DIALOGUE, 'We should go.'),
    ],
  });
  assert.deepEqual(audit(doc), []);
});

t('orphan dialogue, orphan parentheticals, and empty speeches are found', () => {
  const doc = createDocument({
    elements: [
      createElement(ElementType.DIALOGUE, 'No speaker.'),
      createElement(ElementType.PARENTHETICAL, 'whispering'),
      createElement(ElementType.ACTION, 'A beat.'),
      createElement(ElementType.CHARACTER, 'SAM'),
      createElement(ElementType.ACTION, 'Sam leaves.'),
    ],
  });
  const found = new Set(codes(doc));
  assert.ok(found.has('dialogue-without-character'));
  assert.ok(found.has('parenthetical-without-character'));
  assert.ok(found.has('unbalanced-parenthetical'));
  assert.ok(found.has('character-without-dialogue'));
});

t('duplicate and missing locked scene numbers are errors', () => {
  const first = createElement(ElementType.SCENE_HEADING, 'INT. A - DAY', { sceneNumber: '12' });
  const second = createElement(ElementType.SCENE_HEADING, 'INT. B - DAY', { sceneNumber: '12' });
  const third = createElement(ElementType.SCENE_HEADING, 'INT. C - DAY');
  const doc = createDocument({ elements: [first, second, third] });
  doc.sceneNumbering.enabled = true;
  doc.sceneNumbering.locked = true;
  const issues = audit(doc);
  assert.equal(issues.find((issue) => issue.code === 'duplicate-scene-number').severity, 'error');
  assert.equal(issues.find((issue) => issue.code === 'missing-scene-number').severity, 'error');
});

t('valid and malformed dual-dialogue groups are distinguished', () => {
  const valid = createDocument({
    elements: [
      createElement(ElementType.CHARACTER, 'A', { dual: 'left' }),
      createElement(ElementType.DIALOGUE, 'Left.', { dual: 'left' }),
      createElement(ElementType.CHARACTER, 'B', { dual: 'right' }),
      createElement(ElementType.DIALOGUE, 'Right.', { dual: 'right' }),
    ],
  });
  assert.ok(!codes(valid).includes('malformed-dual-dialogue'));

  const malformed = createDocument({
    elements: [
      createElement(ElementType.CHARACTER, 'A', { dual: 'right' }),
      createElement(ElementType.DIALOGUE, 'Alone.', { dual: 'right' }),
    ],
  });
  assert.ok(codes(malformed).includes('malformed-dual-dialogue'));
});

t('decomposed accents and WinAnsi punctuation are supported', () => {
  assert.equal(sanitizePdfText('ZOE\u0308'), 'ZOË');
  assert.deepEqual(unsupportedPdfCharacters('Zoë — “hello”…'), []);
  assert.ok(encodeWinAnsi('—…').every((byte, index) => byte === [0x97, 0x85][index]));
});

t('C0, C1, and DEL controls are not treated as printable WinAnsi text', () => {
  const unsupported = unsupportedPdfCharacters(`A\u0001B\u007fC\u0080D`);
  assert.deepEqual(unsupported.map((item) => item.source), ['\u0001', '\u007f', '\u0080']);
  assert.deepEqual([...encodeWinAnsi('\u0001\u007f\u0080')], [63, 63, 63]);
});

t('Unicode scripts, symbols, and emoji pass the print preflight', () => {
  const doc = createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. CAFÉ 東京 - NOCHE'),
      createElement(ElementType.ACTION, 'Zoë meets 猫. مرحبا שלום 😀'),
    ],
  });
  doc.title.title = '星の旅 🚀';
  assert.deepEqual(pdfSupportIssues(doc, paginate(doc, styles)), []);
});

t('invalid printable text retains exact UTF-16 source offsets', () => {
  const text = 'A\u0001B\ud800C\ufdd0';
  const unsupported = invalidPrintCharacters(text);
  assert.deepEqual(
    unsupported.map(({ start, end, source }) => ({ start, end, source })),
    [
      { start: 1, end: 2, source: '\u0001' },
      { start: 3, end: 4, source: '\ud800' },
      { start: 5, end: 6, source: '\ufdd0' },
    ]
  );
});

t('print issues cover title fields and screenplay elements', () => {
  const element = createElement(ElementType.ACTION, 'The\u0001 launch.');
  const doc = createDocument({ elements: [element] });
  doc.title.title = 'Draft\u007f';
  const issues = pdfSupportIssues(doc, paginate(doc, styles));
  assert.equal(issues.length, 2);
  assert.ok(issues.some((issue) => issue.field === 'title.title' && !issue.elementId));
  const body = issues.find((issue) => issue.elementId === element.id);
  assert.deepEqual(body.range, { start: 3, end: 4 });
  assert.equal(body.page, '1');
});

t('print preflight covers visible scene numbers and revision furniture', () => {
  const scene = createElement(ElementType.SCENE_HEADING, 'INT. ROOM - DAY', {
    sceneNumber: '1\u0001',
    sceneNumberLocked: true,
    revisionId: 'r1',
  });
  const doc = createDocument({ elements: [scene] });
  doc.sceneNumbering.enabled = true;
  doc.sceneNumbering.locked = true;
  doc.revisions.current = 'r1';
  doc.revisions.sets = [
    { id: 'r1', name: 'Blue\u0002', color: '#7fb2ff', mark: '*\u0003', date: '', active: true },
  ];
  const issues = pdfSupportIssues(doc, paginate(doc, styles));
  assert.ok(issues.some((issue) => issue.field === 'sceneNumber'));
  assert.ok(issues.some((issue) => issue.field === 'revisions.r1.mark'));
  assert.ok(issues.some((issue) => issue.field === 'revisions.r1.name'));
});

t('hidden scene numbers do not create duplicate-number errors', () => {
  const doc = createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. A - DAY', { sceneNumber: '1' }),
      createElement(ElementType.SCENE_HEADING, 'INT. B - DAY', { sceneNumber: '1' }),
    ],
  });
  doc.sceneNumbering.enabled = false;
  assert.ok(!codes(doc).includes('duplicate-scene-number'));
});

t('all duplicate scene-number participants are reported', () => {
  const doc = createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. A - DAY', { sceneNumber: '7' }),
      createElement(ElementType.SCENE_HEADING, 'INT. B - DAY', { sceneNumber: '7' }),
    ],
  });
  doc.sceneNumbering.enabled = true;
  assert.equal(audit(doc).filter((issue) => issue.code === 'duplicate-scene-number').length, 2);
});

t('hidden title pages preflight only the title used as PDF metadata', () => {
  const doc = createDocument({ elements: [createElement(ElementType.ACTION, 'A clean page.')] });
  doc.title.showTitlePage = false;
  doc.title.title = 'Draft\u0001';
  doc.title.author = 'Writer\u0002';
  doc.title.contact = 'Hidden\u0003';
  const fields = pdfSupportIssues(doc, paginate(doc, styles)).map((issue) => issue.field);
  assert.ok(fields.includes('title.title'));
  assert.ok(!fields.includes('title.author'));
  assert.ok(!fields.includes('title.contact'));
});

t('audits are deterministic, non-mutating, and contain no unsafe fixes', () => {
  const doc = createDocument({
    elements: [createElement(ElementType.DIALOGUE, 'Orphan 😀')],
  });
  const before = JSON.stringify(doc);
  const first = audit(doc);
  const second = audit(doc);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(doc), before);
  assert.ok(first.every((issue) => issue.fix === null));
});

t('toolbar, native menu, and preload channel are all wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../src/ui/dialogs.js', import.meta.url), 'utf8');
  assert.match(html, /id="tb-format-assistant"/);
  assert.match(html, /aria-label="Format Assistant"/);
  assert.match(app, /menu:format-assistant/);
  assert.match(main, /menu:format-assistant/);
  assert.match(preload, /menu:format-assistant/);
  assert.match(dialogs, /role:\s*'list'/);
  assert.match(dialogs, /['"]aria-label['"]:\s*`Go to:/i);
});

console.log(`\n${pass} assistant checks passed.`);
