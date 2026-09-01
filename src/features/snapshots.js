/**
 * Revision Room: named, local snapshots and deterministic screenplay diffs.
 * Snapshot bodies never include revisionRoom itself, preventing recursive
 * growth when checkpoints are saved inside the native .scriptum document.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_SNAPSHOTS = 20;
export const MAX_SNAPSHOT_DEPTH = 80;
export const MAX_SNAPSHOT_UNITS = 16 * 1024 * 1024;
export const MAX_REVISION_ROOM_UNITS = 64 * 1024 * 1024;
export const MAX_SNAPSHOT_ELEMENTS = 25000;

let snapshotIdCounter = 0;
function snapshotId() {
  snapshotIdCounter += 1;
  return `snapshot${Date.now().toString(36)}${snapshotIdCounter.toString(36)}`;
}

export function createRevisionRoom() {
  return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, snapshots: [] };
}

export function snapshotDocumentState(doc) {
  const { revisionRoom: _history, ...state } = doc || {};
  validateSnapshotComplexity(state);
  return deepClone(state);
}

export function createRevisionSnapshot(doc, { name, note = '', created } = {}) {
  const room = doc.revisionRoom || (doc.revisionRoom = createRevisionRoom());
  if (room.snapshots.length >= MAX_SNAPSHOTS) {
    return { ok: false, reason: `Revision Room holds up to ${MAX_SNAPSHOTS} snapshots. Delete one before adding another.` };
  }
  let state;
  try {
    state = snapshotDocumentState(doc);
    const total = room.snapshots.reduce(
      (sum, snapshot) => sum + validateSnapshotComplexity(snapshot.state),
      validateSnapshotComplexity(state)
    );
    if (total > MAX_REVISION_ROOM_UNITS) {
      return {
        ok: false,
        reason: 'Revision Room has reached its local storage limit. Delete an older snapshot before adding another.',
      };
    }
  } catch (error) {
    return { ok: false, reason: String(error.message || error) };
  }
  const snapshot = Object.freeze({
    id: snapshotId(),
    name: safeText(name, `Snapshot ${room.snapshots.length + 1}`, 120),
    note: safeText(note, '', 2000),
    created: validDate(created) || new Date().toISOString(),
    state: deepFreeze(state),
  });
  room.snapshots.push(snapshot);
  return { ok: true, snapshot };
}

export function deleteRevisionSnapshot(doc, id) {
  const room = doc?.revisionRoom;
  if (!room || !Array.isArray(room.snapshots)) return false;
  const next = room.snapshots.filter((snapshot) => snapshot.id !== id);
  if (next.length === room.snapshots.length) return false;
  room.snapshots = next;
  return true;
}

export function restoreRevisionSnapshot(doc, id, { normalizeState } = {}) {
  const room = doc?.revisionRoom;
  const snapshot = room?.snapshots?.find((entry) => entry.id === id);
  if (!snapshot) return { ok: false, reason: 'That snapshot no longer exists.' };
  let restored = deepClone(snapshot.state);
  if (typeof normalizeState === 'function') restored = normalizeState(restored);

  if (room.snapshots.length >= MAX_SNAPSHOTS) {
    return {
      ok: false,
      reason: `Delete one snapshot first so Scriptum can make a safety copy before restoring.`,
    };
  }

  const safety = createRevisionSnapshot(doc, {
    name: `Before restoring “${snapshot.name}”`,
    note: 'Automatic safety snapshot.',
  });
  if (!safety.ok) return safety;

  const preservedRoom = doc.revisionRoom;
  for (const key of Object.keys(doc)) delete doc[key];
  Object.setPrototypeOf(doc, Object.prototype);
  for (const [key, value] of Object.entries(restored)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    Object.defineProperty(doc, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(doc, 'revisionRoom', {
    value: preservedRoom,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return { ok: true, snapshot, safetySnapshot: safety.snapshot };
}

export function normalizeRevisionRoom(value, { normalizeState } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createRevisionRoom();
  const incomingSnapshots = Array.isArray(value.snapshots) ? value.snapshots : [];
  if (value.schemaVersion === undefined && incomingSnapshots.length) {
    throw new Error('This screenplay contains Revision Room snapshots without a schema version.');
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    if (Number.isInteger(value.schemaVersion) && value.schemaVersion > SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(
        'This screenplay contains Revision Room snapshots from a newer version of Scriptum. Update the app to open it.'
      );
    }
    throw new Error('This screenplay contains an invalid Revision Room schema version.');
  }
  if (Array.isArray(value.snapshots) && value.snapshots.length > MAX_SNAPSHOTS) {
    throw new Error(
      `This screenplay contains more than ${MAX_SNAPSHOTS} Revision Room snapshots. Remove extras with the version of Scriptum that created it.`
    );
  }
  const ids = new Set();
  const snapshots = [];
  let rawUnits = 0;
  let retainedUnits = 0;
  for (const raw of incomingSnapshots) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('This screenplay contains a malformed Revision Room snapshot.');
    }
    if (!raw.state || typeof raw.state !== 'object' || Array.isArray(raw.state)) {
      throw new Error('This screenplay contains a malformed Revision Room snapshot body.');
    }
    rawUnits += validateSnapshotComplexity(raw.state);
    if (rawUnits > MAX_REVISION_ROOM_UNITS) {
      throw new Error('This screenplay contains more Revision Room data than Scriptum can safely open.');
    }
    const stateSource = Object.create(null);
    for (const [key, child] of Object.entries(raw.state)) {
      if (key === 'revisionRoom' || DANGEROUS_KEYS.has(key)) continue;
      Object.defineProperty(stateSource, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    const state = typeof normalizeState === 'function'
      ? normalizeState(stateSource)
      : deepClone(stateSource);
    delete state.revisionRoom;
    validateSnapshotElements(state.elements);
    retainedUnits += validateSnapshotComplexity(state);
    if (retainedUnits > MAX_REVISION_ROOM_UNITS) {
      throw new Error('This screenplay expands to more Revision Room data than Scriptum can safely retain.');
    }
    let id = safeId(raw.id) || snapshotId();
    while (ids.has(id)) id = snapshotId();
    ids.add(id);
    snapshots.push(Object.freeze({
      id,
      name: safeText(raw.name, `Snapshot ${snapshots.length + 1}`, 120),
      note: safeText(raw.note, '', 2000),
      created: validDate(raw.created) || new Date(0).toISOString(),
      state: deepFreeze(state),
    }));
  }
  return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, snapshots };
}

export function compareSnapshotToDocument(snapshot, doc) {
  return compareDocumentStates(snapshot?.state || {}, snapshotDocumentState(doc));
}

export function compareDocumentStates(before, after) {
  const oldElements = validateSnapshotElements(before?.elements);
  const newElements = validateSnapshotElements(after?.elements);
  const oldById = new Map(oldElements.map((element, index) => [element.id, { element, index }]));
  const newById = new Map(newElements.map((element, index) => [element.id, { element, index }]));
  const stable = stableCommonIds(oldElements, newElements);
  const beforeScenes = sceneLabels(oldElements);
  const afterScenes = sceneLabels(newElements);
  const changes = [];

  for (const [id, entry] of oldById) {
    if (!newById.has(id)) {
      changes.push(change('removed', id, entry, null, beforeScenes, afterScenes));
    }
  }
  for (const [id, entry] of newById) {
    if (!oldById.has(id)) {
      changes.push(change('added', id, null, entry, beforeScenes, afterScenes));
    }
  }
  for (const [id, oldEntry] of oldById) {
    const newEntry = newById.get(id);
    if (!newEntry) continue;
    const fields = changedElementFields(oldEntry.element, newEntry.element);
    if (fields.length) {
      changes.push(change('changed', id, oldEntry, newEntry, beforeScenes, afterScenes, fields));
    }
    if (!stable.has(id)) {
      changes.push(change('moved', id, oldEntry, newEntry, beforeScenes, afterScenes));
    }
  }

  const documentChanges = changedDocumentFields(before, after);
  const order = { removed: 0, added: 1, moved: 2, changed: 3 };
  changes.sort(
    (a, b) =>
      Math.min(a.beforeIndex ?? Infinity, a.afterIndex ?? Infinity) -
        Math.min(b.beforeIndex ?? Infinity, b.afterIndex ?? Infinity) ||
      order[a.kind] - order[b.kind] ||
      String(a.elementId).localeCompare(String(b.elementId))
  );

  const counts = { added: 0, removed: 0, moved: 0, changed: 0 };
  for (const entry of changes) counts[entry.kind] += 1;
  return { changes, documentChanges, counts, total: changes.length + documentChanges.length };
}

export function revisionChangeReportText(comparison, snapshotName = 'Snapshot') {
  const lines = [
    `REVISION ROOM — ${snapshotName} TO CURRENT`,
    '',
    `Added: ${comparison.counts.added}`,
    `Removed: ${comparison.counts.removed}`,
    `Changed: ${comparison.counts.changed}`,
    `Moved: ${comparison.counts.moved}`,
  ];
  if (comparison.documentChanges.length) {
    lines.push('', 'DOCUMENT SETTINGS');
    for (const entry of comparison.documentChanges) lines.push(`- ${entry}`);
  }
  if (comparison.changes.length) {
    lines.push('', 'SCREENPLAY CHANGES');
    for (const entry of comparison.changes) {
      const scene = entry.afterScene || entry.beforeScene || 'Before first scene';
      const label = entry.afterType || entry.beforeType || 'element';
      const fields = entry.fields?.length ? ` (${entry.fields.join(', ')})` : '';
      const text = (entry.afterText || entry.beforeText || '').replace(/\s+/g, ' ').slice(0, 120);
      lines.push(`- ${entry.kind.toUpperCase()} — ${scene} — ${label}${fields}: ${text}`);
    }
  }
  if (!comparison.total) lines.push('', 'No differences.');
  return `${lines.join('\n')}\n`;
}

function change(kind, id, before, after, beforeScenes, afterScenes, fields = []) {
  return {
    kind,
    elementId: id,
    beforeIndex: before?.index ?? null,
    afterIndex: after?.index ?? null,
    beforeType: before?.element?.type || '',
    afterType: after?.element?.type || '',
    beforeText: String(before?.element?.text || ''),
    afterText: String(after?.element?.text || ''),
    beforeScene: beforeScenes.get(id) || '',
    afterScene: afterScenes.get(id) || '',
    fields,
  };
}

function changedElementFields(before, after) {
  const ignored = new Set(['id']);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .filter((key) => !ignored.has(key) && stableJSON(before?.[key]) !== stableJSON(after?.[key]))
    .sort();
}

function changedDocumentFields(before, after) {
  const ignored = new Set(['elements', 'meta', 'revisionRoom']);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .filter((key) => !ignored.has(key) && stableJSON(before?.[key]) !== stableJSON(after?.[key]))
    .sort();
}

/** Longest increasing subsequence of current indices in original order. */
function stableCommonIds(before, after) {
  const positions = new Map(after.map((element, index) => [element.id, index]));
  const sequence = before.flatMap((element) => positions.has(element.id) ? [{ id: element.id, value: positions.get(element.id) }] : []);
  const tails = [];
  const tailIndexes = [];
  const previous = new Array(sequence.length).fill(-1);
  for (let i = 0; i < sequence.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < sequence[i].value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = sequence[i].value;
    previous[i] = lo > 0 ? tailIndexes[lo - 1] : -1;
    tailIndexes[lo] = i;
  }
  const ids = new Set();
  let cursor = tailIndexes[tails.length - 1] ?? -1;
  while (cursor >= 0) {
    ids.add(sequence[cursor].id);
    cursor = previous[cursor];
  }
  return ids;
}

