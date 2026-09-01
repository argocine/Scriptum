/**
 * Unicode-capable PDF print view.
 *
 * The legacy byte writer remains available as a deterministic fallback and
 * test oracle, but Electron exports this dedicated DOM through Chromium. That
 * lets the operating system supply local font fallbacks and lets Chromium do
 * complex-script shaping and embed the fonts it actually used in the PDF.
 */

import { ElementType, applyCase } from '../core/format.js';
import { textClusters } from '../core/unicode.js';

const LINE_HEIGHT_IN = 1 / 6;
const TEXT_BASELINE_IN = 9.6 / 72;
const BUNDLED_PDF_FONTS = [
  ['Scriptum Noto Mono', 'AПривет'],
  ['Scriptum Noto Mono CJK', '東京한'],
  ['Scriptum Noto Devanagari', 'क्ष'],
  ['Scriptum Noto Arabic', 'مرحبا'],
  ['Scriptum Noto Hebrew', 'שלום'],
];

/** Build a serializable description of every mark that belongs on the PDF. */
export function createPrintModel(doc, pagination, styles) {
  const pages = [];

  if (doc.title?.showTitlePage) {
    pages.push({ kind: 'title', label: 'Title page', lines: titleLines(doc, styles) });
  }

  const revision = revisionHeader(doc);
  for (const [pageIndex, page] of pagination.pages.entries()) {
    const lines = [];
    const showPageNumber =
      styles.page.showPageNumbers && (pageIndex > 0 || styles.page.firstPageNumbered);

    if (showPageNumber) {
      lines.push({
        kind: 'page-number',
        text: page.number + (styles.page.pageNumberSuffix || ''),
        x: styles.page.marginLeft,
        right: styles.paper.width - styles.page.marginRight,
        top: Math.max(0, styles.page.pageNumberTop - TEXT_BASELINE_IN),
        align: 'right',
      });
    }

    if (revision) {
      lines.push({
        kind: 'revision-header',
        text: revision,
        x: styles.page.marginLeft,
        right: styles.paper.width - styles.page.marginRight,
        top: Math.max(0, styles.page.pageNumberTop - TEXT_BASELINE_IN),
        align: 'left',
      });
    }

    page.lines.forEach((line, lineIndex) => {
      if (line.kind === 'blank') return;
      const top = styles.page.marginTop + lineIndex * LINE_HEIGHT_IN;

      if (line.kind === 'dualrow') {
        for (const side of ['left', 'right']) {
          if (line[side]) lines.push(printableLine(line[side], top, styles));
        }
        return;
      }

      lines.push(printableLine(line, top, styles));

      if (line.type === ElementType.SCENE_HEADING && line.sceneNumber && line.isFirst) {
        if (doc.sceneNumbering?.showLeft) {
          lines.push({
            kind: 'scene-number',
            text: line.sceneNumber,
            x: Math.max(0.2, styles.page.marginLeft - 1),
            right: styles.page.marginLeft - 0.1,
            top,
            align: 'left',
          });
        }
        if (doc.sceneNumbering?.showRight) {
          lines.push({
            kind: 'scene-number',
            text: line.sceneNumber,
            x: styles.paper.width - styles.page.marginRight + 0.1,
            right: styles.paper.width - 0.2,
            top,
            align: 'left',
          });
        }
      }

      if (line.revisionMark) {
        lines.push({
          kind: 'revision-mark',
          text: line.revisionMark,
          x: styles.paper.width - styles.page.marginRight + 0.55,
          right: styles.paper.width - 0.2,
          top,
          align: 'left',
          bold: true,
        });
      }
    });

    pages.push({ kind: 'script', label: `Screenplay page ${page.number}`, lines });
  }

  return {
    title: doc.title?.title || 'Untitled',
    width: styles.paper.width,
    height: styles.paper.height,
    pages,
  };
}

/** Mount all pages in a print-only tree and return a cleanup handle. */
export function mountPrintView(root, doc, pagination, styles) {
  if (!root) throw new Error('The PDF print surface is unavailable.');
  const model = createPrintModel(doc, pagination, styles);
  const previousTitle = document.title;
  const style = document.createElement('style');
  style.id = 'pdf-page-size';
  style.textContent = `@page { size: ${model.width}in ${model.height}in; margin: 0; }`;
  document.head.appendChild(style);

  root.replaceChildren();
  root.setAttribute('aria-hidden', 'false');
  root.setAttribute('aria-label', `${model.title} PDF export`);

  for (const page of model.pages) {
    const pageElement = document.createElement('section');
    pageElement.className = 'pdf-print-page';
    pageElement.setAttribute('aria-label', page.label);
    pageElement.style.width = `${model.width}in`;
    pageElement.style.height = `${model.height}in`;
    for (const line of page.lines) pageElement.appendChild(renderLine(line));
    root.appendChild(pageElement);
  }

  document.title = model.title;
  let cleaned = false;
  return {
    model,
    ready: loadBundledPdfFonts(),
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      style.remove();
      root.replaceChildren();
      root.setAttribute('aria-hidden', 'true');
      root.removeAttribute('aria-label');
      document.title = previousTitle;
    },
  };
}

