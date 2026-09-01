/**
 * autocomplete.js — Suggestion sources.
 *
 * Screenwriting autocomplete is not general-purpose text prediction: it is a
 * small number of tightly-scoped vocabularies that happen to cover most of
 * what a writer types outside of prose. Getting these right removes a
 * surprising amount of typing from a working day.
 */

import { ElementType } from './format.js';
import { baseCharacterName, parseHeading } from './model.js';

export const SCENE_PREFIXES = [
  'INT. ',
  'EXT. ',
  'INT./EXT. ',
  'EXT./INT. ',
  'I/E. ',
  'EST. ',
];

export const TIMES_OF_DAY = [
  'DAY',
  'NIGHT',
  'MORNING',
  'AFTERNOON',
  'EVENING',
  'DAWN',
  'DUSK',
  'LATER',
  'CONTINUOUS',
  'MOMENTS LATER',
  'SAME',
  'SAME TIME',
  'MAGIC HOUR',
  'NIGHTFALL',
  'PRE-DAWN',
];

export const TRANSITIONS = [
  'CUT TO:',
  'DISSOLVE TO:',
  'SMASH CUT TO:',
  'MATCH CUT TO:',
  'JUMP CUT TO:',
  'FADE IN:',
  'FADE OUT.',
  'FADE TO BLACK.',
  'WIPE TO:',
  'INTERCUT WITH:',
  'BACK TO SCENE',
  'TIME CUT:',
  'IRIS OUT.',
];

export const EXTENSIONS = [
  "(CONT'D)",
  '(V.O.)',
  '(O.S.)',
  '(O.C.)',
  '(INTO PHONE)',
  '(ON PHONE)',
  '(SUBTITLED)',
  '(FILTERED)',
  '(PRE-LAP)',
];

/** Everything the document already knows about, rebuilt on demand. */
export function buildVocabulary(doc) {
  const characters = new Map();
  const locations = new Map();
  const times = new Map();

  for (const el of doc.elements) {
    if (el.type === ElementType.CHARACTER) {
      const name = baseCharacterName(el.text);
      if (name) characters.set(name, (characters.get(name) || 0) + 1);
    } else if (el.type === ElementType.SCENE_HEADING) {
      const { location, time } = parseHeading(el.text);
      if (location) {
        const key = location.toUpperCase();
        locations.set(key, (locations.get(key) || 0) + 1);
      }
      if (time) {
        const key = time.toUpperCase();
        times.set(key, (times.get(key) || 0) + 1);
      }
    }
  }

  return {
    characters: sortByFrequency(characters),
    locations: sortByFrequency(locations),
    times: sortByFrequency(times),
  };
}

function sortByFrequency(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

/**
 * Suggestions for the element currently being typed.
 * @returns {{items: {value:string,detail?:string}[], replaceFrom: number}|null}
 *   `replaceFrom` is the character offset at which the completion begins.
 */
export function suggest(doc, vocab, element, caretOffset, lastSpeaker) {
  if (!element) return null;
  const text = element.text;
  const upTo = text.slice(0, caretOffset).toUpperCase();

  switch (element.type) {
    case ElementType.CHARACTER:
      return suggestCharacter(vocab, text, upTo, caretOffset, lastSpeaker);
    case ElementType.SCENE_HEADING:
      return suggestHeading(vocab, text, upTo, caretOffset);
    case ElementType.TRANSITION:
      return prefixMatch(TRANSITIONS, upTo, 0);
    default:
      return null;
  }
}

function suggestCharacter(vocab, text, upTo, caretOffset, lastSpeaker) {
  // Typing an extension: "JOHN (" -> offer V.O., O.S., CONT'D
  const parenAt = upTo.lastIndexOf('(');
  if (parenAt !== -1 && !upTo.slice(parenAt).includes(')')) {
    const frag = upTo.slice(parenAt);
    return prefixMatch(EXTENSIONS, frag, parenAt);
  }

  if (!upTo.trim()) {
    // Empty cue: most useful default is anyone but the person who just spoke,
    // then everyone by frequency.
    const items = vocab.characters
      .filter((c) => c.value !== lastSpeaker)
      .slice(0, 12)
      .map((c) => ({ value: c.value, detail: `${c.count}` }));
    return items.length ? { items, replaceFrom: 0 } : null;
  }

  return prefixMatch(
    vocab.characters.map((c) => c.value),
    upTo,
    0
  );
}

function suggestHeading(vocab, text, upTo, caretOffset) {
  // Nothing typed yet, or still typing the INT./EXT. prefix.
  const prefixDone = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s/.test(upTo);
  if (!prefixDone) {
    return prefixMatch(SCENE_PREFIXES, upTo, 0);
  }

  // After " - " the writer is choosing a time of day.
  const dash = upTo.lastIndexOf(' - ');
  if (dash !== -1) {
    const frag = upTo.slice(dash + 3);
    const pool = dedupe([...vocab.times.map((t) => t.value), ...TIMES_OF_DAY]);
    return prefixMatch(pool, frag, dash + 3);
  }

  // Otherwise: the location.
  const m = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s+/.exec(upTo);
  const start = m ? m[0].length : 0;
  const frag = upTo.slice(start);
  const pool = vocab.locations.map((l) => l.value);
  const hit = prefixMatch(pool, frag, start);
  if (hit) return hit;

  // Offer full past headings when the location is fresh but the writer has
  // typed enough to disambiguate.
  return null;
}

function prefixMatch(pool, fragment, replaceFrom) {
  const frag = fragment.toUpperCase().trimStart();
  const offset = replaceFrom + (fragment.length - fragment.trimStart().length);
  const items = pool
    .filter((v) => v.toUpperCase().startsWith(frag) && v.toUpperCase() !== frag)
    .slice(0, 12)
    .map((v) => ({ value: v }));
  return items.length ? { items, replaceFrom: offset } : null;
}

function dedupe(list) {
  return [...new Set(list)];
}

/** The character who spoke most recently before `index`. */
export function previousSpeaker(doc, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (doc.elements[i].type === ElementType.CHARACTER) {
      return baseCharacterName(doc.elements[i].text);
    }
  }
  return null;
}
