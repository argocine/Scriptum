/**
 * Unicode helpers shared by pagination, printing, and deterministic audits.
 *
 * Scriptum stores offsets as UTF-16 indexes because that is what browser
 * selections use. These helpers therefore keep every returned range in UTF-16
 * units while treating combining sequences and joined emoji as one printable
 * cell cluster.
 */

const MARK = /\p{Mark}/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const GRAPHEME_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const VIRAMAS = new Set([
  0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd,
  0x0d3b, 0x0d3c, 0x0d4d, 0x0dca, 0x0e3a, 0x0f84, 0x1039, 0x103a,
  0x1714, 0x1715, 0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab,
  0xa806, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed, 0x10a3f, 0x11046,
  0x1107f, 0x11133, 0x11134, 0x111c0, 0x11235, 0x112ea, 0x1134d,
  0x11442, 0x114c2, 0x115bf, 0x1163f, 0x116b6, 0x1172b, 0x11839,
  0x1193d, 0x1193e, 0x119e0, 0x11a34, 0x11a47, 0x11a99, 0x11c3f,
  0x11d44, 0x11d45, 0x11d97, 0x11f41, 0x11f42,
]);

/** Split text into practical grapheme clusters without changing its offsets. */
export function textClusters(value) {
  const text = String(value ?? '');
  if (GRAPHEME_SEGMENTER) {
    return [...GRAPHEME_SEGMENTER.segment(text)].map(({ segment, index }) => ({
      start: index,
      end: index + segment.length,
      text: segment,
      cells: monospaceCells(segment),
    }));
  }

  return fallbackTextClusters(text);
}

/** Deterministic fallback for browsers that predate Intl.Segmenter. */
export function fallbackTextClusters(value) {
  const text = String(value ?? '');
  const clusters = [];
  let start = 0;

  while (start < text.length) {
    let end = nextCodePoint(text, start);
    const first = text.codePointAt(start);

    // UAX #29 keeps CRLF together.
    if (first === 0x0d && text.codePointAt(end) === 0x0a) {
      end = nextCodePoint(text, end);
    }

    // Modern Hangul can be stored as conjoining Jamo rather than one
    // precomposed syllable. Follow the L/V/T no-break rules.
    let previousHangul = first;
    while (end < text.length) {
      const nextHangul = text.codePointAt(end);
      if (!joinsHangul(previousHangul, nextHangul)) break;
      end = nextCodePoint(text, end);
      previousHangul = nextHangul;
    }

    // A pair of regional indicators is one flag glyph.
    if (isRegionalIndicator(first) && end < text.length) {
      const next = text.codePointAt(end);
      if (isRegionalIndicator(next)) end = nextCodePoint(text, end);
    }

    end = consumeExtenders(text, end);

    // Indic conjuncts commonly use consonant + virama + consonant without an
    // explicit ZWJ. Keep that sequence intact, including chained conjuncts.
    while (end < text.length && endsInVirama(text.slice(start, end))) {
      const next = text.codePointAt(end);
      if (!isLetter(next)) break;
      end = nextCodePoint(text, end);
      end = consumeExtenders(text, end);
    }

    // Emoji and several writing systems use zero-width joiner sequences.
    while (end < text.length && text.codePointAt(end) === 0x200d) {
      end = nextCodePoint(text, end);
      if (end < text.length) end = nextCodePoint(text, end);
      end = consumeExtenders(text, end);
    }

    const source = text.slice(start, end);
    clusters.push({ start, end, text: source, cells: monospaceCells(source) });
    start = end;
  }

  return clusters;
}

/**
 * Screenplay-width estimate for one grapheme cluster.
 *
 * CJK, Hangul, full-width forms, flags, and emoji occupy two cells in the
 * monospaced fonts browsers use for Scriptum. Other printable clusters occupy
 * one. This mirrors terminal-style wcwidth without treating East Asian
 * ambiguous punctuation as wide on Western systems.
 */
