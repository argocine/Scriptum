/**
 * Deterministic structural checks for a screenplay.
 *
 * This module deliberately avoids spelling, grammar, taste, and stylistic
 * opinion. It reports only document structures that are empty, internally
 * inconsistent, or unable to survive local PDF printing.
 */

import { ElementType, ELEMENT_LABEL } from '../core/format.js';
import { getScenes } from '../core/model.js';
import { invalidPrintCharacters } from '../core/unicode.js';
import { hasAlternateDialogue } from '../core/alternates.js';

const SPEECH = new Set([
  ElementType.CHARACTER,
  ElementType.PARENTHETICAL,
  ElementType.DIALOGUE,
]);

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

export function auditDocument(doc, pagination = null) {
  const elements = Array.isArray(doc?.elements) ? doc.elements : [];
  const scenes = getScenes({ ...doc, elements });
  const elementOrder = new Map(elements.map((element, index) => [element.id, index]));
  const sceneByElement = new Map();
  for (const scene of scenes) {
    for (const element of scene.elements) sceneByElement.set(element.id, scene.id);
  }

  const issues = [];
  const add = (code, severity, message, element = null, extra = {}) => {
    const elementId = element?.id || null;
    const range = extra.range || null;
    const location = `${elementId || 'document'}:${extra.field || ''}`;
    const start = range?.start ?? '';
    issues.push({
      id: `${code}:${location}:${start}`,
      code,
      severity,
      message,
      elementId,
      sceneId: elementId ? sceneByElement.get(elementId) || null : null,
      range,
      page: pageFor(elementId, pagination),
      field: extra.field || null,
      count: extra.count || 1,
      fix: null,
    });
  };

  const hasWrittenContent = elements.some((element) => String(element.text || '').trim());
  if (hasWrittenContent) auditEmptyElements(elements, add);
  auditDialogueStructure(elements, add);
  auditSceneNumbers(doc, elements, add);
  auditDualDialogue(elements, add);
  auditAlternates(elements, add);
  auditPdfSupport(doc, elements, pagination, add);

  // Stable document order first, severity/rule only as deterministic ties.
  return issues.sort((a, b) => {
    const ai = a.elementId ? elementOrder.get(a.elementId) ?? Number.MAX_SAFE_INTEGER : -1;
    const bi = b.elementId ? elementOrder.get(b.elementId) ?? Number.MAX_SAFE_INTEGER : -1;
    return (
      ai - bi ||
      (a.range?.start ?? -1) - (b.range?.start ?? -1) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function pdfSupportIssues(doc, pagination = null) {
  return auditDocument(doc, pagination).filter((issue) => issue.code === 'invalid-print-text');
}

function auditEmptyElements(elements, add) {
  for (const element of elements) {
    if (String(element.text || '').trim()) continue;
    const label = ELEMENT_LABEL[element.type] || 'Screenplay';
    const severity = element.type === ElementType.ACTION || element.type === ElementType.GENERAL
      ? 'info'
      : 'warning';
    add('empty-element', severity, `${label} element is empty.`, element);
  }
}

function auditDialogueStructure(elements, add) {
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i];

    if (element.type === ElementType.CHARACTER) {
      let hasDialogue = false;
      for (let j = i + 1; j < elements.length; j += 1) {
        const next = elements[j];
        if (next.type === ElementType.DIALOGUE) hasDialogue = true;
        if (!SPEECH.has(next.type) || next.type === ElementType.CHARACTER) break;
      }
      if (!hasDialogue) {
        add('character-without-dialogue', 'warning', 'Character cue has no dialogue.', element);
      }
      continue;
    }

    if (element.type === ElementType.DIALOGUE || element.type === ElementType.PARENTHETICAL) {
      let owner = null;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (!SPEECH.has(elements[j].type)) break;
        if (elements[j].type === ElementType.CHARACTER) {
          owner = elements[j];
          break;
        }
      }
      if (!owner) {
        add(
          element.type === ElementType.DIALOGUE
            ? 'dialogue-without-character'
            : 'parenthetical-without-character',
          'warning',
          element.type === ElementType.DIALOGUE
            ? 'Dialogue has no character cue.'
            : 'Parenthetical has no character cue.',
          element
        );
      }
    }

    if (
      element.type === ElementType.PARENTHETICAL &&
      String(element.text || '').trim() &&
      !balancedParenthetical(String(element.text).trim())
    ) {
      add('unbalanced-parenthetical', 'warning', 'Parenthetical has unbalanced parentheses.', element);
    }
  }
}

function balancedParenthetical(text) {
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function auditSceneNumbers(doc, elements, add) {
  const numbered = new Map();
  const enabled = !!doc?.sceneNumbering?.enabled;
  const locked = enabled && !!doc?.sceneNumbering?.locked;

  for (const element of elements) {
    if (element.type !== ElementType.SCENE_HEADING) continue;
    const number = typeof element.sceneNumber === 'string' ? element.sceneNumber.trim() : '';
    if (!number) {
      if (locked) add('missing-scene-number', 'error', 'Locked scene has no scene number.', element);
      continue;
    }
    if (!enabled) continue;
    const key = number.toUpperCase();
    if (!numbered.has(key)) numbered.set(key, []);
    numbered.get(key).push(element);
  }

  for (const duplicates of numbered.values()) {
    if (duplicates.length < 2) continue;
    for (const element of duplicates) {
      const number = String(element.sceneNumber).trim();
      add(
        'duplicate-scene-number',
        'error',
        `Scene number ${number} is used by ${duplicates.length} scenes.`,
        element
      );
    }
  }
}

function auditDualDialogue(elements, add) {
  let i = 0;
  while (i < elements.length) {
    if (!elements[i].dual) {
      i += 1;
      continue;
    }

    const start = i;
    const group = [];
    while (i < elements.length && elements[i].dual) {
      group.push(elements[i]);
      i += 1;
    }

    const firstRight = group.findIndex((element) => element.dual === 'right');
    const left = firstRight === -1 ? group : group.slice(0, firstRight);
    const right = firstRight === -1 ? [] : group.slice(firstRight);
    const valid =
      group[0]?.dual === 'left' &&
      left.length > 0 &&
      right.length > 0 &&
      left[0]?.type === ElementType.CHARACTER &&
      right[0]?.type === ElementType.CHARACTER &&
      left.filter((element) => element.type === ElementType.CHARACTER).length === 1 &&
      right.filter((element) => element.type === ElementType.CHARACTER).length === 1 &&
      left.every((element) => element.dual === 'left' && SPEECH.has(element.type)) &&
      right.every((element) => element.dual === 'right' && SPEECH.has(element.type));

    if (!valid) {
      add('malformed-dual-dialogue', 'error', 'Dual dialogue pair is incomplete or malformed.', elements[start]);
    }
  }
}

function auditAlternates(elements, add) {
  for (const element of elements) {
    if (!element.alternateDialogue) continue;
    if (!hasAlternateDialogue(element)) {
      add(
        'malformed-alternate-dialogue',
        'error',
        'Alternate dialogue metadata is incomplete or attached to a non-dialogue element.',
        element
      );
      continue;
    }
    if (element.dual) {
      add(
        'alternate-in-dual-dialogue',
        'error',
        'Alternate dialogue is not supported inside a dual-dialogue pair.',
        element
      );
    }
    if (!String(element.text || '').trim()) {
      add('empty-alternate-dialogue', 'warning', 'The active alternate dialogue is empty.', element);
    }
    element.alternateDialogue.choices.forEach((choice, index) => {
      if (!String(choice.text || '').trim()) {
        add(
          'empty-alternate-dialogue',
          'warning',
          `Stored alternate dialogue ${index + 1} is empty.`,
          element,
          { field: `alternateDialogue.${choice.id}` }
        );
      }
    });
  }
}

function auditPdfSupport(doc, elements, pagination, add) {
  const title = doc?.title || {};
  const titleFields = title.showTitlePage === false
    ? ['title']
    : ['title', 'credit', 'author', 'source', 'contact', 'draftDate'];
  for (const field of titleFields) {
    const unsupported = invalidPrintCharacters(title[field]);
    if (!unsupported.length) continue;
    add(
      'invalid-print-text',
      'warning',
      `${titleFieldLabel(field)} contains ${quantity(unsupported.length, 'invalid Unicode character')} that may not print.`,
      null,
      { field: `title.${field}`, range: firstRange(unsupported), count: unsupported.length }
    );
  }

  for (const element of elements) {
    const unsupported = invalidPrintCharacters(element.text);
    if (unsupported.length) {
      add(
        'invalid-print-text',
        'warning',
        `Element contains ${quantity(unsupported.length, 'invalid Unicode character')} that may not print.`,
        element,
        { range: firstRange(unsupported), count: unsupported.length }
      );
    }

    if (
      element.type === ElementType.SCENE_HEADING &&
      element.sceneNumber &&
      (doc.sceneNumbering?.showLeft || doc.sceneNumbering?.showRight)
    ) {
      const sceneNumberUnsupported = invalidPrintCharacters(element.sceneNumber);
      if (sceneNumberUnsupported.length) {
        add(
          'invalid-print-text',
          'warning',
          `Scene number contains ${quantity(sceneNumberUnsupported.length, 'invalid Unicode character')} that may not print.`,
          element,
          { field: 'sceneNumber', count: sceneNumberUnsupported.length }
        );
      }
    }
  }

  const usedRevisionIds = doc?.revisions?.showMarks
    ? new Set(elements.map((element) => element.revisionId).filter(Boolean))
    : new Set();
  const revisionSets = Array.isArray(doc?.revisions?.sets) ? doc.revisions.sets : [];
  for (const set of revisionSets) {
    if (set.active === false || !usedRevisionIds.has(set.id)) continue;
    const unsupported = invalidPrintCharacters(set.mark);
    if (!unsupported.length) continue;
    add(
      'invalid-print-text',
      'warning',
      `Revision mark contains ${quantity(unsupported.length, 'invalid Unicode character')} that may not print.`,
      null,
      { field: `revisions.${set.id}.mark`, count: unsupported.length }
    );
  }

  const currentRevision = revisionSets.find((set) => set.id === doc?.revisions?.current);
  if (currentRevision) {
    for (const field of ['name', 'date']) {
      const unsupported = invalidPrintCharacters(currentRevision[field]);
      if (!unsupported.length) continue;
      add(
        'invalid-print-text',
        'warning',
        `Revision ${field} contains ${quantity(unsupported.length, 'invalid Unicode character')} that may not print.`,
        null,
        { field: `revisions.${currentRevision.id}.${field}`, count: unsupported.length }
      );
    }
  }
}

function firstRange(ranges) {
  return ranges.length ? { start: ranges[0].start, end: ranges[0].end } : null;
}

function titleFieldLabel(field) {
  return {
    title: 'Title',
    credit: 'Credit',
    author: 'Author',
    source: 'Source',
    contact: 'Contact information',
    draftDate: 'Draft date',
  }[field] || 'Title page';
}

function quantity(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function pageFor(elementId, pagination) {
  if (!elementId || !pagination?.lineIndex?.has(elementId)) return null;
  const location = pagination.lineIndex.get(elementId);
  return pagination.pages?.[location.page]?.number || String(location.page + 1);
}
