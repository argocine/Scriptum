/**
 * render.js — Turns paginator output into editable DOM.
 *
 * The paginator emits *lines*, but a line-per-div DOM would be miserable to
 * type in. So consecutive lines belonging to one element are regrouped into a
 * single contenteditable block whose CSS width is exactly the character width
 * the paginator used. Courier's fixed advance means the browser then breaks at
 * the same words the paginator did — the block re-wraps itself for free while
 * the writer types, and only when a page's *composition* changes does the DOM
 * need rebuilding.
 *
 * Pages outside the viewport are rendered as fixed-height shells so that a
 * feature-length script scrolls without holding thousands of nodes live.
 */

import { ElementType, SCREEN_DPI, SCREEN_CHAR_PX, SCREEN_LINE_PX } from '../core/format.js';
import { alternateStatus, hasAlternateDialogue } from '../core/alternates.js';
import { productionLookup } from '../core/production.js';

const VIRTUAL_WINDOW = 4; // pages rendered on each side of the viewport
const VIRTUAL_MIN = 12; // scripts shorter than this are never virtualized

/* ------------------------------------------------------------------ *
 * Grouping lines back into editable parts
 * ------------------------------------------------------------------ */

/**
 * @returns {Array} render items for one page:
 *   {kind:'part', elementId, charStart, charEnd, lines, first, last}
 *   {kind:'spacer', n}
 *   {kind:'synth', text, x, cls}
 *   {kind:'dualrow', left, right}
 */
function groupPageLines(page) {
  const items = [];
  let cur = null;
  let blanks = 0;

  const flushBlanks = () => {
    if (blanks > 0) {
      items.push({ kind: 'spacer', n: blanks });
      blanks = 0;
    }
  };
  const flushPart = () => {
    if (cur) {
      items.push(cur);
      cur = null;
    }
  };

  for (const line of page.lines) {
    if (line.kind === 'blank') {
      flushPart();
      blanks += 1;
      continue;
    }
    flushBlanks();

    if (line.kind === 'more' || line.kind === 'contd') {
      flushPart();
      items.push({
        kind: 'synth',
        text: line.text,
        x: line.x,
        cls: line.kind,
        elementId: line.elementId,
      });
      continue;
    }

    if (line.kind === 'dualrow') {
      flushPart();
      items.push(line);
      continue;
    }

    // kind === 'text'
    // Consecutive wrapped lines of one element belong to one editable block.
    // The test is on line index, not character offset: wrapText consumes the
    // space it broke on, so charStart is one past the previous charEnd.
    if (
      cur &&
      cur.elementId === line.elementId &&
      line.lineInElement === cur.last.lineInElement + 1
    ) {
      cur.charEnd = line.charEnd;
      cur.lines.push(line);
      cur.last = line;
    } else {
      flushPart();
      cur = {
        kind: 'part',
        elementId: line.elementId,
        type: line.type,
        charStart: line.charStart,
        charEnd: line.charEnd,
        lines: [line],
        first: line,
        last: line,
      };
    }
  }
  flushPart();
  flushBlanks();
  return items;
}

/**
 * A stable fingerprint of a page's *composition*. Deliberately excludes the
 * text itself: editing inside a block that neither splits nor reflows across
 * a page boundary leaves this unchanged, so no DOM rebuild happens at all.
 */
export function pageSignature(page) {
  const parts = groupPageLines(page);
  const bits = parts.map((it) => {
    if (it.kind === 'spacer') return `_${it.n}`;
    if (it.kind === 'synth') return `${it.cls}:${it.text}`;
    if (it.kind === 'dualrow')
      return `D${it.left?.elementId || ''}/${it.right?.elementId || ''}`;
    // Only mark offsets that indicate a split; a whole-element part uses
    // sentinels so ordinary typing does not perturb the signature.
    const s = it.charStart === 0 ? 'S' : it.charStart;
    const e = it.last.isLast ? 'E' : it.charEnd;
    return `${it.elementId}:${s}:${e}:${it.first.alternateKey || ''}`;
  });
  return `${page.number}|${bits.join('|')}`;
}

/* ------------------------------------------------------------------ *
 * Inline emphasis
 * ------------------------------------------------------------------ */

