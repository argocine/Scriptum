import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType, resolveStyles } from '../src/core/format.js';
import {
  appendOffsetRanges,
  cloneDocument,
  createDocument,
  createElement,
  replaceElementText,
  replaceElementTextByDiff,
  splitOffsetRanges,
} from '../src/core/model.js';
import {
  addProductionCategory,
  applyProductionTag,
  createProductionRegistry,
  documentHasProductionTags,
  ensureProductionItem,
  mergeTagRanges,
  normalizeElementTags,
  normalizeProductionRegistry,
  removeProductionTags,
} from '../src/core/production.js';
import { breakdownReport, BREAKDOWN_COLUMNS, toCSV } from '../src/features/reports.js';
import { paginate } from '../src/core/paginate.js';
import { normalizeDocument, parseProject, serializeProject } from '../src/io/project.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nProduction tagging');

function taggedDocument() {
  const production = createProductionRegistry();
  const prop = ensureProductionItem(production, 'props', 'Silver lighter');
  const heading = createElement(ElementType.SCENE_HEADING, 'INT. CLUB - NIGHT');
  const action = createElement(ElementType.ACTION, 'Mara flicks a silver lighter.');
  applyProductionTag(action, prop.id, 14, 28);
  return { doc: createDocument({ production, elements: [heading, action] }), prop, action };
}

t('ships a complete, deterministic set of breakdown categories', () => {
  const registry = createProductionRegistry();
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.categories.length, 14);
  assert.deepEqual(registry.categories.slice(0, 4).map((category) => category.id), [
    'cast', 'extras', 'stunts', 'props',
  ]);
  assert.equal(new Set(registry.categories.map((category) => category.id)).size, 14);
});

t('normalizes registries, preserves defaults, and rejects future schemas', () => {
  const registry = normalizeProductionRegistry({
    schemaVersion: 1,
    showTags: false,
    categories: [{ id: 'custom', name: ' Picture Cars ', color: '#ABCDEF' }],
    items: [{ id: 'car', categoryId: 'custom', name: 'Hero coupe', notes: 42 }],
  });
  assert.equal(registry.showTags, false);
  assert.ok(registry.categories.some((category) => category.id === 'props'));
  assert.deepEqual(registry.items[0], {
    id: 'car', categoryId: 'custom', name: 'Hero coupe', notes: '',
  });
  assert.throws(
    () => normalizeProductionRegistry({ schemaVersion: 2 }),
    /newer version of Scriptum/
  );
});

t('creates reusable custom categories and case-insensitive items without duplication', () => {
  const registry = createProductionRegistry();
  const category = addProductionCategory(registry, 'Animals', '#123456');
  assert.equal(addProductionCategory(registry, 'animals').id, category.id);
  const first = ensureProductionItem(registry, category.id, 'Raven');
  assert.equal(ensureProductionItem(registry, category.id, 'raven').id, first.id);
  assert.equal(ensureProductionItem(registry, 'missing', 'Ghost'), null);
});

t('applies, merges, and selectively removes text-anchored tags', () => {
  const element = createElement(ElementType.ACTION, '0123456789');
  assert.equal(applyProductionTag(element, 'prop', 2, 6), true);
  assert.equal(applyProductionTag(element, 'prop', 5, 8), true);
  assert.deepEqual(element.tags.map(({ itemId, start, end }) => ({ itemId, start, end })), [
    { itemId: 'prop', start: 2, end: 8 },
  ]);
  assert.equal(removeProductionTags(element, 4, 6), 1);
  assert.deepEqual(element.tags.map(({ start, end }) => ({ start, end })), [
    { start: 2, end: 4 }, { start: 6, end: 8 },
  ]);
});

t('text replacements, splits, and joins keep tag offsets anchored', () => {
  const element = createElement(ElementType.ACTION, 'Take the red car.', {
    tags: [{ id: 'tag1', itemId: 'car', start: 9, end: 16 }],
  });
  replaceElementText(element, 0, 0, 'Please ');
  assert.deepEqual(element.tags.map(({ start, end }) => ({ start, end })), [{ start: 16, end: 23 }]);
  replaceElementText(element, 20, 23, 'truck');
  assert.equal(element.text.slice(element.tags[0].start, element.tags[0].end), 'red truck');
  const [left, right] = splitOffsetRanges(element.tags, 20);
  const joined = appendOffsetRanges(left, right, 20);
  assert.equal(joined.length, 2);
  assert.deepEqual(joined.map(({ start, end }) => ({ start, end })), [
    { start: 16, end: 20 }, { start: 20, end: 25 },
  ]);
  assert.deepEqual(
    mergeTagRanges(joined).map(({ start, end }) => ({ start, end })),
    [{ start: 16, end: 25 }]
  );

  const heading = createElement(ElementType.SCENE_HEADING, 'INT. CLUB - NIGHT', {
    tags: [{ id: 'place', itemId: 'club', start: 5, end: 9 }],
  });
  replaceElementTextByDiff(heading, 'INT. JAZZ CLUB - NIGHT');
  assert.equal(heading.text.slice(heading.tags[0].start, heading.tags[0].end), 'CLUB');
});

