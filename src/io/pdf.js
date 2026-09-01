/**
 * pdf.js — A minimal PDF 1.4 writer, written from scratch.
 *
 * There is no dependency and no embedded font file because Courier,
 * Courier-Bold, Courier-Oblique and Courier-BoldOblique are among the fourteen
 * fonts every PDF reader is required to provide. Their metrics (0.6 em advance)
 * are exactly the 10 characters per inch the paginator assumes, so the exported
 * page is character-for-character identical to what is on screen — and the file
 * carries no font licensing baggage.
 */

import { ElementType, applyCase } from '../core/format.js';

const PT = 72; // points per inch
const FONT_SIZE = 12;
const LINE_HEIGHT = 12; // 6 lines per inch
const CHAR_W = FONT_SIZE * 0.6; // Courier advance = 7.2pt
const BASELINE_IN_LINE = 9.6; // keeps print aligned with the on-screen box

const FONTS = {
  regular: { key: 'F1', base: 'Courier' },
  bold: { key: 'F2', base: 'Courier-Bold' },
  italic: { key: 'F3', base: 'Courier-Oblique' },
  bolditalic: { key: 'F4', base: 'Courier-BoldOblique' },
};

/* ------------------------------------------------------------------ *
 * Low-level object writer
 * ------------------------------------------------------------------ */

class PDFDoc {
  constructor() {
    this.objects = ['']; // index 0 is the free object
  }

  /** @returns {number} the new object's id */
  add(body) {
    this.objects.push(body);
    return this.objects.length - 1;
  }

  reserve() {
    this.objects.push(null);
    return this.objects.length - 1;
  }

  set(id, body) {
    this.objects[id] = body;
  }

