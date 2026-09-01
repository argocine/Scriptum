import assert from 'node:assert/strict';
import {
  resolveStyles,
  ElementType,
  charsBetween,
  linesFromMargins,
  marginBottomFromLines,
  PAPER,
  applyCase,
} from '../src/core/format.js';
import { createDocument, createElement, getScenes, collectCharacters } from '../src/core/model.js';
import { paginate, wrapText, assignSceneNumbers, lockPages } from '../src/core/paginate.js';
import { parseFountain, toFountain, parseInline, serializeInline } from '../src/io/fountain.js';
import { exportPDF } from '../src/io/pdf.js';
import { toPlainText } from '../src/io/project.js';
import { sceneReport, characterReport, statistics } from '../src/features/reports.js';
import { fallbackTextClusters, textClusters } from '../src/core/unicode.js';

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

const styles = resolveStyles();

/* ---------------- geometry ---------------- */
console.log('\nGeometry');
t('action is 60 characters wide', () => {
  assert.equal(styles.elements[ElementType.ACTION].width, 60);
});
t('dialogue is 40 characters wide', () => {
  assert.equal(charsBetween(2.5, 6.5), 40);
});
t('55 lines per page', () => assert.equal(styles.page.linesPerPage, 55));

/* ---------------- page box ----------------
 * The bottom margin used to be stored but never consulted: pagination read
 * only linesPerPage, so Page Setup could report a 1" bottom margin while the
 * page actually left 0.83". These checks hold the two in agreement.
 */
console.log('\nPage box');
t('the reported bottom margin is the one the page leaves', () => {
  const { page, paper } = styles;
  const used = page.marginTop + page.linesPerPage / 6;
  assert.equal(Math.round((paper.height - used) * 1000) / 1000, page.marginBottom);
});
t('55 lines under a 1in top margin leave 0.833in', () => {
  assert.equal(styles.page.marginBottom, 0.833);
});
t('setting the bottom margin changes the line count', () => {
  const oneInch = resolveStyles({}, { marginBottom: 1.0, linesPerPage: linesFromMargins(PAPER.letter, 1.0, 1.0) });
  assert.equal(oneInch.page.linesPerPage, 54, 'a true 1in bottom margin holds 54 lines');
  assert.equal(oneInch.page.marginBottom, 1);
});
t('lines and margin round-trip without drift', () => {
  for (let lines = 40; lines <= 60; lines += 1) {
    const mb = marginBottomFromLines(PAPER.letter, 1.0, lines);
    assert.equal(linesFromMargins(PAPER.letter, 1.0, mb), lines, `lost a line at ${lines}`);
  }
});
t('a taller top margin eats into the bottom, not the line count', () => {
  const s2 = resolveStyles({}, { marginTop: 1.5 });
  assert.equal(s2.page.linesPerPage, 55, 'line count must hold');
  assert.equal(s2.page.marginBottom, 0.333);
});
t('an impossible top margin reduces the lines rather than going negative', () => {
  const s3 = resolveStyles({}, { marginTop: 9.5 });
  assert.ok(s3.page.marginBottom >= 0.25, `bottom margin was ${s3.page.marginBottom}`);
  assert.ok(s3.page.linesPerPage >= 10);
});
t('A4 keeps the same line count as Letter', () => {
  const a4 = resolveStyles({}, { paper: 'a4' });
  assert.equal(a4.page.linesPerPage, 55, 'page count must not shift with paper size');
  assert.ok(a4.page.marginBottom > styles.page.marginBottom, 'a taller page leaves more room');
});

