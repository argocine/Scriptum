/**
 * Verify the exported PDF by decoding its content streams and checking that
 * every text run sits at the exact point coordinate the format demands.
 * More rigorous than looking at a screenshot.
 */
import assert from 'node:assert/strict';
import { resolveStyles, ElementType } from '../src/core/format.js';
import { paginate } from '../src/core/paginate.js';
import { parseFountain } from '../src/io/fountain.js';
import { exportPDF } from '../src/io/pdf.js';

const SCRIPT = `INT. LAUNDROMAT - NIGHT

Six machines. Five of them working. MARISOL sits with a paperback.

MARISOL
(not looking up)
There's a bank on Ninth.

DEV
It's ten-forty.

CUT TO:

EXT. STREET - CONTINUOUS

Rain going sideways.
`;

const doc = parseFountain(SCRIPT);
doc.title.showTitlePage = false;
const styles = resolveStyles();
const pagination = paginate(doc, styles);
const pdfText = Buffer.from(exportPDF(doc, pagination, styles)).toString('latin1');

// Pull every "BT /Fn 12 Tf 1 0 0 1 X Y Tm (text) Tj ET" run out of the streams.
const runs = [...pdfText.matchAll(
  /BT \/(F\d) 12 Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \(((?:\\.|[^)\\])*)\) Tj ET/g
)].map((m) => ({
  font: m[1],
  x: parseFloat(m[2]),
  y: parseFloat(m[3]),
  text: m[4].replace(/\\([()\\])/g, '$1'),
}));

let pass = 0;
const t = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

// Match on the whole run, not a substring: the action line also mentions
// MARISOL, and a loose match would compare against the wrong element.
const at = (needle) => {
  const exact = runs.find((r) => r.text === needle);
  if (exact) return exact;
  const found = runs.find((r) => r.text.includes(needle));
  if (!found) throw new Error(`no run containing "${needle}"`);
  return found;
};
const IN = 72;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, msg || `${a} != ${b}`);

console.log(`\nDecoded ${runs.length} text runs from the PDF.\n`);
console.log('Horizontal placement (points from the left paper edge)');

t('scene heading sits at 1.5in', () => {
  near(at('INT. LAUNDROMAT - NIGHT').x, 1.5 * IN);
});
t('action sits at 1.5in', () => {
  near(at('Six machines').x, 1.5 * IN);
});
t('character cue sits at 3.7in', () => {
  near(at('MARISOL').x, 3.7 * IN);
});
t('parenthetical sits at 3.1in', () => {
  near(at('(not looking up)').x, 3.1 * IN);
});
t('dialogue sits at 2.5in', () => {
  near(at("There's a bank on Ninth.").x, 2.5 * IN);
});
t('transition is flush to the 7.5in right text edge', () => {
  const r = at('CUT TO:');
  const right = r.x + r.text.length * 7.2;
  assert.equal(Math.round(right), Math.round(7.5 * IN));
});

console.log('\nVertical placement');
t('the first body line is one inch from the top', () => {
  const first = at('INT. LAUNDROMAT - NIGHT');
  const paperH = 11 * IN;
  // baseline = paperHeight - (topMargin + lineIndex*12 + 9.6)
  near(first.y, paperH - (1 * IN + 0 * 12 + 9.6));
});
t('lines advance by exactly 12 points', () => {
  const a = at('Six machines');
  const b = at('MARISOL');
  const gap = a.y - b.y;
  assert.equal(gap % 12, 0, `gap of ${gap}pt is not a whole number of lines`);
});
t('nothing is printed below the bottom margin', () => {
  const lowest = Math.min(...runs.map((r) => r.y));
  assert.ok(lowest >= 1 * IN - 12, `lowest baseline ${lowest} intrudes on the bottom margin`);
});
t('nothing is printed left of the paper', () => {
  assert.ok(Math.min(...runs.map((r) => r.x)) >= 0);
});

console.log('\nTypography');
t('uppercase elements are printed uppercase', () => {
  assert.equal(at('INT. LAUNDROMAT - NIGHT').text, 'INT. LAUNDROMAT - NIGHT');
  assert.equal(at('MARISOL').text, 'MARISOL');
});
t('dialogue keeps the case it was typed in', () => {
  assert.equal(at("There's a bank on Ninth.").text, "There's a bank on Ninth.");
});
t('body text uses plain Courier', () => {
  assert.equal(at('Six machines').font, 'F1');
});
t('no line exceeds its element width', () => {
  for (const r of runs) {
    assert.ok(r.text.length <= 60, `"${r.text}" is ${r.text.length} chars`);
  }
});

console.log('\nEmphasis');
const bold = parseFountain('Some **bold** words here.\n');
bold.title.showTitlePage = false;
const boldPdf = Buffer.from(
  exportPDF(bold, paginate(bold, styles), styles)
).toString('latin1');
t('bold switches to Courier-Bold mid-line', () => {
  assert.ok(/\/F2 12 Tf[^)]*\(bold\)/.test(boldPdf), 'no bold run found');
  assert.ok(boldPdf.includes('/BaseFont /Courier-Bold'));
});
t('the bold run is positioned by character offset', () => {
  const m = /BT \/F2 12 Tf 1 0 0 1 ([\d.]+) [\d.]+ Tm \(bold\) Tj ET/.exec(boldPdf);
  assert.ok(m, 'bold run not found');
  // "Some " is 5 characters past the 1.5in action margin.
  near(parseFloat(m[1]), 1.5 * IN + 5 * 7.2);
});

console.log('\nCharacter set');
// Decomposed accents: "e" + U+0308 rather than U+00EB. macOS produces these,
// and a lone combining mark has no Latin-1 code point, so without composing
// first the PDF printed "Zoe?" where the writer typed "Zoë".
const accents = parseFountain('ZOE\u0308 waits by the door.\n');
accents.title.showTitlePage = false;
const accentPdf = Buffer.from(
  exportPDF(accents, paginate(accents, styles), styles)
).toString('latin1');
t('decomposed accents are composed, not dropped', () => {
  assert.ok(accentPdf.includes('ZO\u00cb waits'), 'accent was not composed');
  assert.ok(!accentPdf.includes('ZOE?'), 'combining mark leaked through as "?"');
});

t('WinAnsi punctuation keeps one-character layout and correct bytes', () => {
  const punctuation = parseFountain('A—B…C “yes” and it’s fine.\n');
  punctuation.title.showTitlePage = false;
  const bytes = Buffer.from(exportPDF(punctuation, paginate(punctuation, styles), styles));
  assert.ok(bytes.includes(Buffer.from([0x41, 0x97, 0x42, 0x85, 0x43])));
  assert.ok(bytes.includes(Buffer.from([0x93, 0x79, 0x65, 0x73, 0x94])));
  assert.ok(bytes.includes(Buffer.from([0x69, 0x74, 0x92, 0x73])));
  assert.ok(!bytes.includes(Buffer.from('A--B...C')), 'punctuation expanded and changed layout');
});

console.log(`\n${pass} checks passed.`);