  build(trailerExtra = '') {
    const chunks = [];
    let offset = 0;
    const push = (str) => {
      const bytes = winAnsi(str);
      chunks.push(bytes);
      offset += bytes.length;
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const xref = [0];
    for (let i = 1; i < this.objects.length; i += 1) {
      xref[i] = offset;
      push(`${i} 0 obj\n${this.objects[i]}\nendobj\n`);
    }

    const xrefStart = offset;
    let table = `xref\n0 ${this.objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objects.length; i += 1) {
      table += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
    }
    push(table);
    push(
      `trailer\n<< /Size ${this.objects.length} /Root 1 0 R ${trailerExtra} >>\n` +
        `startxref\n${xrefStart}\n%%EOF\n`
    );

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

// Unicode code points whose Windows-1252 byte differs from their value. PDF's
// WinAnsiEncoding is Windows-1252, not ISO-8859-1; encoding these correctly
// preserves typographic punctuation without changing pagination width.
const WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function winAnsi(str) {
  const out = [];
  for (const char of str) {
    const code = char.codePointAt(0);
    out.push(WIN_ANSI.get(code) ?? (code < 256 ? code : 63));
  }
  return Uint8Array.from(out);
}

/** Escape a string for a PDF literal. */
function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Normalise equivalent text forms without changing character width. */
function sanitize(s) {
  return s
    // Compose accents first. macOS hands back decomposed text in several
    // places, and a lone combining mark has no Latin-1 code point, so an
    // un-composed "Zoë" would otherwise print as "Zoe?".
    .normalize('NFC')
    .replace(/ /g, ' ');
}

/* ------------------------------------------------------------------ *
 * Content stream builder for one page
 * ------------------------------------------------------------------ */

class PageStream {
  constructor(pageHeightPt) {
    this.h = pageHeightPt;
    this.ops = [];
  }

  /**
   * Draw one run of text.
   * @param {number} xIn   left position in inches
   * @param {number} line  0-based body line index
   */
  text(xIn, line, topMarginIn, str, { bold, italic, underline } = {}) {
    if (!str) return;
    const font = pickFont(bold, italic);
    const x = xIn * PT;
    const y = this.h - (topMarginIn * PT + line * LINE_HEIGHT + BASELINE_IN_LINE);
    this.ops.push(
      `BT /${font.key} ${FONT_SIZE} Tf 1 0 0 1 ${fmt(x)} ${fmt(y)} Tm (${esc(sanitize(str))}) Tj ET`
    );
    if (underline) {
      const w = str.length * CHAR_W;
      const uy = y - 1.6;
      this.ops.push(`0.6 w ${fmt(x)} ${fmt(uy)} m ${fmt(x + w)} ${fmt(uy)} l S`);
    }
  }

  /** Draw a line of text that carries inline emphasis ranges. */
  styledText(xIn, line, topMarginIn, str, ranges, base = {}) {
    if (!ranges || !ranges.length) {
      this.text(xIn, line, topMarginIn, str, base);
      return;
    }
    const runs = splitIntoRuns(str, ranges, base);
    for (const run of runs) {
      this.text(xIn + (run.start * CHAR_W) / PT, line, topMarginIn, run.text, run);
    }
  }

  toString() {
    return this.ops.join('\n');
  }
}

function pickFont(bold, italic) {
  if (bold && italic) return FONTS.bolditalic;
  if (bold) return FONTS.bold;
  if (italic) return FONTS.italic;
  return FONTS.regular;
}

function fmt(n) {
  return Math.round(n * 100) / 100;
}

/** Break a line into runs of uniform styling. */
function splitIntoRuns(str, ranges, base) {
  const attrs = new Array(str.length).fill(null).map(() => ({ ...base }));
  for (const r of ranges) {
    for (let i = Math.max(0, r.start); i < Math.min(str.length, r.end); i += 1) {
      if (r.bold) attrs[i].bold = true;
      if (r.italic) attrs[i].italic = true;
      if (r.underline) attrs[i].underline = true;
    }
  }

  const runs = [];
  let i = 0;
  while (i < str.length) {
    const a = attrs[i];
    let j = i + 1;
    while (
      j < str.length &&
      attrs[j].bold === a.bold &&
      attrs[j].italic === a.italic &&
      attrs[j].underline === a.underline
    ) {
      j += 1;
    }
    runs.push({ start: i, text: str.slice(i, j), ...a });
    i = j;
  }
  return runs;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Render a paginated screenplay to PDF bytes.
 * @param {object} doc
 * @param {object} pagination  from paginate()
 * @param {object} styles      from resolveStyles()
 * @returns {Uint8Array}
 */
export function exportPDF(doc, pagination, styles) {
  const pdf = new PDFDoc();
  const paperW = styles.paper.width * PT;
  const paperH = styles.paper.height * PT;
  const topMargin = styles.page.marginTop;

  const catalogId = pdf.reserve(); // 1
  const pagesId = pdf.reserve(); // 2

  const fontIds = {};
  for (const f of Object.values(FONTS)) {
    fontIds[f.key] = pdf.add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`
    );
  }
  const fontDict = Object.entries(fontIds)
    .map(([k, id]) => `/${k} ${id} 0 R`)
    .join(' ');