function sceneLabels(elements) {
  const map = new Map();
  let scene = '';
  let number = 0;
  for (const element of elements) {
    if (element?.type === 'scene_heading') {
      number += 1;
      scene = `Scene ${element.sceneNumber || number}: ${String(element.text || '(untitled)')}`;
    }
    if (element?.id) map.set(element.id, scene);
  }
  return map;
}

function stableJSON(value) {
  if (value === undefined) return 'undefined';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  const stack = [value];
  const seen = new WeakSet();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') stack.push(child);
    }
    Object.freeze(current);
  }
  return value;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function validateSnapshotComplexity(value) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let units = 0;
  while (stack.length) {
    const current = stack.pop();
    const item = current.value;
    if (typeof item === 'string') {
      units += item.length;
    } else if (item && typeof item === 'object') {
      if (current.depth > MAX_SNAPSHOT_DEPTH) {
        throw new Error(`A Revision Room snapshot exceeds the safe nesting limit of ${MAX_SNAPSHOT_DEPTH}.`);
      }
      if (seen.has(item)) throw new Error('Revision Room snapshots cannot contain cyclic data.');
      seen.add(item);
      const entries = Object.entries(item);
      units += 16 + entries.reduce((sum, [key]) => sum + key.length, 0);
      for (const [, child] of entries) stack.push({ value: child, depth: current.depth + 1 });
    } else {
      units += 8;
    }
    if (units > MAX_SNAPSHOT_UNITS) {
      throw new Error('A Revision Room snapshot is too large to open safely.');
    }
  }
  return units;
}

function validateSnapshotElements(value) {
  if (!Array.isArray(value) || value.length > MAX_SNAPSHOT_ELEMENTS) {
    throw new Error('A Revision Room snapshot has an invalid screenplay element list.');
  }
  const ids = new Set();
  for (const element of value) {
    if (
      !element ||
      typeof element !== 'object' ||
      Array.isArray(element) ||
      typeof element.id !== 'string' ||
      !element.id ||
      ids.has(element.id)
    ) {
      throw new Error('A Revision Room snapshot has invalid or duplicate screenplay element identifiers.');
    }
    ids.add(element.id);
  }
  return value;
}

function safeText(value, fallback, max) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  return (text || fallback).slice(0, max);
}

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
    ? value
    : '';
}

function validDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toISOString();
}