/* ---------------- wrapping ---------------- */
console.log('\nWrapping');
t('breaks at spaces, never mid-word', () => {
  const lines = wrapText('the quick brown fox jumps over the lazy dog', 10);
  lines.forEach((l) => assert.ok(l.text.length <= 10, `"${l.text}" too long`));
  assert.equal(lines.map((l) => l.text).join(' '), 'the quick brown fox jumps over the lazy dog');
});
t('offsets index the original string', () => {
  const src = 'alpha beta gamma delta epsilon';
  const lines = wrapText(src, 11);
  lines.forEach((l) => assert.equal(src.slice(l.start, l.end).trim(), l.text));
});
t('hard-breaks a word longer than the line', () => {
  const lines = wrapText('supercalifragilistic', 8);
  assert.ok(lines.length >= 3);
  lines.forEach((l) => assert.ok(l.text.length <= 8));
});
t('empty text yields one empty line', () => {
  assert.deepEqual(wrapText('', 60), [{ text: '', start: 0, end: 0 }]);
});
t('combining marks and joined emoji are never split', () => {
  const source = 'Ae\u0308👩‍🚀B';
  const lines = wrapText(source, 2);
  assert.deepEqual(lines.map((line) => line.text), ['Ae\u0308', '👩‍🚀', 'B']);
  lines.forEach((line) => assert.equal(source.slice(line.start, line.end), line.text));
});
t('Indic conjuncts and Hangul Jamo remain complete grapheme clusters', () => {
  const source = 'Aक्ष한B';
  assert.deepEqual(textClusters(source).map((cluster) => cluster.text), ['A', 'क्ष', '한', 'B']);
  assert.deepEqual(fallbackTextClusters(source).map((cluster) => cluster.text), ['A', 'क्ष', '한', 'B']);
  assert.deepEqual(wrapText(source, 1).map((line) => line.text), ['A', 'क्ष', '한', 'B']);
});
t('full-width scripts use two screenplay cells per glyph', () => {
  assert.deepEqual(wrapText('東京猫犬', 6).map((line) => line.text), ['東京猫', '犬']);
});
t('Unicode uppercasing keeps selection and style offsets stable', () => {
  const source = 'café straße µ';
  const upper = applyCase(source, { case: 'upper' });
  assert.equal(upper, 'CAFÉ STRAẞE Μ');
  assert.equal(upper.length, source.length);
});

/* ---------------- pagination ---------------- */
console.log('\nPagination');

function build(n) {
  const doc = createDocument({ elements: [] });
  for (let i = 0; i < n; i += 1) {
    doc.elements.push(createElement(ElementType.SCENE_HEADING, `INT. ROOM ${i} - DAY`));
    doc.elements.push(
      createElement(ElementType.ACTION, 'Something happens here that takes up a line or two of action text on the page.')
    );
    doc.elements.push(createElement(ElementType.CHARACTER, `SPEAKER ${i % 3}`));
    doc.elements.push(createElement(ElementType.DIALOGUE, 'A line of dialogue that says something meaningful and continues for a while.'));
  }
  return doc;
}

t('no page exceeds the line limit', () => {
  const p = paginate(build(40), styles);
  p.pages.forEach((pg, i) => {
    assert.ok(pg.lines.length <= 55, `page ${i + 1} had ${pg.lines.length} lines`);
  });
});

t('pages never open with a blank line', () => {
  const p = paginate(build(40), styles);
  p.pages.forEach((pg, i) => {
    if (pg.lines.length) assert.notEqual(pg.lines[0].kind, 'blank', `page ${i + 1}`);
  });
});

t('a scene heading is never the last line on a page', () => {
  const p = paginate(build(60), styles);
  p.pages.forEach((pg, i) => {
    const last = [...pg.lines].reverse().find((l) => l.kind === 'text');
    if (last) {
      assert.notEqual(last.type, ElementType.SCENE_HEADING, `page ${i + 1} ends on a slugline`);
    }
  });
});

t('a character cue is never orphaned at the foot of a page', () => {
  const p = paginate(build(60), styles);
  p.pages.forEach((pg, i) => {
    const last = [...pg.lines].reverse().find((l) => l.kind === 'text');
    if (last) assert.notEqual(last.type, ElementType.CHARACTER, `page ${i + 1} ends on a cue`);
  });
});

