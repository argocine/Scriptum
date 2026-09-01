/**
 * reports.js — Production and analysis reports.
 *
 * These are the numbers a writer or a first AD actually asks for: where each
 * scene falls, who speaks how much, which locations recur, and how the script
 * is balanced between dialogue and action.
 */

import { ElementType } from '../core/format.js';
import {
  getScenes,
  collectCharacters,
  parseHeading,
  baseCharacterName,
  countWords,
} from '../core/model.js';
import { productionLookup } from '../core/production.js';

/** Map every element to the page number it starts on. */
function pageOfElement(pagination) {
  const map = new Map();
  pagination.pages.forEach((page) => {
    for (const line of page.lines) {
      const id = line.elementId || line.left?.elementId || line.right?.elementId;
      if (id && !map.has(id)) map.set(id, page.number);
    }
  });
  return map;
}

/** Eighths of a page, the unit scene lengths are measured in on set. */
function toEighths(lines, linesPerPage) {
  const eighths = Math.max(1, Math.round((lines / linesPerPage) * 8));
  const pages = Math.floor(eighths / 8);
  const rem = eighths % 8;
  if (pages && rem) return `${pages} ${rem}/8`;
  if (pages) return `${pages}`;
  return `${rem}/8`;
}

/* ------------------------------------------------------------------ *
 * Scene report
 * ------------------------------------------------------------------ */

