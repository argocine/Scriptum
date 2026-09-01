/**
 * format.js — Industry-standard screenplay geometry.
 *
 * Everything in this file is expressed in *character* and *line* units rather
 * than pixels. Courier 12pt is metrically fixed at 10 characters per inch and
 * 6 lines per inch, so a screenplay's layout is fully determined by integer
 * arithmetic. Pagination never measures the DOM; it counts characters. That is
 * what makes the on-screen page count identical to the exported PDF's.
 */

export const CPI = 10; // Courier 12pt: characters per inch
export const LPI = 6; // lines per inch (12pt single-spaced)
export const PT_PER_INCH = 72;

export const ElementType = {
  SCENE_HEADING: 'scene_heading',
  ACTION: 'action',
  CHARACTER: 'character',
  PARENTHETICAL: 'parenthetical',
  DIALOGUE: 'dialogue',
  TRANSITION: 'transition',
  SHOT: 'shot',
  GENERAL: 'general',
  ACT_BREAK: 'act_break',
};

export const ELEMENT_ORDER = [
  ElementType.SCENE_HEADING,
  ElementType.ACTION,
  ElementType.CHARACTER,
  ElementType.PARENTHETICAL,
  ElementType.DIALOGUE,
  ElementType.TRANSITION,
  ElementType.SHOT,
  ElementType.GENERAL,
  ElementType.ACT_BREAK,
];

export const ELEMENT_LABEL = {
  [ElementType.SCENE_HEADING]: 'Scene Heading',
  [ElementType.ACTION]: 'Action',
  [ElementType.CHARACTER]: 'Character',
  [ElementType.PARENTHETICAL]: 'Parenthetical',
  [ElementType.DIALOGUE]: 'Dialogue',
  [ElementType.TRANSITION]: 'Transition',
  [ElementType.SHOT]: 'Shot',
  [ElementType.GENERAL]: 'General',
  [ElementType.ACT_BREAK]: 'Act Break',
};

/* ------------------------------------------------------------------ *
 * Paper
 * ------------------------------------------------------------------ */

export const PAPER = {
  letter: { id: 'letter', label: 'US Letter', width: 8.5, height: 11 },
  a4: { id: 'a4', label: 'A4', width: 8.27, height: 11.69 },
};

/**
 * Default page setup, holding the canonical 55 lines per page.
 *
 * Note that 55 lines and a 1" margin at both ends do not both fit on an 11"
 * page: 55 lines at six to the inch occupy 9.17", which leaves 0.83" once the
 * top inch is taken. The line count wins, because that is what a screenplay is
 * measured in, and the bottom margin is reported as the 0.83" it really is.
 */
export const DEFAULT_PAGE = {
  paper: 'letter',
  marginTop: 1.0,
  /**
   * Derived, never an input. `resolveStyles` always recomputes this from
   * `linesPerPage`, so the value stored here is only the shape of the field.
   * The default line count leaves 0.83", which is what 55 lines at six to the
   * inch actually leave under a 1" top margin.
   */
  marginBottom: 0.833,
  marginLeft: 1.5,
  marginRight: 1.0,
  /**
   * The authority for how much text a page holds. A screenplay's page count is
   * its unit of measure, so the line count is fixed and the bottom margin is
   * whatever those lines leave. Deriving it the other way round would make the
   * page count depend on paper size, and a script on A4 would no longer time
   * the same as the identical script on US Letter.
   */
  linesPerPage: 55,
  pageNumberTop: 0.5, // distance from paper top edge to the page-number baseline
  showPageNumbers: true,
  firstPageNumbered: false,
  pageNumberSuffix: '.', // "12." is the industry convention
};

/* ------------------------------------------------------------------ *
 * Element geometry
 *
 * `left` and `right` are measured in inches from the LEFT EDGE OF THE PAPER,
 * which is how Final Draft's Element Settings dialog expresses them. Widths in
 * characters are derived, so changing the paper or margins keeps everything
 * consistent.
 * ------------------------------------------------------------------ */

export const DEFAULT_ELEMENTS = {
  [ElementType.SCENE_HEADING]: {
    left: 1.5,
    right: 7.5,
    spaceBefore: 2,
    align: 'left',
    case: 'upper',
    bold: false,
    italic: false,
    underline: false,
    startsNewPage: false,
    keepWithNext: 2, // require N lines of the following element on this page
  },
  [ElementType.ACTION]: {
    left: 1.5,
    right: 7.5,
    spaceBefore: 1,
    align: 'left',
    case: 'none',
    bold: false,
    italic: false,
    underline: false,
    minLinesBeforeBreak: 2,
    minLinesAfterBreak: 2,
  },
  [ElementType.CHARACTER]: {
    left: 3.7,
    right: 7.5,
    spaceBefore: 1,
    align: 'left',
    case: 'upper',
    bold: false,
    italic: false,
    underline: false,
    keepWithNext: 2,
  },
  [ElementType.PARENTHETICAL]: {
    left: 3.1,
    right: 6.1,
    spaceBefore: 0,
    align: 'left',
    case: 'lower',
    bold: false,
    italic: false,
    underline: false,
    keepWithNext: 1,
  },
  [ElementType.DIALOGUE]: {
    left: 2.5,
    right: 6.5,
    spaceBefore: 0,
    align: 'left',
    case: 'none',
    bold: false,
    italic: false,
    underline: false,
    minLinesBeforeBreak: 2,
    minLinesAfterBreak: 2,
  },
  [ElementType.TRANSITION]: {
    left: 1.5,
    right: 7.5,
    spaceBefore: 1,
    align: 'right',
    case: 'upper',
    bold: false,
    italic: false,
    underline: false,
  },
  [ElementType.SHOT]: {
    left: 1.5,
    right: 7.5,
    spaceBefore: 1,
    align: 'left',
    case: 'upper',
    bold: false,
    italic: false,
    underline: false,
    keepWithNext: 2,
  },
  [ElementType.GENERAL]: {
    left: 1.5,
    right: 7.5,
    spaceBefore: 1,
    align: 'left',
    case: 'none',
    bold: false,
    italic: false,
    underline: false,
  },
  [ElementType.ACT_BREAK]: {
    left: 1.5,
    right: 7.5,
    spaceBefore: 2,
    spaceAfter: 2,
    align: 'center',
    case: 'upper',
    bold: false,
    italic: false,
    underline: true,
  },
};

