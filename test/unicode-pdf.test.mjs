import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

t('ships open-licensed offline fallback fonts for the tested scripts', () => {
  const stylesheet = fs.readFileSync(new URL('../src/styles/script.css', import.meta.url), 'utf8');
  const printView = fs.readFileSync(new URL('../src/io/print-view.js', import.meta.url), 'utf8');
  const fonts = new Map([
    ['NotoSansMono-Regular.ttf', 'd9e2b23d19f8230be7146f409a52b1d23117e635e28f2e2892cf91b7382f325b'],
    ['NotoSansMonoCJKsc-Regular.otf', 'ec04cc376b34887cedbdf84074e2e226ed2761eeabdcb9173fc1dd7bfd153ef7'],
    ['NotoSansDevanagari-Regular.ttf', '385e78e6359a9d88a0f243d53b1209d7548361ba2194e2b9ec779bcaa7e8949d'],
    ['NotoSansArabic-Regular.ttf', 'ceea25b464a656dc3b26849bab9356740401af62aedf1bfa8b7f0d9b75925b1b'],
    ['NotoSansHebrew-Regular.ttf', 'a7fa16fffb27bedb060a0866267c29e9859aeb9c21cc33f5b3aaf6eb062eca85'],
  ]);
  for (const [font, expectedHash] of fonts) {
    const bytes = fs.readFileSync(new URL(`../src/assets/fonts/${font}`, import.meta.url));
    assert.ok(bytes.length > 20_000);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
    assert.match(stylesheet, new RegExp(font.replace('.', '\\.')));
  }
  assert.match(printView, /document\.fonts\.load/);
  assert.match(printView, /Bundled PDF font failed to load/);
  for (const license of ['OFL-Noto.txt', 'OFL-Noto-CJK.txt']) {
    assert.match(
      fs.readFileSync(new URL(`../src/assets/fonts/${license}`, import.meta.url), 'utf8'),
      /SIL OPEN FONT LICENSE Version 1\.1/
    );
  }
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
