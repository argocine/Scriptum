/**
 * Shared text support for the built-in PDF writer.
 *
 * Scriptum's PDF uses the standard Courier faces with WinAnsiEncoding. Keep
 * encoding and preflight checks here so the exporter and Format Assistant can
 * never disagree about which characters will survive.
 */

// Unicode code points whose Windows-1252 byte differs from their value.
const WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** Normalise equivalent text forms without changing screenplay intent. */
export function sanitizePdfText(value) {
  return String(value ?? '')
    .normalize('NFC')
    // These are intentional layout whitespace, not printable PDF glyphs.
    .replace(/[\t\r\n\u00a0]/g, ' ');
}

/** Whether one Unicode code point has the same representation as PDF export. */
export function isPdfCodePointSupported(codePoint) {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WIN_ANSI.has(codePoint)
  );
}

/** Encode a complete PDF object/string as WinAnsi bytes. */
export function encodeWinAnsi(value) {
  const out = [];
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0);
    // Newline/tab/carriage return are PDF syntax when this encodes a complete
    // object. User text passes through sanitizePdfText first and becomes spaces.
    const structuralWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    out.push(
      WIN_ANSI.get(code) ??
      (isPdfCodePointSupported(code) || structuralWhitespace ? code : 63)
    );
  }
  return Uint8Array.from(out);
}

/**
 * Locate source ranges that the built-in PDF will replace with `?`.
 *
 * Combining marks are grouped with their base character before NFC
 * normalisation. This means a decomposed `e` + diaeresis is correctly accepted
 * while the returned offsets still refer to the original model string.
 */
export function unsupportedPdfCharacters(value) {
  const source = String(value ?? '');
  const clusters = [];

  for (let i = 0; i < source.length;) {
    const start = i;
    const code = source.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    while (i < source.length) {
      const nextCode = source.codePointAt(i);
      const next = String.fromCodePoint(nextCode);
      if (!/\p{Mark}/u.test(next)) break;
      i += nextCode > 0xffff ? 2 : 1;
    }
    clusters.push({ start, end: i, source: source.slice(start, i) });
  }

  return clusters
    .map((cluster) => ({ ...cluster, normalized: sanitizePdfText(cluster.source) }))
    .filter((cluster) =>
      [...cluster.normalized].some((char) => !isPdfCodePointSupported(char.codePointAt(0)))
    );
}