t('native save/open normalizes ranges and removes dangling item references', () => {
  const { doc, action } = taggedDocument();
  action.tags.push({ id: 'bad', itemId: 'missing', start: 0, end: 500 });
  const opened = parseProject(serializeProject(doc));
  assert.equal(opened.elements[1].tags.length, 1);
  assert.equal(opened.elements[1].tags[0].itemId, doc.production.items[0].id);
  assert.equal(opened.elements[1].tags[0].end, 28);
  assert.equal(documentHasProductionTags(opened), true);
  const recovered = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(recovered.elements[1].tags.length, 1);
});

t('undo clones production data and tag ranges without aliasing', () => {
  const { doc } = taggedDocument();
  const cloned = cloneDocument(doc);
  cloned.production.items[0].name = 'Changed';
  cloned.elements[1].tags[0].start = 0;
  assert.equal(doc.production.items[0].name, 'Silver lighter');
  assert.equal(doc.elements[1].tags[0].start, 14);
});

t('breakdown reports group occurrences by scene and export clean CSV', () => {
  const { doc, prop, action } = taggedDocument();
  applyProductionTag(action, prop.id, 0, 4);
  const pagination = paginate(doc, resolveStyles());
  const rows = breakdownReport(doc, pagination);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, 'Silver lighter');
  assert.equal(rows[0].count, 2);
  assert.deepEqual(rows[0].excerpts, ['Mara', 'silver lighter']);
  const csv = toCSV(rows, BREAKDOWN_COLUMNS);
  assert.match(csv, /Category,Item,Occurrences/);
  assert.match(csv, /Props,Silver lighter,2/);
  assert.match(toCSV([{ value: '=HYPERLINK("x")' }], [{ label: 'Value', get: (row) => row.value }]), /'=HYPERLINK/);
  assert.match(toCSV([{ value: ['@SUM(1)', 'safe'] }], [{ label: 'Value', get: (row) => row.value }]), /'@SUM/);
});

t('breakdown keeps tagged material before the first scene as unassigned', () => {
  const { doc, prop } = taggedDocument();
  const preamble = createElement(ElementType.GENERAL, 'A cold open image.');
  applyProductionTag(preamble, prop.id, 2, 6);
  doc.elements.unshift(preamble);
  const rows = breakdownReport(doc, paginate(doc, resolveStyles()));
  const unassigned = rows.find((row) => row.sceneId === null);
  assert.equal(unassigned.heading, 'Before first scene');
  assert.deepEqual(unassigned.excerpts, ['cold']);
});

t('malformed tag coordinates and duplicate identifiers are repaired safely', () => {
  const registry = createProductionRegistry();
  const item = ensureProductionItem(registry, 'props', 'Key');
  const tags = normalizeElementTags([
    { id: 'same', itemId: item.id, start: -3, end: 2 },
    { id: 'same', itemId: item.id, start: 5, end: 100 },
    { id: 'nan', itemId: item.id, start: 'x', end: 2 },
  ], 8, registry);
  assert.deepEqual(tags.map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 2 }, { start: 5, end: 8 },
  ]);
  assert.equal(new Set(tags.map((tag) => tag.id)).size, 2);
});

t('toolbar, menu, renderer, sidebar, report, and interchange warnings are wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/ui/editor.js', import.meta.url), 'utf8');
  const render = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../src/ui/dialogs.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(html, /id="tb-tag"/);
  assert.match(html, /id="pane-breakdown"/);
  assert.match(main, /menu:production-tag/);
  assert.match(preload, /menu:production-tag/);
  assert.match(render, /className = 'production-tag'/);
  assert.match(render, /setAttribute\('role', 'mark'\)/);
  assert.match(render, /target\.tabIndex = 0/);
  assert.match(editor, /textReplacementDifference\(el\.text, text\)/);
  assert.match(editor, /mergeTagRanges\(appendOffsetRanges/);
  assert.match(dialogs, /Breakdown: \[breakdownReport/);
  assert.match(dialogs, /itemId = '';\s*itemSelect\.value = '';/);
  assert.match(app, /production tags/);
});

console.log(`\n${pass} production-tagging checks passed.`);