function appendStyledText(host, text, styles) {
  if (!styles || styles.length === 0) {
    host.appendChild(document.createTextNode(text));
    return;
  }
  const sorted = [...styles].sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const r of sorted) {
    if (r.start > pos) {
      host.appendChild(document.createTextNode(text.slice(pos, r.start)));
    }
    let node = document.createTextNode(text.slice(r.start, r.end));
    if (r.underline) node = wrap('u', node);
    if (r.italic) node = wrap('i', node);
    if (r.bold) node = wrap('b', node);
    host.appendChild(node);
    pos = r.end;
  }
  if (pos < text.length) host.appendChild(document.createTextNode(text.slice(pos)));
}

function appendAnnotatedText(host, text, styles, tags, registry) {
  if (!registry?.showTags || !tags?.length) {
    appendStyledText(host, text, styles);
    return;
  }
  const lookup = productionLookup(registry);
  const boundaries = new Set([0, text.length]);
  for (const tag of tags) {
    boundaries.add(Math.max(0, Math.min(text.length, tag.start)));
    boundaries.add(Math.max(0, Math.min(text.length, tag.end)));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const active = tags.filter((tag) => tag.start <= start && tag.end >= end);
    const target = active.length ? document.createElement('span') : host;
    if (active.length) {
      const details = active.flatMap((tag) => {
        const item = lookup.items.get(tag.itemId);
        const category = item ? lookup.categories.get(item.categoryId) : null;
        return item && category ? [{ item, category }] : [];
      });
      if (details.length) {
        target.className = 'production-tag';
        target.style.setProperty('--tag-color', details[0].category.color);
        target.title = details.map(({ item, category }) => `${category.name}: ${item.name}`).join('\n');
        target.dataset.tagItems = details.map(({ item }) => item.id).join(' ');
        target.setAttribute('role', 'mark');
        target.tabIndex = 0;
        target.setAttribute(
          'aria-label',
          `Production tag ${target.title.replace(/\n/g, ', ')}: ${text.slice(start, end)}`
        );
      }
    }
    appendStyledText(target, text.slice(start, end), sliceStyles(styles, start, end));
    if (target !== host) host.appendChild(target);
  }
}

function wrap(tag, node) {
  const el = document.createElement(tag);
  el.appendChild(node);
  return el;
}