async function loadBundledPdfFonts() {
  if (!document.fonts?.load) return;
  for (const [family, sample] of BUNDLED_PDF_FONTS) {
    const loaded = await document.fonts.load(`12pt "${family}"`, sample);
    if (!loaded.length) throw new Error(`Bundled PDF font failed to load: ${family}`);
  }
  await document.fonts.ready;
}

function printableLine(line, top, styles) {
  const spec = styles.elements[line.type] || styles.elements[ElementType.ACTION];
  return {
    kind: line.kind || 'text',
    text: line.text || '',
    x: Number.isFinite(line.x) ? line.x : spec.left,
    right: Number.isFinite(line.right) ? line.right : spec.right,
    top,
    align: line.align || spec.align || 'left',
    bold: !!(line.bold || spec.bold),
    italic: !!(line.italic || spec.italic),
    underline: !!(line.underline || spec.underline || line.type === ElementType.ACT_BREAK),
    styles: line.styles || [],
  };
}

function titleLines(doc, styles) {
  const title = doc.title || {};
  const lines = [];
  const centered = (value, top, extra = {}) => {
    String(value || '').split('\n').forEach((text, index) => {
      if (!text) return;
      lines.push({
        kind: 'title',
        text,
        x: styles.page.marginLeft,
        right: styles.paper.width - styles.page.marginRight,
        top: top + index * LINE_HEIGHT_IN,
        align: 'center',
        ...extra,
      });
    });
  };

  centered(applyCase(title.title || '', { case: 'upper' }), 3.5, { underline: true });
  centered(title.credit, 25 / 6);
  centered(title.author, 27 / 6);
  centered(title.source, 31 / 6);

  const bottom = styles.paper.height - 1.4;
  String(title.contact || '').split('\n').forEach((text, index) => {
    if (text) {
      lines.push({
        kind: 'contact', text, x: styles.page.marginLeft,
        right: styles.paper.width / 2, top: bottom + index * LINE_HEIGHT_IN, align: 'left',
      });
    }
  });
  String(title.draftDate || '').split('\n').forEach((text, index) => {
    if (text) {
      lines.push({
        kind: 'draft-date', text, x: styles.paper.width / 2,
        right: styles.paper.width - styles.page.marginRight,
        top: bottom + index * LINE_HEIGHT_IN, align: 'right',
      });
    }
  });
  return lines;
}

function renderLine(line) {
  const element = document.createElement('div');
  element.className = `pdf-print-line pdf-${line.kind}`;
  element.setAttribute('dir', 'auto');
  element.style.left = `${line.x}in`;
  element.style.top = `${line.top}in`;
  element.style.width = `${Math.max(0.1, line.right - line.x)}in`;
  element.style.textAlign = line.align || 'left';
  if (line.bold) element.style.fontWeight = '700';
  if (line.italic) element.style.fontStyle = 'italic';
  if (line.underline) element.style.textDecoration = 'underline';
  appendStyledText(element, line.text, line.styles);
  return element;
}

function appendStyledText(host, text, ranges = []) {
  if (!ranges.length) {
    host.textContent = text;
    return;
  }

  for (const run of styledRuns(text, ranges)) {
    const span = document.createElement('span');
    span.textContent = run.text;
    if (run.bold) span.style.fontWeight = '700';
    if (run.italic) span.style.fontStyle = 'italic';
    if (run.underline) span.style.textDecoration = 'underline';
    host.appendChild(span);
  }
}

export function styledRuns(text, ranges) {
  const normalizedRanges = ranges.map((range) => ({
    ...range,
    start: snapToClusterStart(text, range.start),
    end: snapToClusterEnd(text, range.end),
  })).filter((range) => range.end > range.start);
  const boundaries = new Set([0, text.length]);
  for (const range of normalizedRanges) {
    boundaries.add(Math.max(0, Math.min(text.length, range.start)));
    boundaries.add(Math.max(0, Math.min(text.length, range.end)));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const active = normalizedRanges.filter((range) => range.start <= start && range.end >= end);
    runs.push({
      text: text.slice(start, end),
      bold: active.some((range) => range.bold),
      italic: active.some((range) => range.italic),
      underline: active.some((range) => range.underline),
    });
  }
  return runs;
}

function snapToClusterStart(text, value) {
  const offset = Math.max(0, Math.min(text.length, Math.floor(Number(value) || 0)));
  const cluster = textClusters(text).find((item) => item.start < offset && offset < item.end);
  return cluster ? cluster.start : offset;
}

function snapToClusterEnd(text, value) {
  const offset = Math.max(0, Math.min(text.length, Math.floor(Number(value) || 0)));
  const cluster = textClusters(text).find((item) => item.start < offset && offset < item.end);
  return cluster ? cluster.end : offset;
}

function revisionHeader(doc) {
  const id = doc.revisions?.current;
  const set = doc.revisions?.sets?.find((candidate) => candidate.id === id);
  if (!set) return '';
  return set.date ? `${set.name}  ${set.date}` : set.name;
}
