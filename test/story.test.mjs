import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType, resolveStyles } from '../src/core/format.js';
import { cloneDocument, createDocument, createElement, getScenes } from '../src/core/model.js';
import { paginate } from '../src/core/paginate.js';
import { CardBoard } from '../src/features/cards.js';
import { createRevisionSnapshot } from '../src/features/snapshots.js';
import {
  MAX_STORY_BEATS,
  MAX_STORY_LANES,
  MAX_STORY_SECTIONS,
  addStoryBeat,
  addStoryLane,
  addStorySection,
  createStoryMap,
  deleteStoryEntry,
  documentHasStoryMap,
  normalizeStoryMap,
  resolveStoryTimeline,
  updateStoryEntry,
} from '../src/features/story.js';
import { parseProject, serializeProject } from '../src/io/project.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nStory Timeline');

function screenplay() {
  return createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. OFFICE - DAY', { id: 'scene-a' }),
      createElement(ElementType.ACTION, 'A beginning.', { id: 'action-a' }),
      createElement(ElementType.SCENE_HEADING, 'EXT. STREET - NIGHT', { id: 'scene-b' }),
      createElement(ElementType.ACTION, 'A turn.', { id: 'action-b' }),
      createElement(ElementType.SCENE_HEADING, 'INT. HOME - DAWN', { id: 'scene-c' }),
    ],
  });
}

t('new documents begin with a local main story lane', () => {
  const doc = screenplay();
  assert.equal(doc.story.schemaVersion, 1);
  assert.equal(doc.story.lanes.length, 1);
  assert.equal(doc.story.lanes[0].name, 'Main Story');
  assert.equal(documentHasStoryMap(doc), false);
});

t('normalization repairs identifiers and drops dangling anchors', () => {
  const story = normalizeStoryMap({
    schemaVersion: 1,
    sections: [
      { id: 'same', kind: 'act', name: ' Act One ', startSceneId: 'scene-a', color: '#ABCDEF' },
      { id: 'same', kind: 'sequence', name: 'Missing scene', startSceneId: 'gone' },
    ],
    lanes: [
      { id: 'lane', name: 'A', order: 5 },
      { id: 'lane', name: 'B', order: 2 },
    ],
    beats: [
      { id: 'beat', title: 'Door opens', sceneId: 'scene-b', laneId: 'lane' },
      { id: 'beat', title: 'Ghost', sceneId: 'gone', laneId: 'missing' },
    ],
  }, new Set(['scene-a', 'scene-b']));
  assert.equal(new Set(story.sections.map((entry) => entry.id)).size, 2);
  assert.equal(new Set(story.lanes.map((entry) => entry.id)).size, 2);
  assert.equal(new Set(story.beats.map((entry) => entry.id)).size, 2);
  assert.equal(story.sections.find((entry) => entry.name === 'Act One').color, '#abcdef');
  assert.equal(story.sections.find((entry) => entry.name === 'Missing scene').startSceneId, null);
  assert.equal(story.beats.find((entry) => entry.title === 'Ghost').sceneId, null);
  assert.equal(story.beats.find((entry) => entry.title === 'Ghost').laneId, null);
});

t('invalid, future, missing, and oversized schemas are refused', () => {
  assert.throws(() => normalizeStoryMap({ schemaVersion: 2 }), /newer version of Scriptum/);
  assert.throws(() => normalizeStoryMap({ schemaVersion: '1' }), /invalid story timeline schema/i);
  assert.throws(() => normalizeStoryMap({ lanes: [{ id: 'lane' }] }), /without a schema version/i);
  assert.throws(
    () => normalizeStoryMap({ schemaVersion: 1, sections: new Array(MAX_STORY_SECTIONS + 1).fill({}) }),
    /more story timeline entries/i
  );
  assert.throws(
    () => normalizeStoryMap({ schemaVersion: 1, lanes: new Array(MAX_STORY_LANES + 1).fill({}) }),
    /more story timeline entries/i
  );
  assert.throws(
    () => normalizeStoryMap({ schemaVersion: 1, beats: new Array(MAX_STORY_BEATS + 1).fill({}) }),
    /more story timeline entries/i
  );
});

t('acts, sequences, lanes, and beats support bounded CRUD', () => {
  const story = createStoryMap();
  const act = addStorySection(story, { kind: 'act', name: 'Act I', startSceneId: 'scene-a' });
  const sequence = addStorySection(story, { kind: 'sequence', name: 'Escape', startSceneId: 'scene-b' });
  const lane = addStoryLane(story, { name: 'Antagonist' });
  const beat = addStoryBeat(story, {
    title: 'The trap', description: 'The plan closes in.', sceneId: 'scene-b', laneId: lane.id,
  });
  const unassigned = addStoryBeat(story, { title: 'Unknown lane', laneId: 'missing' });
  assert.equal(unassigned.laneId, null);
  assert.equal(updateStoryEntry(story, 'sections', act.id, {
    kind: 'act', name: 'Act One', startSceneId: 'scene-a', color: '#123456',
  }), true);
  assert.equal(updateStoryEntry(story, 'beats', beat.id, {
    title: 'The trap tightens', description: '', sceneId: 'scene-c', laneId: lane.id, color: '#654321',
  }), true);
  assert.equal(story.sections.find((entry) => entry.id === act.id).name, 'Act One');
  assert.equal(story.beats[0].sceneId, 'scene-c');
  assert.equal(deleteStoryEntry(story, 'sections', sequence.id), true);
  assert.equal(deleteStoryEntry(story, 'lanes', lane.id), true);
  assert.equal(story.beats[0].laneId, null);
  assert.equal(deleteStoryEntry(story, 'lanes', story.lanes[0].id), false);
});

