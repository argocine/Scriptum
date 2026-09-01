import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType } from '../src/core/format.js';
import { cloneDocument, createDocument, createElement } from '../src/core/model.js';
import {
  MAX_SNAPSHOTS,
  compareDocumentStates,
  compareSnapshotToDocument,
  createRevisionSnapshot,
  deleteRevisionSnapshot,
  normalizeRevisionRoom,
  restoreRevisionSnapshot,
  revisionChangeReportText,
  snapshotDocumentState,
} from '../src/features/snapshots.js';
import { normalizeDocument, parseProject, serializeProject } from '../src/io/project.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nRevision Room');

function screenplay() {
  return createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. ROOM - DAY', { id: 'a' }),
      createElement(ElementType.ACTION, 'One.', { id: 'b' }),
      createElement(ElementType.ACTION, 'Two.', { id: 'c' }),
    ],
  });
}

t('snapshot bodies are immutable and explicitly non-recursive', () => {
  const doc = screenplay();
  const result = createRevisionSnapshot(doc, {
    name: 'Before the rewrite',
    note: 'Keep the spare version.',
    created: '2026-08-31T12:00:00.000Z',
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.state.revisionRoom, undefined);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot.state.elements[0]), true);
  doc.elements[1].text = 'Changed.';
  assert.equal(result.snapshot.state.elements[1].text, 'One.');
});

t('snapshot limits and deletion are explicit rather than silently pruning history', () => {
  const doc = screenplay();
  for (let i = 0; i < MAX_SNAPSHOTS; i += 1) {
    assert.equal(createRevisionSnapshot(doc, { name: `Take ${i + 1}` }).ok, true);
  }
  const blocked = createRevisionSnapshot(doc, { name: 'Too many' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Delete one/);
  assert.equal(deleteRevisionSnapshot(doc, doc.revisionRoom.snapshots[0].id), true);
  assert.equal(doc.revisionRoom.snapshots.length, MAX_SNAPSHOTS - 1);
});

t('normalization repairs duplicate ids and rejects future or oversized histories', () => {
  const state = snapshotDocumentState(screenplay());
  const room = normalizeRevisionRoom({
    schemaVersion: 1,
    snapshots: [
      { id: 'same', name: 'A', created: 'bad', state },
      { id: 'same', name: 'B', created: '2026-01-01T00:00:00Z', state: { ...state, revisionRoom: {} } },
    ],
  });
  assert.equal(new Set(room.snapshots.map((entry) => entry.id)).size, 2);
  assert.equal(room.snapshots[1].state.revisionRoom, undefined);
  assert.throws(() => normalizeRevisionRoom({ schemaVersion: 2 }), /newer version/);
  assert.throws(() => normalizeRevisionRoom({ schemaVersion: '2' }), /invalid Revision Room schema/);
  assert.throws(
    () => normalizeRevisionRoom({ snapshots: [{ state }] }),
    /without a schema version/
  );
  assert.throws(
    () => normalizeRevisionRoom({ schemaVersion: 1, snapshots: new Array(MAX_SNAPSHOTS + 1).fill({ state }) }),
    /more than/
  );
});

t('hostile snapshot state is bounded, hydrated, and cannot alter the document prototype', () => {
  const original = screenplay();
  const state = snapshotDocumentState(original);
  state.elements[1].id = 'a';
  state.elements.push(null);
  Object.defineProperty(state, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
  });
  const payload = JSON.stringify({
    format: 'scriptum-screenplay',
    formatVersion: 1,
    document: {
      ...original,
      revisionRoom: {
        schemaVersion: 1,
        snapshots: [{ id: 'hostile', name: 'Hostile', state }],
      },
    },
  });
  const opened = parseProject(payload);
  const ids = opened.revisionRoom.snapshots[0].state.elements.map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(opened.revisionRoom.snapshots[0].state.elements.every(Boolean));
  const restored = restoreRevisionSnapshot(opened, 'hostile', { normalizeState: normalizeDocument });
  assert.equal(restored.ok, true);
  assert.equal(Object.getPrototypeOf(opened), Object.prototype);
  assert.equal(Object.getPrototypeOf(opened).polluted, undefined);
  assert.equal(Object.hasOwn(opened, '__proto__'), false);

  const tooDeep = { elements: [] };
  let cursor = tooDeep;
  for (let i = 0; i < 90; i += 1) cursor = cursor.child = {};
  assert.throws(
    () => normalizeRevisionRoom({ schemaVersion: 1, snapshots: [{ state: tooDeep }] }),
    /safe nesting limit/
  );
});

