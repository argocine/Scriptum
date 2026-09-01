/**
 * Alternate dialogue is local document metadata. The selected wording remains
 * canonical in element.text/styles/revisionId; only inactive choices live in
 * the collection below, so pagination and every ordinary export stay simple.
 */

import { ElementType } from './format.js';
import { newId, normalizeStyles } from './model.js';

export const ALTERNATE_SCHEMA_VERSION = 1;

function choiceFromActive(element, id, order) {
  return {
    id,
    order,
    text: String(element.text || ''),
    styles: (element.styles || []).map((style) => ({ ...style })),
    revisionId: typeof element.revisionId === 'string' ? element.revisionId : null,
  };
}

function applyChoice(element, choice) {
  element.text = choice.text;
  element.styles = choice.styles.map((style) => ({ ...style }));
  element.revisionId = choice.revisionId;
}

export function hasAlternateDialogue(element) {
  if (element?.type !== ElementType.DIALOGUE) return false;
  const group = element.alternateDialogue;
  if (
    group?.schemaVersion !== ALTERNATE_SCHEMA_VERSION ||
    typeof group.activeId !== 'string' ||
    !group.activeId ||
    !Number.isFinite(group.activeOrder) ||
    !Number.isFinite(group.nextOrder) ||
    !Array.isArray(group.choices) ||
    !group.choices.length
  ) return false;
  const ids = new Set([group.activeId]);
  return group.choices.every((choice) => {
    if (
      !choice ||
      typeof choice.id !== 'string' ||
      !choice.id ||
      ids.has(choice.id) ||
      !Number.isFinite(choice.order) ||
      typeof choice.text !== 'string' ||
      !Array.isArray(choice.styles) ||
      !(choice.revisionId === null || typeof choice.revisionId === 'string')
    ) return false;
    ids.add(choice.id);
    return true;
  });
}

export function alternateCount(element) {
  return hasAlternateDialogue(element) ? element.alternateDialogue.choices.length + 1 : 1;
}

export function alternateStatus(element) {
  if (!hasAlternateDialogue(element)) return { position: 1, count: 1 };
  const group = element.alternateDialogue;
  const ordered = [
    ...group.choices.map((choice) => ({ id: choice.id, order: choice.order })),
    { id: group.activeId, order: group.activeOrder },
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return {
    position: Math.max(0, ordered.findIndex((choice) => choice.id === group.activeId)) + 1,
    count: ordered.length,
  };
}

export function addAlternate(element) {
  if (element?.type !== ElementType.DIALOGUE || element.tags?.length) return false;
  if (!hasAlternateDialogue(element)) {
    const originalId = newId('alt');
    const activeId = newId('alt');
    element.alternateDialogue = {
      schemaVersion: ALTERNATE_SCHEMA_VERSION,
      activeId,
      activeOrder: 2,
      nextOrder: 3,
      choices: [choiceFromActive(element, originalId, 1)],
    };
  } else {
    const group = element.alternateDialogue;
    group.choices.push(choiceFromActive(element, group.activeId, group.activeOrder));
    group.activeId = newId('alt');
    group.activeOrder = group.nextOrder;
    group.nextOrder += 1;
  }
  element.text = '';
  element.styles = [];
  return true;
}

export function activateAlternate(element, choiceId) {
  if (!hasAlternateDialogue(element) || element.tags?.length) return false;
  const group = element.alternateDialogue;
  const index = group.choices.findIndex((choice) => choice.id === choiceId);
  if (index === -1) return false;
  const selected = group.choices[index];
  const previous = choiceFromActive(element, group.activeId, group.activeOrder);
  group.choices.splice(index, 1, previous);
  group.activeId = selected.id;
  group.activeOrder = selected.order;
  applyChoice(element, selected);
  return true;
}

export function stepAlternate(element, direction) {
  if (!hasAlternateDialogue(element) || element.tags?.length) return false;
  const group = element.alternateDialogue;
  const ordered = [
    ...group.choices.map((choice) => ({ id: choice.id, order: choice.order })),
    { id: group.activeId, order: group.activeOrder },
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const current = ordered.findIndex((choice) => choice.id === group.activeId);
  const next = (current + (direction < 0 ? -1 : 1) + ordered.length) % ordered.length;
  return activateAlternate(element, ordered[next].id);
}

export function deleteActiveAlternate(element) {
  if (!hasAlternateDialogue(element) || element.tags?.length) return false;
  const group = element.alternateDialogue;
  const ordered = [...group.choices].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const selected = ordered.find((choice) => choice.order > group.activeOrder) || ordered.at(-1);
  applyChoice(element, selected);
  group.activeId = selected.id;
  group.activeOrder = selected.order;
  group.choices = group.choices.filter((choice) => choice.id !== selected.id);
  if (!group.choices.length) element.alternateDialogue = null;
  return true;
}

export function normalizeAlternateDialogue(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.choices)) return null;
  if (
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion > ALTERNATE_SCHEMA_VERSION
  ) {
    throw new Error(
      'This screenplay contains alternate dialogue from a newer version of Scriptum. Update the app to open it.'
    );
  }
  const seen = new Set();
  const activeId = typeof value.activeId === 'string' && value.activeId ? value.activeId : newId('alt');
  seen.add(activeId);
  const choices = [];
  for (const raw of value.choices) {
    if (!raw || typeof raw !== 'object') continue;
    let id = typeof raw.id === 'string' && raw.id && !seen.has(raw.id) ? raw.id : newId('alt');
    while (seen.has(id)) id = newId('alt');
    seen.add(id);
    const text = typeof raw.text === 'string' ? raw.text : '';
    choices.push({
      id,
      order: Number.isFinite(raw.order) ? Math.max(1, Math.floor(raw.order)) : choices.length + 1,
      text,
      styles: normalizeStyles(Array.isArray(raw.styles) ? raw.styles : [], text.length),
      revisionId: typeof raw.revisionId === 'string' ? raw.revisionId : null,
    });
  }
  if (!choices.length) return null;
  const maxOrder = Math.max(0, ...choices.map((choice) => choice.order));
  const activeOrder = Number.isFinite(value.activeOrder)
    ? Math.max(1, Math.floor(value.activeOrder))
    : maxOrder + 1;
  return {
    schemaVersion: ALTERNATE_SCHEMA_VERSION,
    activeId,
    activeOrder,
    nextOrder: Math.max(
      maxOrder + 1,
      activeOrder + 1,
      Number.isFinite(value.nextOrder) ? Math.floor(value.nextOrder) : 1
    ),
    choices,
  };
}

export function documentHasAlternates(doc) {
  return (doc?.elements || []).some(hasAlternateDialogue);
}