/** Clip an element's style ranges to [start,end) and rebase to 0. */
function sliceStyles(styles, start, end) {
  if (!styles?.length) return [];
  const out = [];
  for (const r of styles) {
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    if (e > s) out.push({ ...r, start: s - start, end: e - start });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Building one page
 * ------------------------------------------------------------------ */

export function buildPage(page, pageIndex, doc, styles, ctx) {
  const el = document.createElement('div');
  el.className = 'page';
  el.dataset.pageIndex = String(pageIndex);
  el.dataset.pageNumber = page.number;

  const tab = document.createElement('div');
  tab.className = 'page-tab';
  tab.contentEditable = 'false';
  tab.textContent = page.isAPage ? `p. ${page.number}` : page.number;
  el.appendChild(tab);

  const showNum =
    styles.page.showPageNumbers &&
    (pageIndex > 0 || styles.page.firstPageNumbered);
  if (showNum) {
    const num = document.createElement('div');
    num.className = 'page-number';
    num.contentEditable = 'false';
    num.textContent = page.number + (styles.page.pageNumberSuffix || '');
    el.appendChild(num);
  }

  const activeRev = currentRevisionHeader(doc);
  if (activeRev) {
    const rh = document.createElement('div');
    rh.className = 'page-revision-header';
    rh.contentEditable = 'false';
    rh.textContent = activeRev;
    el.appendChild(rh);
  }

  const body = document.createElement('div');
  body.className = 'page-body';
  el.appendChild(body);

  const items = groupPageLines(page);
  const byId = ctx.elementsById;

  for (const it of items) {
    if (it.kind === 'spacer') {
      const sp = document.createElement('div');
      sp.className = 'spacer';
      sp.contentEditable = 'false';
      sp.dataset.n = String(it.n);
      sp.style.height = `${it.n * SCREEN_LINE_PX}px`;
      body.appendChild(sp);
      continue;
    }

    if (it.kind === 'synth') {
      const s = document.createElement('div');
      s.className = `synth ${it.cls}`;
      s.contentEditable = 'false';
      s.style.setProperty('--x', `${it.x * SCREEN_DPI}px`);
      s.textContent = it.text;
      body.appendChild(s);
      continue;
    }

    if (it.kind === 'dualrow') {
      const row = document.createElement('div');
      row.className = 'dual-row';
      row.contentEditable = 'false';
      for (const side of ['left', 'right']) {
        const l = it[side];
        if (!l) continue;
        const c = document.createElement('div');
        c.className = `dual-col ${side}`;
        c.style.left = `${l.x * SCREEN_DPI}px`;
        c.dataset.el = l.elementId;
        c.textContent = l.text;
        row.appendChild(c);
      }
      body.appendChild(row);
      continue;
    }

    // --- an editable element part ---
    const model = byId.get(it.elementId);
    if (!model) continue;

    const spec = styles.elements[it.type];
    const div = document.createElement('div');
    div.className = 'el';
    div.dataset.el = it.elementId;
    div.dataset.type = it.type;
    div.dataset.start = String(it.charStart);
    div.dataset.end = String(it.charEnd);
    div.dataset.whole = it.charStart === 0 && it.last.isLast ? '1' : '0';
    if (model.omitted) div.dataset.omitted = 'true';
    div.style.setProperty('--x', `${spec.left * SCREEN_DPI}px`);
    div.style.setProperty('--w', String(spec.width));
    if (spec.bold) div.style.fontWeight = '700';
    if (spec.italic) div.style.fontStyle = 'italic';
    if (spec.underline) div.style.textDecoration = 'underline';

    const text = model.text.slice(it.charStart, it.charEnd);
    appendAnnotatedText(
      div,
      text,
      sliceStyles(model.styles, it.charStart, it.charEnd),
      sliceStyles(model.tags, it.charStart, it.charEnd),
      doc.production
    );

    // Gutter marks are positioned relative to this element's own left margin.
    const offsetPx = (absoluteIn) => (absoluteIn - spec.left) * SCREEN_DPI;

    if (it.type === ElementType.SCENE_HEADING && model.sceneNumber && it.first.isFirst) {
      if (doc.sceneNumbering.showLeft) {
        div.appendChild(gutter('scene-num left', model.sceneNumber, offsetPx(ctx.sceneNumLeftIn)));
      }
      if (doc.sceneNumbering.showRight) {
        div.appendChild(gutter('scene-num right', model.sceneNumber, offsetPx(ctx.sceneNumRightIn)));
      }
    }

    const mark = it.first.revisionMark;
    if (mark) {
      div.appendChild(gutter('revision-mark', mark, offsetPx(ctx.revisionMarkIn)));
    }

    // Note flag
    if (model.notes?.length) {
      const flag = document.createElement('span');
      flag.className = 'note-flag';
      flag.contentEditable = 'false';
      flag.dataset.noteFor = model.id;
      flag.style.setProperty('--note-color', model.notes[0].color || '#f2c94c');
      flag.title = model.notes.map((n) => n.text).join('\n\n');
      div.appendChild(flag);
    }

    if (it.type === ElementType.DIALOGUE && it.first.isFirst && hasAlternateDialogue(model)) {
      div.appendChild(alternateControls(model));
    }

    body.appendChild(div);
  }

  return el;
}

function alternateControls(model) {
  const status = alternateStatus(model);
  const host = document.createElement('span');
  host.className = 'alt-controls';
  host.contentEditable = 'false';
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Alternate dialogue choices');

  const button = (action, label, text) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'alt-button';
    control.dataset.altAction = action;
    control.dataset.elementId = model.id;
    control.setAttribute('aria-label', label);
    control.title = label;
    control.textContent = text;
    return control;
  };

  host.appendChild(button('previous', 'Previous alternate dialogue', '‹'));
  const count = document.createElement('span');
  count.className = 'alt-count';
  count.textContent = `${status.position}/${status.count}`;
  count.setAttribute('aria-label', `Alternate ${status.position} of ${status.count}`);
  host.appendChild(count);
  host.appendChild(button('next', 'Next alternate dialogue', '›'));
  host.appendChild(button('add', 'Add alternate dialogue', '+'));
  host.appendChild(button('remove', 'Remove current alternate dialogue', '−'));
  return host;
}

function gutter(cls, text, leftPx) {
  const g = document.createElement('span');
  g.className = cls;
  g.contentEditable = 'false';
  g.textContent = text;
  g.style.left = `${leftPx}px`;
  return g;
}

function currentRevisionHeader(doc) {
  const id = doc.revisions?.current;
  if (!id) return '';
  const set = doc.revisions.sets.find((s) => s.id === id);
  if (!set) return '';
  return set.date ? `${set.name}  ${set.date}` : set.name;
}

/* ------------------------------------------------------------------ *
 * Title page
 * ------------------------------------------------------------------ */

export function buildTitlePage(doc) {
  const t = doc.title;
  const page = document.createElement('div');
  page.className = 'page title-page';
  page.contentEditable = 'false';
  page.dataset.titlePage = '1';

  const add = (cls, text) => {
    if (!text) return;
    const d = document.createElement('div');
    d.className = `tp-block ${cls}`;
    d.textContent = text;
    page.appendChild(d);
  };

  add('tp-title', t.title || '');
  add('tp-credit', t.credit || '');
  add('tp-author', t.author || '');
  add('tp-source', t.source || '');

  if (t.contact) {
    const c = document.createElement('div');
    c.className = 'tp-contact';
    c.textContent = t.contact;
    page.appendChild(c);
  }
  if (t.draftDate) {
    const d = document.createElement('div');
    d.className = 'tp-draft';
    d.textContent = t.draftDate;
    page.appendChild(d);
  }

  const tab = document.createElement('div');
  tab.className = 'page-tab';
  tab.textContent = 'Title';
  page.appendChild(tab);

  return page;
}

/* ------------------------------------------------------------------ *
 * The renderer
 * ------------------------------------------------------------------ */

export class Renderer {
  constructor(container, scroller) {
    this.container = container;
    this.scroller = scroller;
    this.signatures = [];
    this.pageEls = [];
    this.hasTitlePage = false;
    this.pageHeightPx = 0;
  }

  /** Push page/paper geometry into CSS custom properties. */
  applyGeometry(styles) {
    const root = document.documentElement;
    const paper = styles.paper;
    root.style.setProperty('--paper-w', `${paper.width * SCREEN_DPI}px`);
    root.style.setProperty('--paper-h', `${paper.height * SCREEN_DPI}px`);
    root.style.setProperty('--margin-t', `${styles.page.marginTop * SCREEN_DPI}px`);
    root.style.setProperty('--margin-b', `${styles.page.marginBottom * SCREEN_DPI}px`);
    root.style.setProperty('--char-w', `${SCREEN_CHAR_PX}px`);
    root.style.setProperty('--line-h', `${SCREEN_LINE_PX}px`);
    this.pageHeightPx = paper.height * SCREEN_DPI + 28; // + margin between pages
  }

  /**
   * Absolute positions, in inches from the left paper edge, for the marks that
   * live in the margins. They are stored as absolute values rather than as
   * pixel offsets because each is attached to an element whose own left margin
   * differs — a revision asterisk on dialogue starts an inch further in than
   * one on action, and subtracting the wrong margin pushes it off the paper.
   */
  gutterContext(doc, styles) {
    const rightEdge = styles.paper.width - styles.page.marginRight;
    return {
      elementsById: new Map(doc.elements.map((e) => [e.id, e])),
      sceneNumLeftIn: Math.max(0.2, styles.page.marginLeft - 1.0),
      sceneNumRightIn: rightEdge + 0.1,
      revisionMarkIn: rightEdge + 0.55,
    };
  }

  /**
   * Reconcile the DOM with a new pagination.
   * Only pages whose signature changed are rebuilt.
   */
  render(doc, pagination, styles, opts = {}) {
    this.applyGeometry(styles);
    const ctx = this.gutterContext(doc, styles);
    const pages = pagination.pages;
    const wantTitle = !!doc.title.showTitlePage;

    // Title page is cheap and rarely changes; rebuild it only when toggled or
    // when its fields changed (signalled by opts.titleDirty).
    if (wantTitle !== this.hasTitlePage || opts.titleDirty) {
      const existing = this.container.querySelector('.title-page');
      if (existing) existing.remove();
      if (wantTitle) {
        this.container.insertBefore(buildTitlePage(doc), this.container.firstChild);
      }
      this.hasTitlePage = wantTitle;
    }

    const newSigs = pages.map(pageSignature);
    const virtualize = pages.length > VIRTUAL_MIN && opts.virtualize !== false;

    // Trim surplus pages.
    let rebuilt = 0;
    while (this.pageEls.length > pages.length) {
      this.pageEls.pop().remove();
      rebuilt += 1;
    }

    for (let i = 0; i < pages.length; i += 1) {
      const sig = newSigs[i];
      const existing = this.pageEls[i];

      if (existing && this.signatures[i] === sig && existing.dataset.filled === '1') {
        continue; // untouched
      }

      const shouldFill = !virtualize || this.inWindow(i, opts.focusPage ?? this.currentPageIndex());

      if (existing && this.signatures[i] === sig && !shouldFill) continue;

      const fresh = shouldFill
        ? buildPage(pages[i], i, doc, styles, ctx)
        : this.buildShell(pages[i], i);
      fresh.dataset.filled = shouldFill ? '1' : '0';

      if (existing) {
        this.container.replaceChild(fresh, existing);
        this.pageEls[i] = fresh;
      } else {
        this.container.appendChild(fresh);
        this.pageEls[i] = fresh;
      }
      rebuilt += 1;
    }

    this.signatures = newSigs;
    this.countParts();
    // The caller uses this to decide whether the caret needs restoring: zero
    // means the DOM was left alone and the browser's own caret is still valid.
    return rebuilt;
  }

  /**
   * Remember how many editable blocks the renderer put on screen. If the count
   * ever changes without the renderer doing it, the browser has inserted or
   * removed a block behind our back and the model must be resynchronised.
   */
  countParts() {
    this.partCount = this.container.querySelectorAll('.el').length;
    return this.partCount;
  }

  buildShell(page, index) {
    const el = document.createElement('div');
    el.className = 'page virtual';
    el.contentEditable = 'false';
    el.dataset.pageIndex = String(index);
    el.dataset.pageNumber = page.number;
    const tab = document.createElement('div');
    tab.className = 'page-tab';
    tab.textContent = page.number;
    el.appendChild(tab);
    return el;
  }

  inWindow(i, focus) {
    return Math.abs(i - focus) <= VIRTUAL_WINDOW;
  }

  currentPageIndex() {
    if (!this.pageHeightPx) return 0;
    const top = this.scroller.scrollTop;
    const offset = this.hasTitlePage ? this.pageHeightPx : 0;
    return Math.max(0, Math.floor((top - offset) / this.pageHeightPx));
  }

  /** Fill/empty pages after a scroll, without touching pagination. */
  refreshWindow(doc, pagination, styles, protectIds = []) {
    if (pagination.pages.length <= VIRTUAL_MIN) return;
    const ctx = this.gutterContext(doc, styles);
    const focus = this.currentPageIndex();

    this.pageEls.forEach((el, i) => {
      const shouldFill = this.inWindow(i, focus);
      const isFilled = el.dataset.filled === '1';
      if (shouldFill === isFilled) return;
      // Never unmount a page that holds the caret.
      if (!shouldFill && protectIds.some((id) => el.querySelector(`[data-el="${id}"]`))) return;

      const fresh = shouldFill
        ? buildPage(pagination.pages[i], i, doc, styles, ctx)
        : this.buildShell(pagination.pages[i], i);
      fresh.dataset.filled = shouldFill ? '1' : '0';
      this.container.replaceChild(fresh, el);
      this.pageEls[i] = fresh;
    });
    this.countParts();
  }

  /** Force a complete rebuild (used after import, undo, style changes). */
  reset() {
    this.container.innerHTML = '';
    this.signatures = [];
    this.pageEls = [];
    this.hasTitlePage = false;
  }

  /** All DOM parts belonging to one model element, in document order. */
  partsFor(elementId) {
    return [...this.container.querySelectorAll(`.el[data-el="${cssEscape(elementId)}"]`)];
  }

  scrollToElement(elementId, behavior = 'auto') {
    const part = this.container.querySelector(`.el[data-el="${cssEscape(elementId)}"]`);
    if (!part) return false;
    const rect = part.getBoundingClientRect();
    const host = this.scroller.getBoundingClientRect();
    this.scroller.scrollTo({
      top: this.scroller.scrollTop + rect.top - host.top - host.height * 0.32,
      behavior,
    });
    return true;
  }
}

export function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