t('direct comparisons reject duplicate or malformed element identifiers instead of lying', () => {
  assert.throws(
    () => compareDocumentStates(
      { elements: [{ id: 'dup', text: 'A' }, { id: 'dup', text: 'B' }] },
      { elements: [{ id: 'dup', text: 'A' }] }
    ),
    /duplicate screenplay element identifiers/
  );
  assert.throws(
    () => compareDocumentStates({ elements: [null] }, { elements: [] }),
    /invalid or duplicate/
  );
});

t('inserting an element does not falsely mark every later element as moved', () => {
  const before = snapshotDocumentState(screenplay());
  const after = JSON.parse(JSON.stringify(before));
  after.elements.splice(1, 0, createElement(ElementType.ACTION, 'Inserted.', { id: 'x' }));
  const diff = compareDocumentStates(before, after);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.moved, 0);
  assert.deepEqual(diff.changes.map((entry) => entry.elementId), ['x']);
});

t('comparison distinguishes added, removed, changed, moved, and document settings', () => {
  const before = snapshotDocumentState(screenplay());
  const after = JSON.parse(JSON.stringify(before));
  after.title.title = 'A NEW TITLE';
  after.elements = [
    after.elements[0],
    after.elements[2],
    { ...after.elements[1], text: 'One, rewritten.' },
    createElement(ElementType.ACTION, 'Three.', { id: 'd' }),
  ];
  const diff = compareDocumentStates(before, after);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.removed, 0);
  assert.equal(diff.counts.changed, 1);
  assert.equal(diff.counts.moved, 1);
  assert.deepEqual(diff.documentChanges, ['title']);
  assert.ok(diff.changes.some((entry) => entry.kind === 'changed' && entry.fields.includes('text')));
});

t('restore always creates a safety snapshot and keeps the whole room available', () => {
  const doc = screenplay();
  const saved = createRevisionSnapshot(doc, { name: 'Clean draft' }).snapshot;
  doc.elements[1].text = 'Risky rewrite.';
  const result = restoreRevisionSnapshot(doc, saved.id, { normalizeState: normalizeDocument });
  assert.equal(result.ok, true);
  assert.equal(doc.elements[1].text, 'One.');
  assert.equal(doc.revisionRoom.snapshots.length, 2);
  assert.match(result.safetySnapshot.name, /Before restoring/);
  assert.equal(result.safetySnapshot.state.elements[1].text, 'Risky rewrite.');
});

t('native save/open and undo preserve immutable snapshot history without aliasing the list', () => {
  const doc = screenplay();
  createRevisionSnapshot(doc, { name: 'Saved' });
  const opened = parseProject(serializeProject(doc));
  assert.equal(opened.revisionRoom.snapshots[0].name, 'Saved');
  assert.equal(opened.revisionRoom.snapshots[0].state.revisionRoom, undefined);
  const cloned = cloneDocument(opened);
  cloned.revisionRoom.snapshots = [];
  assert.equal(opened.revisionRoom.snapshots.length, 1);
});

t('change reports are deterministic, readable, and compare snapshots to current work', () => {
  const doc = screenplay();
  const saved = createRevisionSnapshot(doc, { name: 'First Pass' }).snapshot;
  doc.elements[1].text = 'One, changed.';
  const comparison = compareSnapshotToDocument(saved, doc);
  const report = revisionChangeReportText(comparison, saved.name);
  assert.match(report, /First Pass TO CURRENT/);
  assert.match(report, /Changed: 1/);
  assert.match(report, /CHANGED — Scene 1/);
  assert.equal(report, revisionChangeReportText(comparison, saved.name));
});

t('toolbar, native menu, dialog, safe restore, export, and interchange warning are wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../src/ui/dialogs.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(html, /id="tb-revision-room"/);
  assert.match(main, /menu:revision-room/);
  assert.match(preload, /menu:revision-room/);
  assert.match(dialogs, /createRevisionSnapshot/);
  assert.match(dialogs, /restoreRevisionSnapshot/);
  assert.match(dialogs, /automatic safety snapshot/i);
  assert.match(dialogs, /revisionChangeReportText/);
  assert.match(dialogs, /aria-live': 'polite'/);
  assert.match(dialogs, /snapshot-row\.active'\)\?\.focus/);
  const snapshotsSource = fs.readFileSync(new URL('../src/features/snapshots.js', import.meta.url), 'utf8');
  assert.match(snapshotsSource, /retainedUnits \+= validateSnapshotComplexity\(state\)/);
  assert.match(app, /Revision Room snapshots/);
});

console.log(`\n${pass} Revision Room checks passed.`);