export function sceneReport(doc, pagination, styles) {
  const scenes = getScenes(doc);
  const pageMap = pageOfElement(pagination);

  // Count printed lines per scene so lengths reflect the formatted page.
  const linesByScene = new Map();
  let currentScene = null;
  pagination.pages.forEach((page) => {
    for (const line of page.lines) {
      const id = line.elementId || line.left?.elementId;
      if (id) {
        const owner = doc.elements.find((e) => e.id === id);
        if (owner?.type === ElementType.SCENE_HEADING) currentScene = id;
      }
      if (currentScene) linesByScene.set(currentScene, (linesByScene.get(currentScene) || 0) + 1);
    }
  });

  return scenes.map((scene) => {
    const parsed = parseHeading(scene.heading);
    const cast = new Set();
    for (const el of scene.elements) {
      if (el.type === ElementType.CHARACTER) {
        const n = baseCharacterName(el.text);
        if (n) cast.add(n);
      }
    }
    const lineCount = linesByScene.get(scene.id) || 0;
    return {
      id: scene.id,
      number: scene.sceneNumber || String(scene.index + 1),
      page: pageMap.get(scene.id) || '',
      heading: scene.heading,
      intExt: parsed.prefix,
      location: parsed.location,
      time: parsed.time,
      cast: [...cast],
      castCount: cast.size,
      length: toEighths(lineCount, styles.page.linesPerPage),
      lines: lineCount,
      omitted: scene.omitted,
      summary: scene.summary,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Character report
 * ------------------------------------------------------------------ */

export function characterReport(doc, pagination) {
  const chars = collectCharacters(doc);
  const pageMap = pageOfElement(pagination);
  const totalWords = chars.reduce((n, c) => n + c.words, 0) || 1;

  // First and last appearance, by page.
  const firstLast = new Map();
  doc.elements.forEach((el) => {
    if (el.type !== ElementType.CHARACTER) return;
    const name = baseCharacterName(el.text);
    if (!name) return;
    const page = pageMap.get(el.id);
    const rec = firstLast.get(name) || { first: page, last: page };
    rec.last = page;
    firstLast.set(name, rec);
  });

  return chars.map((c) => ({
    name: c.name,
    cues: c.cues,
    words: c.words,
    scenes: c.scenes.size,
    share: c.words / totalWords,
    extensions: [...c.extensions],
    firstPage: firstLast.get(c.name)?.first || '',
    lastPage: firstLast.get(c.name)?.last || '',
  }));
}

/* ------------------------------------------------------------------ *
 * Location report
 * ------------------------------------------------------------------ */

export function locationReport(doc, pagination) {
  const scenes = getScenes(doc);
  const pageMap = pageOfElement(pagination);
  const map = new Map();

  for (const scene of scenes) {
    const { prefix, location, time } = parseHeading(scene.heading);
    if (!location) continue;
    const key = location.toUpperCase();
    if (!map.has(key)) {
      map.set(key, {
        location: key,
        scenes: 0,
        interior: 0,
        exterior: 0,
        times: new Set(),
        pages: [],
        sceneNumbers: [],
      });
    }
    const rec = map.get(key);
    rec.scenes += 1;
    if (/^INT/.test(prefix)) rec.interior += 1;
    if (/^EXT/.test(prefix)) rec.exterior += 1;
    if (time) rec.times.add(time.toUpperCase());
    const p = pageMap.get(scene.id);
    if (p) rec.pages.push(p);
    rec.sceneNumbers.push(scene.sceneNumber || String(scene.index + 1));
  }

  return [...map.values()]
    .map((r) => ({ ...r, times: [...r.times] }))
    .sort((a, b) => b.scenes - a.scenes || a.location.localeCompare(b.location));
}

/* ------------------------------------------------------------------ *
 * Production breakdown
 * ------------------------------------------------------------------ */

export function breakdownReport(doc, pagination) {
  const pageMap = pageOfElement(pagination);
  const lookup = productionLookup(doc.production);
  const scenes = getScenes(doc);
  const sceneByElement = new Map();
  for (const scene of scenes) {
    for (const element of scene.elements) sceneByElement.set(element.id, scene);
  }
  const grouped = new Map();
  for (const element of doc.elements) {
    const scene = sceneByElement.get(element.id) || null;
    for (const tag of element.tags || []) {
      const item = lookup.items.get(tag.itemId);
      const category = item ? lookup.categories.get(item.categoryId) : null;
      if (!item || !category) continue;
      const key = `${scene?.id || 'unassigned'}:${item.id}`;
      const row = grouped.get(key) || {
        sceneId: scene?.id || null,
        scene: scene ? scene.sceneNumber || String(scene.index + 1) : '—',
        page: pageMap.get(scene?.id || element.id) || '',
        heading: scene?.heading || 'Before first scene',
        category: category.name,
        categoryId: category.id,
        color: category.color,
        item: item.name,
        itemId: item.id,
        count: 0,
        excerpts: [],
      };
      row.count += 1;
      const excerpt = element.text.slice(tag.start, tag.end).trim();
      if (excerpt && !row.excerpts.includes(excerpt)) row.excerpts.push(excerpt);
      grouped.set(key, row);
    }
  }
  const rows = [...grouped.values()];
  return rows.sort(
    (a, b) =>
      Number(a.scene) - Number(b.scene) ||
      String(a.scene).localeCompare(String(b.scene)) ||
      a.category.localeCompare(b.category) ||
      a.item.localeCompare(b.item)
  );
}

/* ------------------------------------------------------------------ *
 * Overall statistics
 * ------------------------------------------------------------------ */

export function statistics(doc, pagination, styles) {
  const counts = {};
  let dialogueWords = 0;
  let actionWords = 0;

  for (const el of doc.elements) {
    counts[el.type] = (counts[el.type] || 0) + 1;
    const w = countWords(el.text);
    if (el.type === ElementType.DIALOGUE || el.type === ElementType.PARENTHETICAL) {
      dialogueWords += w;
    } else if (el.type === ElementType.ACTION) {
      actionWords += w;
    }
  }

  const scenes = getScenes(doc);
  const chars = collectCharacters(doc);
  const totalWords = dialogueWords + actionWords;
  const pages = pagination.totalPages;

  const intCount = scenes.filter((s) => /^INT/.test(parseHeading(s.heading).prefix)).length;
  const extCount = scenes.filter((s) => /^EXT/.test(parseHeading(s.heading).prefix)).length;
  const dayCount = scenes.filter((s) => /DAY|MORNING|AFTERNOON/i.test(parseHeading(s.heading).time)).length;
  const nightCount = scenes.filter((s) => /NIGHT|DUSK|EVENING/i.test(parseHeading(s.heading).time)).length;

  return {
    pages,
    runtime: `${Math.floor(pages / 60)}h ${pages % 60}m`,
    scenes: scenes.length,
    speakingRoles: chars.length,
    words: totalWords,
    dialogueWords,
    actionWords,
    dialogueShare: totalWords ? dialogueWords / totalWords : 0,
    averageSceneLength: scenes.length ? (pages / scenes.length).toFixed(2) : '0',
    elementCounts: counts,
    intCount,
    extCount,
    dayCount,
    nightCount,
    linesPerPage: styles.page.linesPerPage,
  };
}

/* ------------------------------------------------------------------ *
 * Export to CSV — so a report can go straight into a schedule
 * ------------------------------------------------------------------ */

export function toCSV(rows, columns) {
  const head = columns.map((c) => quote(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => quote(format(c.get(r)))).join(','))
    .join('\n');
  return `${head}\n${body}\n`;
}

function format(v) {
  if (typeof v === 'number') return String(v);
  const text = String(Array.isArray(v) ? v.join('; ') : v ?? '');
  // Spreadsheet applications interpret these prefixes as formulas. CSV is a
  // data interchange format, so neutralize user-authored cells before export.
  return /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function quote(s) {
  const str = String(s);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export const SCENE_COLUMNS = [
  { label: 'Scene', get: (r) => r.number },
  { label: 'Page', get: (r) => r.page },
  { label: 'Int/Ext', get: (r) => r.intExt },
  { label: 'Location', get: (r) => r.location },
  { label: 'Time', get: (r) => r.time },
  { label: 'Length', get: (r) => r.length },
  { label: 'Cast', get: (r) => r.cast },
];

export const CHARACTER_COLUMNS = [
  { label: 'Character', get: (r) => r.name },
  { label: 'Speeches', get: (r) => r.cues },
  { label: 'Words', get: (r) => r.words },
  { label: 'Scenes', get: (r) => r.scenes },
  { label: 'First Page', get: (r) => r.firstPage },
  { label: 'Last Page', get: (r) => r.lastPage },
];

export const LOCATION_COLUMNS = [
  { label: 'Location', get: (r) => r.location },
  { label: 'Scenes', get: (r) => r.scenes },
  { label: 'Interior', get: (r) => r.interior },
  { label: 'Exterior', get: (r) => r.exterior },
  { label: 'Times', get: (r) => r.times },
];

export const BREAKDOWN_COLUMNS = [
  { label: 'Scene', get: (r) => r.scene },
  { label: 'Page', get: (r) => r.page },
  { label: 'Heading', get: (r) => r.heading },
  { label: 'Category', get: (r) => r.category },
  { label: 'Item', get: (r) => r.item },
  { label: 'Occurrences', get: (r) => r.count },
  { label: 'Tagged Text', get: (r) => r.excerpts },
];
