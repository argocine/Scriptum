/**
 * Production tagging and breakdown data.
 *
 * The registry lives in the screenplay and tag occurrences are anchored to
 * element text offsets. Nothing here contacts a service or leaves the file.
 */

export const PRODUCTION_SCHEMA_VERSION = 1;

let productionIdCounter = 0;
function productionId(prefix) {
  productionIdCounter += 1;
  return `${prefix}${Date.now().toString(36)}${productionIdCounter.toString(36)}`;
}

export const DEFAULT_TAG_CATEGORIES = Object.freeze([
  ['cast', 'Cast', '#ef6a6a'],
  ['extras', 'Extras', '#e99a52'],
  ['stunts', 'Stunts', '#d96d9a'],
  ['props', 'Props', '#e5bf4f'],
  ['wardrobe', 'Wardrobe', '#8dc26f'],
  ['makeup-hair', 'Makeup / Hair', '#5fc2a8'],
  ['vehicles-animals', 'Vehicles / Animals', '#5aaed1'],
  ['sound', 'Sound', '#718be0'],
  ['music', 'Music', '#8c75d6'],
  ['special-effects', 'Special Effects', '#bc6fd1'],
  ['vfx', 'Visual Effects', '#d16eb7'],
  ['equipment', 'Equipment', '#78909c'],
  ['sets-greenery', 'Sets / Greenery', '#6e9f68'],
  ['misc', 'Miscellaneous', '#9b8b78'],
]);

export function createProductionRegistry() {
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    showTags: true,
    categories: DEFAULT_TAG_CATEGORIES.map(([id, name, color]) => ({
      id,
      name,
      color,
      builtin: true,
    })),
    items: [],
  };
}

export function normalizeProductionRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createProductionRegistry();
  }
  if (
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion > PRODUCTION_SCHEMA_VERSION
  ) {
    throw new Error(
      'This screenplay contains production tags from a newer version of Scriptum. Update the app to open it.'
    );
  }

  const base = createProductionRegistry();
  const seenCategories = new Set();
  const categories = [];
  for (const raw of Array.isArray(value.categories) ? value.categories : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = safeId(raw.id, 'category');
    if (seenCategories.has(id)) continue;
    seenCategories.add(id);
    categories.push({
      id,
      name: safeLabel(raw.name, 'Untitled category'),
      color: safeColor(raw.color, '#78909c'),
      builtin: !!raw.builtin,
    });
  }
  for (const category of base.categories) {
    if (!seenCategories.has(category.id)) {
      categories.push(category);
      seenCategories.add(category.id);
    }
  }

  const seenItems = new Set();
  const items = [];
  for (const raw of Array.isArray(value.items) ? value.items : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const categoryId = typeof raw.categoryId === 'string' ? raw.categoryId : '';
    if (!seenCategories.has(categoryId)) continue;
    const id = safeId(raw.id, 'item');
    if (seenItems.has(id)) continue;
    seenItems.add(id);
    items.push({
      id,
      categoryId,
      name: safeLabel(raw.name, 'Untitled item'),
      notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 4000) : '',
    });
  }

  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    showTags: typeof value.showTags === 'boolean' ? value.showTags : true,
    categories,
    items,
  };
}

export function normalizeElementTags(tags, textLength, registry) {
  const itemIds = new Set((registry?.items || []).map((item) => item.id));
  const seen = new Set();
  const max = Math.max(0, Number.isFinite(textLength) ? Math.floor(textLength) : 0);
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (typeof raw.itemId !== 'string' || !itemIds.has(raw.itemId)) continue;
    const start = Number.isFinite(raw.start) ? Math.max(0, Math.min(max, Math.floor(raw.start))) : 0;
    const end = Number.isFinite(raw.end) ? Math.max(0, Math.min(max, Math.floor(raw.end))) : 0;
    if (end <= start) continue;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : productionId('tag');
    while (seen.has(id)) id = productionId('tag');
    seen.add(id);
    out.push({ id, itemId: raw.itemId, start, end });
  }
  return mergeTagRanges(out);
}

export function ensureProductionItem(registry, categoryId, name, notes = '') {
  if (!registry?.categories?.some((category) => category.id === categoryId)) return null;
  const label = safeLabel(name, '');
  if (!label) return null;
  const existing = registry.items.find(
    (item) => item.categoryId === categoryId && item.name.localeCompare(label, undefined, { sensitivity: 'accent' }) === 0
  );
  if (existing) return existing;
  const item = { id: productionId('item'), categoryId, name: label, notes: String(notes || '').slice(0, 4000) };
  registry.items.push(item);
  return item;
}

export function addProductionCategory(registry, name, color = '#78909c') {
  const label = safeLabel(name, '');
  if (!label) return null;
  const existing = registry.categories.find(
    (category) => category.name.localeCompare(label, undefined, { sensitivity: 'accent' }) === 0
  );
  if (existing) return existing;
  const category = {
    id: productionId('category'),
    name: label,
    color: safeColor(color, '#78909c'),
    builtin: false,
  };
  registry.categories.push(category);
  return category;
}

export function applyProductionTag(element, itemId, start, end) {
  if (!element || typeof itemId !== 'string') return false;
  const from = Math.max(0, Math.min(element.text.length, Math.floor(Number(start))));
  const to = Math.max(0, Math.min(element.text.length, Math.floor(Number(end))));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
  element.tags = mergeTagRanges([
    ...(Array.isArray(element.tags) ? element.tags : []),
    { id: productionId('tag'), itemId, start: from, end: to },
  ]);
  return true;
}

export function removeProductionTags(element, start, end, itemId = null) {
  if (!element || !Array.isArray(element.tags)) return 0;
  const from = Math.max(0, Math.min(element.text.length, Math.floor(Number(start))));
  const to = Math.max(0, Math.min(element.text.length, Math.floor(Number(end))));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  let removed = 0;
  const next = [];
  for (const tag of element.tags) {
    if ((itemId && tag.itemId !== itemId) || tag.end <= from || tag.start >= to) {
      next.push(tag);
      continue;
    }
    removed += 1;
    if (tag.start < from) next.push({ ...tag, id: productionId('tag'), end: from });
    if (tag.end > to) next.push({ ...tag, id: productionId('tag'), start: to });
  }
  element.tags = mergeTagRanges(next);
  return removed;
}

export function productionLookup(registry) {
  const categories = new Map((registry?.categories || []).map((category) => [category.id, category]));
  const items = new Map((registry?.items || []).map((item) => [item.id, item]));
  return { categories, items };
}

export function documentHasProductionTags(doc) {
  return (doc?.elements || []).some((element) => Array.isArray(element.tags) && element.tags.length > 0);
}

export function mergeTagRanges(tags) {
  const ordered = (Array.isArray(tags) ? tags : [])
    .filter((tag) => tag && Number.isFinite(tag.start) && Number.isFinite(tag.end) && tag.end > tag.start)
    .map((tag) => ({ ...tag, start: Math.max(0, Math.floor(tag.start)), end: Math.max(0, Math.floor(tag.end)) }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.start - b.start || a.end - b.end);
  const out = [];
  for (const tag of ordered) {
    const last = out.at(-1);
    if (last && last.itemId === tag.itemId && tag.start <= last.end) {
      last.end = Math.max(last.end, tag.end);
    } else {
      out.push(tag);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end || a.itemId.localeCompare(b.itemId));
}

function safeId(value, prefix) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    return productionId(prefix);
  }
  return value;
}

function safeLabel(value, fallback) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return (text || fallback).slice(0, 120);
}

function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