t('split dialogue gets (MORE) and NAME (CONT\'D)', () => {
  const doc = createDocument({ elements: [] });
  // Fill most of a page, then a long speech that must break.
  doc.elements.push(createElement(ElementType.SCENE_HEADING, 'INT. ROOM - DAY'));
  for (let i = 0; i < 22; i += 1) {
    doc.elements.push(createElement(ElementType.ACTION, `Beat ${i}.`));
  }
  doc.elements.push(createElement(ElementType.CHARACTER, 'MARGUERITE'));
  doc.elements.push(
    createElement(
      ElementType.DIALOGUE,
      Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} of a very long speech.`).join(' ')
    )
  );
  const p = paginate(doc, styles);
  assert.ok(p.totalPages >= 2, 'expected the speech to break across pages');

  const flat = p.pages.flatMap((pg, i) => pg.lines.map((l) => ({ ...l, page: i })));
  const more = flat.find((l) => l.kind === 'more');
  const contd = flat.find((l) => l.kind === 'contd');
  assert.ok(more, 'no (MORE) emitted');
  assert.ok(contd, 'no (CONT\'D) emitted');
  assert.equal(more.text, '(MORE)');
  assert.match(contd.text, /MARGUERITE \(CONT'D\)/);
  assert.equal(contd.page, more.page + 1, 'CONT\'D must open the following page');
});

t('minimum two dialogue lines survive on each side of a break', () => {
  const doc = createDocument({ elements: [] });
  doc.elements.push(createElement(ElementType.SCENE_HEADING, 'INT. ROOM - DAY'));
  for (let i = 0; i < 24; i += 1) doc.elements.push(createElement(ElementType.ACTION, `Beat ${i}.`));
  doc.elements.push(createElement(ElementType.CHARACTER, 'ANA'));
  doc.elements.push(
    createElement(ElementType.DIALOGUE, Array.from({ length: 30 }, (_, i) => `Sentence ${i} here.`).join(' '))
  );
  const p = paginate(doc, styles);
  for (let i = 0; i < p.pages.length; i += 1) {
    const dialogueLines = p.pages[i].lines.filter(
      (l) => l.kind === 'text' && l.type === ElementType.DIALOGUE
    );
    if (dialogueLines.length) assert.ok(dialogueLines.length >= 2, `page ${i + 1} had ${dialogueLines.length}`);
  }
});

t('page count is stable across repeated runs', () => {
  const doc = build(30);
  const a = paginate(doc, styles).totalPages;
  const b = paginate(doc, styles).totalPages;
  assert.equal(a, b);
});

t('locked pages produce A-pages when material is inserted', () => {
  const doc = build(20);
  const first = paginate(doc, styles);
  const originalPages = first.totalPages;
  lockPages(doc, first);

  // Insert a page's worth of new action near the front.
  const extra = Array.from({ length: 30 }, (_, i) =>
    createElement(ElementType.ACTION, `Inserted beat ${i} with enough text to occupy a line.`)
  );
  doc.elements.splice(4, 0, ...extra);

  const after = paginate(doc, styles);
  assert.ok(after.totalPages > originalPages, 'expected the script to grow');
  const aPages = after.pages.filter((p) => p.isAPage);
  assert.ok(aPages.length > 0, 'expected at least one A-page');
  assert.match(aPages[0].number, /^\d+[A-Z]+$/);
});

/* ---------------- scene numbering ---------------- */
console.log('\nScene numbers');
t('numbers scenes sequentially when enabled', () => {
  const doc = build(5);
  doc.sceneNumbering.enabled = true;
  assignSceneNumbers(doc);
  const nums = doc.elements.filter((e) => e.type === ElementType.SCENE_HEADING).map((e) => e.sceneNumber);
  assert.deepEqual(nums, ['1', '2', '3', '4', '5']);
});

t('locked numbering gives new scenes letter suffixes', () => {
  const doc = build(3);
  doc.sceneNumbering.enabled = true;
  assignSceneNumbers(doc);
  doc.elements.filter((e) => e.type === ElementType.SCENE_HEADING).forEach((e) => {
    e.sceneNumberLocked = true;
  });
  doc.sceneNumbering.locked = true;

  const idx = doc.elements.findIndex((e) => e.sceneNumber === '2');
  doc.elements.splice(idx, 0, createElement(ElementType.SCENE_HEADING, 'INT. NEW - DAY'));
  assignSceneNumbers(doc);

  const nums = doc.elements.filter((e) => e.type === ElementType.SCENE_HEADING).map((e) => e.sceneNumber);
  assert.deepEqual(nums, ['1', '1A', '2', '3']);
});

/* ---------------- fountain ---------------- */
console.log('\nFountain');
const SAMPLE = `Title: The Long Walk
Credit: Written by
Author: A. Writer

INT. DINER - NIGHT

A neon sign buzzes. RAIN streaks the window.

SAM
(quietly)
You came back.

JULES
I never left.

CUT TO:

EXT. HIGHWAY - CONTINUOUS

Headlights sweep the asphalt.
`;

t('parses the title page', () => {
  const doc = parseFountain(SAMPLE);
  assert.equal(doc.title.title, 'The Long Walk');
  assert.equal(doc.title.author, 'A. Writer');
});

t('identifies every element type', () => {
  const doc = parseFountain(SAMPLE);
  const types = doc.elements.map((e) => e.type);
  assert.ok(types.includes(ElementType.SCENE_HEADING));
  assert.ok(types.includes(ElementType.ACTION));
  assert.ok(types.includes(ElementType.CHARACTER));
  assert.ok(types.includes(ElementType.PARENTHETICAL));
  assert.ok(types.includes(ElementType.DIALOGUE));
  assert.ok(types.includes(ElementType.TRANSITION));
});

t('round-trips without losing elements', () => {
  const a = parseFountain(SAMPLE);
  const b = parseFountain(toFountain(a));
  assert.equal(
    b.elements.filter((e) => e.text.trim()).length,
    a.elements.filter((e) => e.text.trim()).length
  );
  assert.deepEqual(
    b.elements.filter((e) => e.text.trim()).map((e) => e.type),
    a.elements.filter((e) => e.text.trim()).map((e) => e.type)
  );
});

t('parses inline emphasis into ranges', () => {
  const { text, styles: st } = parseInline('a **bold** and *italic* and _under_');
  assert.equal(text, 'a bold and italic and under');
  assert.ok(st.some((r) => r.bold));
  assert.ok(st.some((r) => r.italic));
  assert.ok(st.some((r) => r.underline));
});

t('round-trips inline emphasis', () => {
  const src = 'plain **bold** plain';
  const a = parseInline(src);
  const b = parseInline(serializeInline(a.text, a.styles));
  assert.equal(b.text, a.text);
  assert.deepEqual(b.styles, a.styles);
});

t('handles dual dialogue markers', () => {
  const doc = parseFountain(`INT. BAR - NIGHT

SAM
Hello.

JULES ^
Goodbye.
`);
  const dual = doc.elements.filter((e) => e.dual);
  assert.ok(dual.length >= 4, `expected both speeches marked, got ${dual.length}`);
  assert.ok(dual.some((e) => e.dual === 'left'));
  assert.ok(dual.some((e) => e.dual === 'right'));
});

/* ---------------- reports ---------------- */
console.log('\nReports');
t('scene report lists every scene with a page', () => {
  const doc = parseFountain(SAMPLE);
  const p = paginate(doc, styles);
  const rows = sceneReport(doc, p, styles);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].location, 'DINER');
  assert.equal(rows[0].time, 'NIGHT');
  assert.equal(rows[0].intExt, 'INT.');
  assert.ok(rows[0].cast.includes('SAM'));
});

t('character report counts speeches and words', () => {
  const doc = parseFountain(SAMPLE);
  const rows = characterReport(doc, paginate(doc, styles));
  const sam = rows.find((r) => r.name === 'SAM');
  assert.ok(sam, 'SAM missing');
  assert.equal(sam.cues, 1);
  assert.ok(sam.words > 0);
});

t('statistics are internally consistent', () => {
  const doc = build(20);
  const p = paginate(doc, styles);
  const s = statistics(doc, p, styles);
  assert.equal(s.scenes, 20);
  assert.equal(s.words, s.dialogueWords + s.actionWords);
  assert.equal(s.pages, p.totalPages);
});

/* ---------------- PDF ---------------- */
console.log('\nPDF');
t('emits a structurally valid PDF', () => {
  const doc = parseFountain(SAMPLE);
  const p = paginate(doc, styles);
  const bytes = exportPDF(doc, p, styles);
  const text = Buffer.from(bytes).toString('latin1');

  assert.ok(text.startsWith('%PDF-1.4'), 'missing header');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'missing EOF');
  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes('/BaseFont /Courier'), 'Courier not referenced');
  assert.ok(text.includes('/Type /Page'), 'no page objects');

  // The xref offset must point at the real xref table.
  const m = /startxref\s+(\d+)/.exec(text);
  assert.ok(m, 'no startxref');
  assert.equal(text.slice(Number(m[1]), Number(m[1]) + 4), 'xref', 'startxref points at the wrong byte');
});

t('page count in the PDF matches the pagination', () => {
  const doc = build(25);
  doc.title.showTitlePage = false;
  const p = paginate(doc, styles);
  const text = Buffer.from(exportPDF(doc, p, styles)).toString('latin1');
  const count = /\/Count (\d+)/.exec(text);
  assert.equal(Number(count[1]), p.totalPages);
});

t('title page adds exactly one page', () => {
  const doc = build(5);
  doc.title.showTitlePage = true;
  const p = paginate(doc, styles);
  const text = Buffer.from(exportPDF(doc, p, styles)).toString('latin1');
  assert.equal(Number(/\/Count (\d+)/.exec(text)[1]), p.totalPages + 1);
});

t('escapes parentheses in dialogue', () => {
  const doc = createDocument({ elements: [createElement(ElementType.ACTION, 'A (parenthetical) aside')] });
  doc.title.showTitlePage = false;
  const text = Buffer.from(exportPDF(doc, paginate(doc, styles), styles)).toString('latin1');
  assert.ok(text.includes('\\(parenthetical\\)'), 'parentheses not escaped');
});

/* ---------------- plain text ---------------- */
console.log('\nPlain text');
t('indents elements at the right columns', () => {
  const doc = parseFountain(SAMPLE);
  const out = toPlainText(doc, paginate(doc, styles), styles);
  const cue = out.split('\n').find((l) => l.trim() === 'SAM');
  assert.ok(cue, 'character cue missing');
  assert.equal(cue.length - cue.trimStart().length, 37, 'cue indent should be 3.7in = 37 chars');
});

console.log(`\n${pass} checks passed.`);