/* Dual dialogue occupies two columns inside the normal dialogue block. */
export const DUAL = {
  leftLeft: 1.6,
  leftRight: 4.3,
  rightLeft: 4.7,
  rightRight: 7.4,
  characterInset: 0.9, // character cue indent within its column
};

/* ------------------------------------------------------------------ *
 * Derived helpers
 * ------------------------------------------------------------------ */

/** Characters that fit between two inch positions. */
export function charsBetween(left, right) {
  return Math.max(1, Math.floor((right - left) * CPI + 1e-6));
}

/** Body lines available on a page, excluding the page-number line. */
export function bodyLines(page) {
  return page.linesPerPage;
}

/** How many whole lines fit between the top and bottom margins. */
export function linesFromMargins(paper, marginTop, marginBottom) {
  const inches = paper.height - marginTop - marginBottom;
  // The epsilon absorbs binary rounding so that a bottom margin produced by
  // marginBottomFromLines converts straight back to the line count it came
  // from, instead of losing a line to 54.9999999.
  return Math.max(1, Math.floor(inches * LPI + 1e-6));
}

/**
 * The bottom margin that a given number of lines leaves on the page.
 *
 * Rounds down, never up. A line count like 41 leaves 3.1666..." and rounding
 * that to 3.167 would overstate the margin just enough for linesFromMargins to
 * report 40, so the two functions would disagree about the page they describe.
 */
export function marginBottomFromLines(paper, marginTop, linesPerPage) {
  const inches = paper.height - marginTop - linesPerPage / LPI;
  // The epsilon is binary noise only, a billionth of an inch: without it an
  // exact 0.25 arrives as 0.2499999999 and floors to 0.249.
  return Math.floor(inches * 1000 + 1e-6) / 1000;
}

/**
 * Resolve a full, validated stylesheet from (possibly partial) user settings.
 * Every consumer — paginator, renderer, PDF writer — reads geometry through
 * this so a preference change propagates everywhere at once.
 */
export function resolveStyles(userElements = {}, userPage = {}) {
  const page = { ...DEFAULT_PAGE, ...userPage };
  const paper = PAPER[page.paper] || PAPER.letter;
  const elements = {};

  // Reconcile the page box with the line count. Before this, the bottom margin
  // was stored but never consulted: pagination read only `linesPerPage`, so
  // Page Setup could report a 1" bottom margin while the page actually left
  // 0.83". Deriving it here means the reported number is the printed one.
  // Bound the top margin so that a usable number of lines always survives.
  // Clamping the line count instead would let an absurd top margin quietly
  // produce a seven-line page.
  const maxTop = paper.height - MIN_BOTTOM_MARGIN - MIN_LINES_PER_PAGE / LPI;
  page.marginTop = clampNumber(page.marginTop, 0.25, maxTop, DEFAULT_PAGE.marginTop);
  const maxLines = linesFromMargins(paper, page.marginTop, MIN_BOTTOM_MARGIN);
  page.linesPerPage = clampNumber(
    Math.round(Number(page.linesPerPage)),
    MIN_LINES_PER_PAGE,
    maxLines,
    DEFAULT_PAGE.linesPerPage
  );
  page.marginBottom = marginBottomFromLines(paper, page.marginTop, page.linesPerPage);

  for (const type of ELEMENT_ORDER) {
    const base = DEFAULT_ELEMENTS[type];
    const over = userElements[type] || {};
    const spec = { ...base, ...over };

    // Clamp to the printable area so a bad preference can never push text off
    // the page.
    spec.left = clampNumber(spec.left, 0.25, paper.width - 0.5, base.left);
    spec.right = clampNumber(spec.right, spec.left + 0.5, paper.width - 0.25, base.right);
    spec.width = charsBetween(spec.left, spec.right);
    elements[type] = spec;
  }

  return { page, paper, elements };
}

/** The least bottom margin a printer can be relied on to honour. */
export const MIN_BOTTOM_MARGIN = 0.25;

/** Below this a page stops being a page. Bounds the top margin, not the text. */
export const MIN_LINES_PER_PAGE = 10;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function clampNumber(value, lo, hi, fallback) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : fallback, lo, hi);
}

/** Apply an element's case rule to text for display and print. */
export function applyCase(text, spec) {
  if (spec.case === 'upper') return text.toUpperCase();
  return text;
}

/* ------------------------------------------------------------------ *
 * Unit conversion for the DOM renderer
 * ------------------------------------------------------------------ */

/** On-screen pixels per inch at 100% zoom. 96 keeps CSS math clean. */
export const SCREEN_DPI = 96;

export function inchesToPx(inches) {
  return inches * SCREEN_DPI;
}

/** Courier 12pt on screen: 12pt at 96dpi = 16px, advance width = 9.6px. */
export const SCREEN_FONT_PX = (12 / PT_PER_INCH) * SCREEN_DPI; // 16
export const SCREEN_CHAR_PX = SCREEN_DPI / CPI; // 9.6
export const SCREEN_LINE_PX = SCREEN_DPI / LPI; // 16