t('the live timeline resolves scene order, pages, lanes, and unplaced work', () => {
  const doc = screenplay();
  const lane = addStoryLane(doc.story, { name: 'Mystery' });
  addStorySection(doc.story, { kind: 'act', name: 'Act I', startSceneId: 'scene-a' });
  addStorySection(doc.story, { kind: 'sequence', name: 'Unplaced sequence' });
  addStoryBeat(doc.story, { title: 'Clue', sceneId: 'scene-b', laneId: lane.id });
  addStoryBeat(doc.story, { title: 'Spare idea' });
  const result = resolveStoryTimeline(doc, paginate(doc, resolveStyles()));
  assert.deepEqual(result.scenes.map((scene) => scene.id), ['scene-a', 'scene-b', 'scene-c']);
  assert.ok(result.scenes.every((scene) => scene.page >= 1));
  assert.equal(result.sections[0].sceneIndex, 0);
  assert.equal(result.unplacedSections[0].name, 'Unplaced sequence');
  assert.equal(result.beats[0].sceneIndex, 1);
  assert.equal(result.unplacedBeats[0].title, 'Spare idea');
  const locked = resolveStoryTimeline(doc, {
    pages: [{ number: '12A', lines: [{ elementId: 'scene-a' }] }],
  });
  assert.equal(locked.scenes[0].page, '12A');
});

t('moving cards keeps story entries attached to stable scene identifiers', () => {
  const doc = screenplay();
  addStoryBeat(doc.story, { title: 'Attached', sceneId: 'scene-a', laneId: doc.story.lanes[0].id });
  const editor = {
    doc,
    commit(fn) { fn(); },
  };
  CardBoard.prototype.moveScene.call({ editor, render() {} }, 'scene-a', null);
  assert.deepEqual(getScenes(doc).map((scene) => scene.id), ['scene-b', 'scene-c', 'scene-a']);
  const timeline = resolveStoryTimeline(doc, paginate(doc, resolveStyles()));
  assert.equal(timeline.beats[0].sceneIndex, 2);
  assert.equal(timeline.beats[0].sceneId, 'scene-a');
});

t('save/open, undo, and Revision Room preserve story data without aliasing', () => {
  const doc = screenplay();
  const beat = addStoryBeat(doc.story, {
    title: 'Midpoint', sceneId: 'scene-b', laneId: doc.story.lanes[0].id,
  });
  const opened = parseProject(serializeProject(doc));
  assert.equal(opened.story.beats[0].title, 'Midpoint');
  const clone = cloneDocument(opened);
  clone.story.beats[0].title = 'Changed';
  assert.equal(opened.story.beats[0].title, 'Midpoint');
  const snapshot = createRevisionSnapshot(opened, { name: 'Mapped' }).snapshot;
  assert.equal(snapshot.state.story.beats[0].id, beat.id);
  assert.equal(Object.isFrozen(snapshot.state.story.beats[0]), true);
});

t('lane-only customization counts as timeline data omitted by interchange exports', () => {
  const doc = screenplay();
  doc.story.lanes[0].color = '#123456';
  assert.equal(documentHasStoryMap(doc), true);
  doc.story.lanes[0].color = '#5b8dff';
  doc.story.lanes.push({ ...doc.story.lanes[0], id: 'lane-two' });
  assert.equal(documentHasStoryMap(doc), true);
});

t('timeline controls, accessible tabs, native commands, and interchange warning are wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const timeline = fs.readFileSync(new URL('../src/features/story-timeline.js', import.meta.url), 'utf8');
  assert.match(html, /id="tb-timeline"/);
  assert.match(html, /role="tablist" aria-label="Story planning views"/);
  assert.match(html, /id="story-timeline" role="tabpanel"/);
  assert.match(app, /wireBoardTabs\(\)/);
  assert.match(app, /event\.key !== 'Escape'/);
  assert.match(app, /Story Timeline data/);
  assert.match(main, /menu:timeline/);
  assert.match(preload, /menu:timeline/);
  assert.match(timeline, /textContent = beat\.title/);
  assert.match(timeline, /aria-label', 'Unplaced story items'/);
  assert.match(timeline, /this\.host\.appendChild\(this\.laneTray\(timeline\)\)/);
  assert.match(timeline, /story-section-stack/);
  assert.match(timeline, /focusEntry\(id\)/);
});

console.log(`\n${pass} Story Timeline checks passed.`);
