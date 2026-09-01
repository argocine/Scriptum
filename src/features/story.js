/** Story map: acts, sequences, parallel lanes, and beats anchored to scenes. */

import { getScenes } from '../core/model.js';

export const STORY_SCHEMA_VERSION = 1;
export const MAX_STORY_SECTIONS = 100;
export const MAX_STORY_LANES = 40;
export const MAX_STORY_BEATS = 2000;

let storyIdCounter = 0;
function storyId(prefix) {
  storyIdCounter += 1;
  return `${prefix}${Date.now().toString(36)}${storyIdCounter.toString(36)}`;
}

export function createStoryMap() {
  return {
    schemaVersion: STORY_SCHEMA_VERSION,
    sections: [],
    lanes: [{ id: storyId('lane'), name: 'Main Story', color: '#5b8dff', order: 1 }],
    beats: [],
  };
}

export function normalizeStoryMap(value, validSceneIds = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createStoryMap();
  const hasEntries = ['sections', 'lanes', 'beats'].some(
    (key) => Array.isArray(value[key]) && value[key].length
  );
  if (value.schemaVersion === undefined && hasEntries) {
    throw new Error('This screenplay contains Story Timeline entries without a schema version.');
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== STORY_SCHEMA_VERSION) {
    if (Number.isInteger(value.schemaVersion) && value.schemaVersion > STORY_SCHEMA_VERSION) {
      throw new Error(
        'This screenplay contains a story timeline from a newer version of Scriptum. Update the app to open it.'
      );
    }
    throw new Error('This screenplay contains an invalid story timeline schema version.');
  }
  if (
    (Array.isArray(value.sections) && value.sections.length > MAX_STORY_SECTIONS) ||
    (Array.isArray(value.lanes) && value.lanes.length > MAX_STORY_LANES) ||
    (Array.isArray(value.beats) && value.beats.length > MAX_STORY_BEATS)
  ) {
    throw new Error('This screenplay contains more story timeline entries than Scriptum can safely open.');
  }

  const laneIds = new Set();
  const lanes = [];
  for (const raw of Array.isArray(value.lanes) ? value.lanes : []) {
    if (!record(raw)) continue;
    let id = validId(raw.id) || storyId('lane');
    while (laneIds.has(id)) id = storyId('lane');
    laneIds.add(id);
    lanes.push({
      id,
      name: safeText(raw.name, `Story Lane ${lanes.length + 1}`, 120),
      color: safeColor(raw.color, '#5b8dff'),
      order: finiteOrder(raw.order, lanes.length + 1),
    });
  }
  if (!lanes.length) {
    const initial = createStoryMap().lanes[0];
    lanes.push(initial);
    laneIds.add(initial.id);
  }

  const sectionIds = new Set();
  const sections = [];
  for (const raw of Array.isArray(value.sections) ? value.sections : []) {
    if (!record(raw)) continue;
    let id = validId(raw.id) || storyId('section');
    while (sectionIds.has(id)) id = storyId('section');
    sectionIds.add(id);
    sections.push({
      id,
      kind: raw.kind === 'sequence' ? 'sequence' : 'act',
      name: safeText(raw.name, raw.kind === 'sequence' ? 'Sequence' : 'Act', 120),
      startSceneId: sceneIdOrNull(raw.startSceneId, validSceneIds),
      color: safeColor(raw.color, raw.kind === 'sequence' ? '#8c75d6' : '#e06a80'),
      order: finiteOrder(raw.order, sections.length + 1),
    });
  }

  const beatIds = new Set();
  const beats = [];
  for (const raw of Array.isArray(value.beats) ? value.beats : []) {
    if (!record(raw)) continue;
    let id = validId(raw.id) || storyId('beat');
    while (beatIds.has(id)) id = storyId('beat');
    beatIds.add(id);
    beats.push({
      id,
      title: safeText(raw.title, `Beat ${beats.length + 1}`, 160),
      description: safeText(raw.description, '', 4000),
      sceneId: sceneIdOrNull(raw.sceneId, validSceneIds),
      laneId: typeof raw.laneId === 'string' && laneIds.has(raw.laneId) ? raw.laneId : null,
      color: safeColor(raw.color, '#e6c25a'),
      order: finiteOrder(raw.order, beats.length + 1),
    });
  }

  return {
    schemaVersion: STORY_SCHEMA_VERSION,
    sections: sections.sort(byOrder),
    lanes: lanes.sort(byOrder),
    beats: beats.sort(byOrder),
  };
}

export function addStorySection(story, values = {}) {
  if (!story || story.sections.length >= MAX_STORY_SECTIONS) return null;
  const section = {
    id: storyId('section'),
    kind: values.kind === 'sequence' ? 'sequence' : 'act',
    name: safeText(values.name, values.kind === 'sequence' ? 'Sequence' : 'Act', 120),
    startSceneId: typeof values.startSceneId === 'string' ? values.startSceneId : null,
    color: safeColor(values.color, values.kind === 'sequence' ? '#8c75d6' : '#e06a80'),
    order: nextOrder(story.sections),
  };
  story.sections.push(section);
  return section;
}