export function monospaceCells(cluster) {
  const source = String(cluster ?? '');
  if (!source) return 0;
  const points = [...source].map((char) => char.codePointAt(0));
  const visible = points.filter((code) => !isExtender(code) && code !== 0x200d);
  if (!visible.length) return 1;
  if (source.includes('\ufe0f') || EMOJI.test(source)) return 2;
  return visible.some((code) => isWideCodePoint(code)) ? 2 : 1;
}

/** Uppercase where doing so keeps browser selection/style offsets stable. */
export function uppercasePreservingOffsets(value) {
  const text = String(value ?? '');
  let output = '';
  for (const cluster of textClusters(text)) {
    // Unicode maps sharp-s to two letters by default, but the capital sharp-s
    // is a better one-cell screenplay representation.
    const candidate = cluster.text === '\u00df' ? '\u1e9e' : cluster.text.toUpperCase();
    output += candidate.length === cluster.text.length ? candidate : cluster.text;
  }
  return output;
}

/**
 * Locate text that cannot be represented as valid printable Unicode.
 * Ordinary scripts, symbols, and emoji are valid; only controls, noncharacters,
 * and malformed surrogate pairs are rejected.
 */
export function invalidPrintCharacters(value) {
  const text = String(value ?? '');
  const invalid = [];

  for (let i = 0; i < text.length;) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        invalid.push({ start: i, end: i + 1, source: text.slice(i, i + 1) });
        i += 1;
        continue;
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid.push({ start: i, end: i + 1, source: text.slice(i, i + 1) });
      i += 1;
      continue;
    }

    const code = text.codePointAt(i);
    const end = nextCodePoint(text, i);
    if (isDisallowedControl(code) || isNoncharacter(code)) {
      invalid.push({ start: i, end, source: text.slice(i, end) });
    }
    i = end;
  }

  return invalid;
}

function consumeExtenders(text, from) {
  let end = from;
  while (end < text.length && isExtender(text.codePointAt(end))) {
    end = nextCodePoint(text, end);
  }
  return end;
}

function nextCodePoint(text, index) {
  const code = text.codePointAt(index);
  return index + (code > 0xffff ? 2 : 1);
}

function isExtender(code) {
  if (code == null) return false;
  return (
    MARK.test(String.fromCodePoint(code)) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef) ||
    (code >= 0x1f3fb && code <= 0x1f3ff) ||
    (code >= 0xe0020 && code <= 0xe007f)
  );
}

function joinsHangul(previous, next) {
  const left = hangulClass(previous);
  const right = hangulClass(next);
  return (
    (left === 'L' && (right === 'L' || right === 'V' || right === 'LV' || right === 'LVT')) ||
    ((left === 'LV' || left === 'V') && (right === 'V' || right === 'T')) ||
    ((left === 'LVT' || left === 'T') && right === 'T')
  );
}

function hangulClass(code) {
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0xa960 && code <= 0xa97c)) return 'L';
  if ((code >= 0x1160 && code <= 0x11a7) || (code >= 0xd7b0 && code <= 0xd7c6)) return 'V';
  if ((code >= 0x11a8 && code <= 0x11ff) || (code >= 0xd7cb && code <= 0xd7fb)) return 'T';
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? 'LV' : 'LVT';
  return '';
}

function endsInVirama(source) {
  const points = [...source].map((char) => char.codePointAt(0));
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const code = points[index];
    if (isVirama(code)) return true;
    if (!isExtender(code)) return false;
  }
  return false;
}

function isVirama(code) {
  return VIRAMAS.has(code);
}

function isLetter(code) {
  return code != null && /\p{Letter}/u.test(String.fromCodePoint(code));
}

function isRegionalIndicator(code) {
  return code >= 0x1f1e6 && code <= 0x1f1ff;
}

function isWideCodePoint(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function isDisallowedControl(code) {
  // Tab and line endings are intentional layout whitespace and are allowed.
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function isNoncharacter(code) {
  return (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xffff) === 0xfffe || (code & 0xffff) === 0xffff;
}