  const pageIds = [];
  const addPage = (stream) => {
    const content = stream.toString();
    const contentId = pdf.add(
      `<< /Length ${winAnsi(content).length} >>\nstream\n${content}\nendstream`
    );
    const pageId = pdf.add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(paperW)} ${fmt(paperH)}] ` +
        `/Resources << /Font << ${fontDict} >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  };

  // ---- Title page ----
  if (doc.title.showTitlePage) {
    addPage(buildTitleStream(doc, styles, paperH, paperW));
  }

  // ---- Script pages ----
  pagination.pages.forEach((page, pageIndex) => {
    const s = new PageStream(paperH);

    // Page number, inside the top margin, flush to the right text edge.
    const showNum =
      styles.page.showPageNumbers && (pageIndex > 0 || styles.page.firstPageNumbered);
    if (showNum) {
      const label = page.number + (styles.page.pageNumberSuffix || '');
      const rightIn = styles.paper.width - styles.page.marginRight;
      const x = rightIn - (label.length * CHAR_W) / PT;
      const y = paperH - styles.page.pageNumberTop * PT;
      s.ops.push(
        `BT /F1 ${FONT_SIZE} Tf 1 0 0 1 ${fmt(x * PT)} ${fmt(y)} Tm (${esc(label)}) Tj ET`
      );
    }

    // Revision header, opposite the page number.
    const revHeader = revisionHeader(doc);
    if (revHeader) {
      const y = paperH - styles.page.pageNumberTop * PT;
      s.ops.push(
        `BT /F1 ${FONT_SIZE} Tf 1 0 0 1 ${fmt(styles.page.marginLeft * PT)} ${fmt(y)} Tm ` +
          `(${esc(sanitize(revHeader))}) Tj ET`
      );
    }

    page.lines.forEach((line, li) => {
      if (line.kind === 'blank') return;

      if (line.kind === 'dualrow') {
        for (const side of ['left', 'right']) {
          const l = line[side];
          if (!l) continue;
          s.styledText(l.x, li, topMargin, applyCase(l.rawText ?? l.text, { case: caseOf(l.type) }), l.styles, {
            bold: l.bold,
            italic: l.italic,
            underline: l.underline,
          });
        }
        return;
      }

      const spec = styles.elements[line.type] || styles.elements[ElementType.ACTION];
      const text = line.text || '';
      let x = line.x;

      if (line.align === 'right') {
        x = line.right - (text.length * CHAR_W) / PT;
      } else if (line.align === 'center') {
        x = (line.x + line.right) / 2 - (text.length * CHAR_W) / PT / 2;
      }

      s.styledText(x, li, topMargin, text, line.styles, {
        bold: spec.bold,
        italic: spec.italic,
        underline: spec.underline || line.type === ElementType.ACT_BREAK,
      });

      // Scene numbers in both gutters.
      if (line.type === ElementType.SCENE_HEADING && line.sceneNumber && line.isFirst) {
        const n = line.sceneNumber;
        if (doc.sceneNumbering.showLeft) {
          s.text(0.5, li, topMargin, n);
        }
        if (doc.sceneNumbering.showRight) {
          s.text(styles.paper.width - styles.page.marginRight + 0.15, li, topMargin, n);
        }
      }

      // Revision asterisk in the right margin.
      if (line.revisionMark) {
        s.text(styles.paper.width - styles.page.marginRight + 0.55, li, topMargin, line.revisionMark, {
          bold: true,
        });
      }
    });

    addPage(s);
  });

  pdf.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const info = pdf.add(
    `<< /Title (${esc(sanitize(doc.title.title || 'Untitled'))}) ` +
      `/Author (${esc(sanitize(doc.title.author || ''))}) ` +
      `/Creator (Scriptum) /Producer (Scriptum) >>`
  );

  return pdf.build(`/Info ${info} 0 R`);
}

function caseOf(type) {
  return type === ElementType.CHARACTER ||
    type === ElementType.SCENE_HEADING ||
    type === ElementType.TRANSITION ||
    type === ElementType.SHOT
    ? 'upper'
    : 'none';
}

function revisionHeader(doc) {
  const id = doc.revisions?.current;
  if (!id) return '';
  const set = doc.revisions.sets.find((s) => s.id === id);
  if (!set) return '';
  return set.date ? `${set.name}  ${set.date}` : set.name;
}

function buildTitleStream(doc, styles, paperH, paperW) {
  const s = new PageStream(paperH);
  const t = doc.title;
  const centreAt = (str, lineFromTop, opts = {}) => {
    if (!str) return;
    for (const [i, ln] of str.split('\n').entries()) {
      const x = (paperW / 2 - (ln.length * CHAR_W) / 2) / PT;
      s.text(x, lineFromTop + i, 0, ln, opts);
    }
  };

  // 3.5in down for the title is the long-standing convention.
  centreAt((t.title || '').toUpperCase(), 21, { underline: true });
  centreAt(t.credit || '', 25);
  centreAt(t.author || '', 27);
  centreAt(t.source || '', 31);

  const bottomLine = Math.floor((styles.paper.height - 1.4) * 6);
  if (t.contact) {
    t.contact.split('\n').forEach((ln, i) => {
      s.text(styles.page.marginLeft, bottomLine + i, 0, ln);
    });
  }
  if (t.draftDate) {
    t.draftDate.split('\n').forEach((ln, i) => {
      const rightIn = styles.paper.width - styles.page.marginRight;
      s.text(rightIn - (ln.length * CHAR_W) / PT, bottomLine + i, 0, ln);
    });
  }

  return s;
}