export function addStoryLane(story, values = {}) {
  if (!story || story.lanes.length >= MAX_STORY_LANES) return null;
  const lane = {
    id: storyId('lane'),
    name: safeText(values.name, `Story Lane ${story.lanes.length + 1}`, 120),
    color: safeColor(values.color, '#5b8dff'),
    order: nextOrder(story.lanes),
  };
  story.lanes.push(lane);
  return lane;
}

export function addStoryBeat(story, values = {}) {
  if (!story || story.beats.length >= MAX_STORY_BEATS) return null;
  const laneId = typeof values.laneId === 'string' ? values.laneId : null;
  const beat = {
    id: storyId('beat'),
    title: safeText(values.title, `Beat ${story.beats.length + 1}`, 160),
    description: safeText(values.description, '', 4000),
    sceneId: typeof values.sceneId === 'string' ? values.sceneId : null,
    laneId: story.lanes.some((lane) => lane.id === laneId) ? laneId : null,
    color: safeColor(values.color, '#e6c25a'),
    order: nextOrder(story.beats),
  };
  story.beats.push(beat);
  return beat;
}

export function updateStoryEntry(story, collection, id, values = {}) {
  const entries = story?.[collection];
  const entry = Array.isArray(entries) ? entries.find((candidate) => candidate.id === id) : null;
  if (!entry) return false;
  if (collection === 'sections') {
    entry.kind = values.kind === 'sequence' ? 'sequence' : 'act';
    entry.name = safeText(values.name, entry.name, 120);
    entry.startSceneId = typeof values.startSceneId === 'string' ? values.startSceneId : null;
    entry.color = safeColor(values.color, entry.color);
  } else if (collection === 'lanes') {
    entry.name = safeText(values.name, entry.name, 120);
    entry.color = safeColor(values.color, entry.color);
  } else if (collection === 'beats') {
    entry.title = safeText(values.title, entry.title, 160);
    entry.description = safeText(values.description, '', 4000);
    entry.sceneId = typeof values.sceneId === 'string' ? values.sceneId : null;
    const laneId = typeof values.laneId === 'string' ? values.laneId : null;
    entry.laneId = story.lanes.some((lane) => lane.id === laneId) ? laneId : null;
    entry.color = safeColor(values.color, entry.color);
  } else return false;
  return true;
}

export function deleteStoryEntry(story, collection, id) {
  const entries = story?.[collection];
  if (!Array.isArray(entries)) return false;
  if (collection === 'lanes' && entries.length <= 1) return false;
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return false;
  entries.splice(index, 1);
  if (collection === 'lanes') {
    for (const beat of story.beats || []) if (beat.laneId === id) beat.laneId = null;
  }
  return true;
}

export function resolveStoryTimeline(doc, pagination) {
  const scenes = getScenes(doc);
  const story = doc?.story || createStoryMap();
  const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
  const pageByElement = new Map();
  for (const [pageIndex, page] of (pagination?.pages || []).entries()) {
    for (const line of page.lines || []) {
      const ids = [line.elementId, line.left?.elementId, line.right?.elementId].filter(Boolean);
      for (const id of ids) {
        if (!pageByElement.has(id)) pageByElement.set(id, page.number || String(pageIndex + 1));
      }
    }
  }
  const placedSections = [];
  const unplacedSections = [];
  for (const section of story.sections) {
    const index = sceneIndex.get(section.startSceneId);
    const resolved = { ...section, sceneIndex: Number.isInteger(index) ? index : null };
    if (Number.isInteger(index)) placedSections.push(resolved);
    else unplacedSections.push(resolved);
  }
  placedSections.sort((a, b) => a.sceneIndex - b.sceneIndex || a.order - b.order);

  const placedBeats = [];
  const unplacedBeats = [];
  for (const beat of story.beats) {
    const index = sceneIndex.get(beat.sceneId);
    const resolved = { ...beat, sceneIndex: Number.isInteger(index) ? index : null };
    if (Number.isInteger(index)) placedBeats.push(resolved);
    else unplacedBeats.push(resolved);
  }
  return {
    scenes: scenes.map((scene, index) => ({
      ...scene,
      storyIndex: index,
      page: pageByElement.get(scene.id) || '',
    })),
    lanes: [...story.lanes].sort(byOrder),
    sections: placedSections,
    unplacedSections,
    beats: placedBeats.sort((a, b) => a.sceneIndex - b.sceneIndex || a.order - b.order),
    unplacedBeats: unplacedBeats.sort(byOrder),
  };
}

export function documentHasStoryMap(doc) {
  const story = doc?.story;
  if (!story) return false;
  if (story.sections?.length || story.beats?.length) return true;
  if (!Array.isArray(story.lanes) || story.lanes.length !== 1) return true;
  const lane = story.lanes[0];
  return lane.name !== 'Main Story' || lane.color !== '#5b8dff' || lane.order !== 1;
}

function sceneIdOrNull(value, validSceneIds) {
  if (typeof value !== 'string' || !value) return null;
  if (validSceneIds instanceof Set && !validSceneIds.has(value)) return null;
  return value;
}

function nextOrder(entries) {
  return Math.max(0, ...entries.map((entry) => finiteOrder(entry.order, 0))) + 1;
}

function finiteOrder(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function byOrder(a, b) {
  return a.order - b.order || a.id.localeCompare(b.id);
}

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
    ? value
    : '';
}

function safeText(value, fallback, max) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  return (text || fallback).slice(0, max);
}

function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
