import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType, resolveStyles } from '../src/core/format.js';
import { createDocument, createElement } from '../src/core/model.js';
import { paginate } from '../src/core/paginate.js';
import { createPrintModel, styledRuns } from '../src/io/print-view.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nUnicode PDF print model');

function sample() {
  const scene = createElement(ElementType.SCENE_HEADING, 'int. café 東京 - noche', {
    sceneNumber: '一',
    sceneNumberLocked: true,
  });
  const action = createElement(ElementType.ACTION, 'Zoë meets 猫. مرحبا שלום 😀', {
    styles: [{ start: 0, end: 3, italic: true }],
    notes: [{ id: 'private-note', text: 'Do not export me.', color: '#fff000' }],
  });
  const doc = createDocument({ elements: [scene, action] });
  doc.title.showTitlePage = true;
  doc.title.title = '星の旅 🚀';
  doc.title.author = 'José Núñez';
  doc.sceneNumbering.enabled = true;
  doc.sceneNumbering.locked = true;
  doc.sceneNumbering.showLeft = true;
  doc.sceneNumbering.showRight = true;
  return { doc, scene, action };
}

t('preserves Unicode text across title, body, and scene furniture', () => {
  const { doc } = sample();
  const styles = resolveStyles(doc.styleOverrides, doc.pageOverrides);
  const model = createPrintModel(doc, paginate(doc, styles), styles);
  const text = model.pages.flatMap((page) => page.lines.map((line) => line.text));

  assert.ok(text.includes('星の旅 🚀'));
  assert.ok(text.includes('José Núñez'));
  assert.ok(text.includes('INT. CAFÉ 東京 - NOCHE'));
  assert.ok(text.includes('Zoë meets 猫. مرحبا שלום 😀'));
  assert.equal(text.filter((value) => value === '一').length, 2);
});

t('uses the paginator page count plus an optional title page', () => {
  const { doc } = sample();
  const styles = resolveStyles(doc.styleOverrides, doc.pageOverrides);
  const pagination = paginate(doc, styles);
  const model = createPrintModel(doc, pagination, styles);
  assert.equal(model.pages.length, pagination.totalPages + 1);
  assert.equal(model.pages[0].kind, 'title');
  assert.equal(model.pages.at(-1).kind, 'script');
});

t('keeps screenplay geometry in physical inches', () => {
  const { doc } = sample();
  doc.pageOverrides.paper = 'a4';
  const styles = resolveStyles(doc.styleOverrides, doc.pageOverrides);
  const model = createPrintModel(doc, paginate(doc, styles), styles);
  assert.equal(model.width, 8.27);
  assert.equal(model.height, 11.69);
  const body = model.pages.at(-1).lines.find((line) => line.text.startsWith('Zoë'));
  assert.equal(body.x, styles.elements[ElementType.ACTION].left);
  assert.equal(body.top, styles.page.marginTop + 2 / 6);
});

t('exports screenplay text and emphasis, not private editor annotations', () => {
  const { doc } = sample();
  const styles = resolveStyles(doc.styleOverrides, doc.pageOverrides);
  const model = createPrintModel(doc, paginate(doc, styles), styles);
  const serialized = JSON.stringify(model);
  const action = model.pages.at(-1).lines.find((line) => line.text.startsWith('Zoë'));
  assert.ok(action.styles.some((range) => range.italic));
  assert.doesNotMatch(serialized, /Do not export me|private-note/);
});

t('native printing is a narrow trusted-sender bridge with tagged output', () => {
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /printToPDF:\s*\(pageSize\)\s*=>\s*ipcRenderer\.invoke\('document:print-pdf'/);
  assert.match(main, /ipcMain\.handle\('document:print-pdf'/);
  assert.match(main, /requireTrustedSender\(event\)/);
  assert.match(main, /event\.sender\.printToPDF/);
  assert.match(main, /generateTaggedPDF:\s*true/);
});

t('malformed emphasis offsets cannot bisect a grapheme', () => {
  assert.deepEqual(styledRuns('A😀B', [{ start: 2, end: 3, bold: true }]), [
    { text: 'A', bold: false, italic: false, underline: false },
    { text: '😀', bold: true, italic: false, underline: false },
    { text: 'B', bold: false, italic: false, underline: false },
  ]);
  assert.deepEqual(styledRuns('e\u0308x', [{ start: 1, end: 2, italic: true }])[0], {
    text: 'e\u0308', bold: false, italic: true, underline: false,
  });
});

t('header coordinates honor the configured baseline rather than line-box top', () => {
  const { doc } = sample();
  doc.title.showTitlePage = false;
  doc.pageOverrides.firstPageNumbered = true;
  const styles = resolveStyles(doc.styleOverrides, doc.pageOverrides);
  const model = createPrintModel(doc, paginate(doc, styles), styles);
  const number = model.pages[0].lines.find((line) => line.kind === 'page-number');
  assert.equal(Math.round((number.top + 9.6 / 72) * 1000) / 1000, styles.page.pageNumberTop);
});

t('renderer serializes repeated exports before touching the shared print surface', () => {
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(pdfExportInFlight\)[\s\S]*return;[\s\S]*pdfExportInFlight = true/);
  assert.match(app, /finally \{[\s\S]*pdfExportInFlight = false/);
});

console.log(`\n${pass} Unicode PDF checks passed.`);
