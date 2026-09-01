/**
 * dialogs.js — Modal panels.
 *
 * One reusable shell plus a builder per panel. Every dialog reads from and
 * writes to the live document through the editor's commit path, so undo works
 * across settings changes too.
 */

import {
  ELEMENT_ORDER,
  ELEMENT_LABEL,
  PAPER,
  DEFAULT_ELEMENTS,
  DEFAULT_PAGE,
  ElementType,
  linesFromMargins,
  marginBottomFromLines,
  MIN_BOTTOM_MARGIN,
  MIN_LINES_PER_PAGE,
} from '../core/format.js';
import { getScenes } from '../core/model.js';
import { lockSceneNumbers, lockPages, unlockPages } from '../core/paginate.js';
import { REV_COLORS } from '../io/fdx.js';
import {
  sceneReport,
  characterReport,
  locationReport,
  statistics,
  toCSV,
  SCENE_COLUMNS,
  CHARACTER_COLUMNS,
  LOCATION_COLUMNS,
} from '../features/reports.js';

/* ------------------------------------------------------------------ *
 * Tiny DOM builder
 * ------------------------------------------------------------------ */

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/* ------------------------------------------------------------------ *
 * Dialog shell
 * ------------------------------------------------------------------ */

let closeCurrent = null;
let fieldCounter = 0;

export function openDialog({ title, body, buttons = [], wide = false, onClose }) {
  const overlay = document.getElementById('overlay');
  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const footEl = document.getElementById('dialog-foot');
  const appEl = document.getElementById('app');
  const previousFocus = document.activeElement;

  titleEl.textContent = title;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(body);
  footEl.innerHTML = '';
  dialog.classList.toggle('wide', wide);

  const close = () => {
    overlay.classList.add('hidden');
    appEl.inert = false;
    document.removeEventListener('keydown', onKey);
    closeCurrent = null;
    onClose?.();
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  closeCurrent = close;

  for (const b of buttons) {
    footEl.appendChild(
      h(
        'button',
        {
          class: `btn${b.primary ? ' primary' : ''}`,
          type: 'button',
          onClick: () => {
            const keepOpen = b.onClick?.();
            if (!keepOpen) close();
          },
        },
        b.label
      )
    );
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && e.metaKey) {
      const primary = buttons.find((b) => b.primary);
      if (primary) {
        const keepOpen = primary.onClick?.();
        if (!keepOpen) close();
      }
    } else if (e.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => !el.hidden && el.getClientRects().length);
      if (!focusable.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);

  appEl.inert = true;
  overlay.classList.remove('hidden');
  const firstInput = bodyEl.querySelector('input, textarea, select');
  const firstButton = footEl.querySelector('button');
  (firstInput || firstButton || dialog).focus();
  return close;
}

export function closeDialog() {
  closeCurrent?.();
}

function field(label, input, hint) {
  const isControl = input?.matches?.('input, textarea, select');
  if (isControl && !input.id) {
    fieldCounter += 1;
    input.id = `dialog-field-${fieldCounter}`;
  }
  const labelEl = isControl
    ? h('label', { for: input.id }, label)
    : h('div', { class: 'field-label' }, label);
  return h('div', { class: 'field' }, labelEl, input, hint && h('div', { class: 'hint' }, hint));
}

function textInput(value, oninput, attrs = {}) {
  return h('input', { type: 'text', value: value ?? '', ...attrs, onInput: (e) => oninput(e.target.value) });
}

function numberInput(value, oninput, attrs = {}) {
  return h('input', {
    type: 'number',
    value: String(value),
    ...attrs,
    onInput: (e) => oninput(parseFloat(e.target.value)),
  });
}

function checkbox(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', onChange: (e) => onchange(e.target.checked) });
  input.checked = !!checked;
  return h('label', { class: 'check' }, input, label);
}

/* ------------------------------------------------------------------ *
 * Title page
 * ------------------------------------------------------------------ */

export function titlePageDialog(editor) {
  const t = { ...editor.doc.title };
  const body = h(
    'div',
    {},
    field('Title', textInput(t.title, (v) => (t.title = v))),
    h(
      'div',
      { class: 'row' },
      field('Credit', textInput(t.credit, (v) => (t.credit = v)), 'e.g. "Written by", "Screenplay by"'),
      field('Author', textInput(t.author, (v) => (t.author = v)))
    ),
    field('Source', textInput(t.source, (v) => (t.source = v)), 'e.g. "Based on the novel by…"'),
    h(
      'div',
      { class: 'row' },
      field(
        'Draft / Date',
        h('textarea', { onInput: (e) => (t.draftDate = e.target.value) }, t.draftDate || ''),
        'Bottom right of the page'
      ),
      field(
        'Contact',
        h('textarea', { onInput: (e) => (t.contact = e.target.value) }, t.contact || ''),
        'Bottom left of the page'
      )
    ),
    checkbox('Include a title page in exports', t.showTitlePage, (v) => (t.showTitlePage = v))
  );

  openDialog({
    title: 'Title Page',
    body,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: () => {
          editor.commit(() => {
            editor.doc.title = t;
            return null;
          });
          editor.hardRender(null);
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Element settings
 * ------------------------------------------------------------------ */

export function elementSettingsDialog(editor) {
  const overrides = JSON.parse(JSON.stringify(editor.doc.styleOverrides || {}));

  const get = (type, key) =>
    overrides[type]?.[key] ?? DEFAULT_ELEMENTS[type][key];
  const set = (type, key, value) => {
    overrides[type] = overrides[type] || {};
    overrides[type][key] = value;
  };

  const grid = h(
    'div',
    { class: 'style-grid' },
    h('div', { class: 'hdr' }, 'Element'),
    h('div', { class: 'hdr' }, 'Left'),
    h('div', { class: 'hdr' }, 'Right'),
    h('div', { class: 'hdr' }, 'Space'),
    h('div', { class: 'hdr' }, 'Case'),
    h('div', { class: 'hdr' }, 'Align')
  );

  for (const type of ELEMENT_ORDER) {
    grid.append(
      h('div', { class: 'name' }, ELEMENT_LABEL[type]),
      numberInput(get(type, 'left'), (v) => set(type, 'left', v), { step: '0.1', min: '0.25', max: '8' }),
      numberInput(get(type, 'right'), (v) => set(type, 'right', v), { step: '0.1', min: '1', max: '8.25' }),
      numberInput(get(type, 'spaceBefore'), (v) => set(type, 'spaceBefore', v), { step: '1', min: '0', max: '4' }),
      h(
        'select',
        { onChange: (e) => set(type, 'case', e.target.value) },
        ...['none', 'upper'].map((c) =>
          h('option', { value: c, selected: get(type, 'case') === c }, c === 'none' ? 'As typed' : 'UPPER')
        )
      ),
      h(
        'select',
        { onChange: (e) => set(type, 'align', e.target.value) },
        ...['left', 'center', 'right'].map((a) =>
          h('option', { value: a, selected: get(type, 'align') === a }, a)
        )
      )
    );
  }

  const body = h(
    'div',
    {},
    h(
      'div',
      { class: 'hint', style: { marginBottom: '12px' } },
      'Positions are in inches from the left edge of the paper, matching the way ' +
        'Final Draft states them. Defaults follow standard US spec format.'
    ),
    grid
  );

  openDialog({
    title: 'Element Settings',
    body,
    wide: true,
    buttons: [
      {
        label: 'Restore Defaults',
        onClick: () => {
          editor.doc.styleOverrides = {};
          editor.refreshStyles();
        },
      },
      { label: 'Cancel' },
      {
        label: 'Apply',
        primary: true,
        onClick: () => {
          editor.doc.styleOverrides = overrides;
          editor.refreshStyles();
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Page setup
 * ------------------------------------------------------------------ */

export function pageSetupDialog(editor) {
  const p = { ...DEFAULT_PAGE, ...editor.doc.pageOverrides };
  const paperOf = () => PAPER[p.paper] || PAPER.letter;

  // The bottom margin and the line count are two descriptions of the same
  // measurement, so the dialog keeps them in step. Editing either one updates
  // the other in place, which means the number on screen is always the number
  // the printed page honours.
  let linesInput;
  let bottomInput;

  const refresh = () => {
    const paper = paperOf();
    const maxLines = linesFromMargins(paper, p.marginTop, MIN_BOTTOM_MARGIN);
    p.linesPerPage = Math.max(MIN_LINES_PER_PAGE, Math.min(Math.round(p.linesPerPage), maxLines));
    p.marginBottom = marginBottomFromLines(paper, p.marginTop, p.linesPerPage);
    if (linesInput) linesInput.value = String(p.linesPerPage);
    if (bottomInput) bottomInput.value = p.marginBottom.toFixed(2);
  };

  linesInput = numberInput(
    p.linesPerPage,
    (v) => {
      if (!Number.isFinite(v)) return;
      p.linesPerPage = v;
      refresh();
    },
    { step: '1', min: String(MIN_LINES_PER_PAGE), max: '80' }
  );

  bottomInput = numberInput(
    p.marginBottom,
    (v) => {
      if (!Number.isFinite(v)) return;
      p.linesPerPage = linesFromMargins(paperOf(), p.marginTop, v);
      refresh();
    },
    { step: '0.05', min: String(MIN_BOTTOM_MARGIN) }
  );

  const topInput = numberInput(
    p.marginTop,
    (v) => {
      if (!Number.isFinite(v)) return;
      p.marginTop = v;
      // The line count holds; the bottom margin absorbs the change.
      refresh();
    },
    { step: '0.05', min: '0.25' }
  );

  refresh();

  const body = h(
    'div',
    {},
    field(
      'Paper size',
      h(
        'select',
        {
          onChange: (e) => {
            p.paper = e.target.value;
            refresh();
          },
        },
        ...Object.values(PAPER).map((pp) =>
          h('option', { value: pp.id, selected: p.paper === pp.id }, pp.label)
        )
      )
    ),
    h(
      'div',
      { class: 'row' },
      field('Top margin (in)', topInput),
      field('Bottom margin (in)', bottomInput),
      field('Right margin (in)', numberInput(p.marginRight, (v) => (p.marginRight = v), { step: '0.05' }))
    ),
    field(
      'Lines per page',
      linesInput,
      'The industry standard is 55, which leaves a 0.83" bottom margin under a ' +
        '1" top margin. Set either field and the other follows. Changing the ' +
        'line count changes your page count, and a screenplay is judged by its ' +
        'page count, so leave it alone unless you have a reason.'
    ),
    checkbox('Show page numbers', p.showPageNumbers, (v) => (p.showPageNumbers = v)),
    checkbox('Number the first page', p.firstPageNumbered, (v) => (p.firstPageNumbered = v))
  );

  openDialog({
    title: 'Page Setup',
    body,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Apply',
        primary: true,
        onClick: () => {
          editor.doc.pageOverrides = p;
          editor.refreshStyles();
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Scene numbers
 * ------------------------------------------------------------------ */

export function sceneNumbersDialog(editor) {
  const cfg = { ...editor.doc.sceneNumbering };

  const body = h(
    'div',
    {},
    checkbox('Show scene numbers', cfg.enabled, (v) => (cfg.enabled = v)),
    checkbox('In the left margin', cfg.showLeft, (v) => (cfg.showLeft = v)),
    checkbox('In the right margin', cfg.showRight, (v) => (cfg.showRight = v)),
    field('Start numbering at', numberInput(cfg.startAt, (v) => (cfg.startAt = v || 1), { min: '1' })),
    h(
      'div',
      { class: 'hint' },
      cfg.locked
        ? 'Numbers are locked. New scenes inserted between existing ones take letter ' +
          'suffixes (12, 12A, 13) so numbers already sent out never shift.'
        : 'Once you are in production, lock the numbers from the Production menu.'
    )
  );

  openDialog({
    title: 'Scene Numbers',
    body,
    buttons: [
      cfg.locked && {
        label: 'Unlock',
        onClick: () => {
          editor.commit(() => {
            editor.doc.sceneNumbering.locked = false;
            editor.doc.elements.forEach((e) => {
              e.sceneNumberLocked = false;
            });
            return null;
          });
        },
      },
      { label: 'Cancel' },
      {
        label: 'Apply',
        primary: true,
        onClick: () => {
          editor.commit(() => {
            editor.doc.sceneNumbering = cfg;
            return null;
          });
          editor.hardRender(null);
        },
      },
    ].filter(Boolean),
  });
}

/* ------------------------------------------------------------------ *
 * Revisions
 * ------------------------------------------------------------------ */

export function revisionsDialog(editor, toast) {
  const rev = editor.doc.revisions;

  const list = h('div', {});
  const rebuild = () => {
    list.innerHTML = '';
    if (!rev.sets.length) {
      list.appendChild(
        h('div', { class: 'hint' }, 'No revision sets yet. Start one to begin marking changes.')
      );
    }
    for (const set of rev.sets) {
      const active = rev.current === set.id;
      list.appendChild(
        h(
          'div',
          { class: 'field', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h('span', {
            class: 'dot',
            style: {
              background: set.color,
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '1px solid rgba(0,0,0,.2)',
              flex: 'none',
            },
          }),
          h('div', { style: { flex: '1' } }, h('b', {}, set.name), set.date ? ` — ${set.date}` : ''),
          h(
            'button',
            {
              class: `btn${active ? ' active' : ''}`,
              onClick: () => {
                rev.current = active ? null : set.id;
                rebuild();
              },
            },
            active ? 'Marking' : 'Set current'
          ),
          h(
            'button',
            {
              class: 'btn',
              onClick: () => {
                set.active = !set.active;
                rebuild();
                editor.hardRender(null);
              },
            },
            set.active === false ? 'Show' : 'Hide'
          )
        )
      );
    }
  };
  rebuild();

  const nextColor = REV_COLORS[rev.sets.length % REV_COLORS.length];
  const draft = { name: `${nextColor.name} Revision`, color: nextColor.color, date: today() };

  const body = h(
    'div',
    {},
    list,
    h('hr', { style: { border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' } }),
    h('div', { class: 'field' }, h('label', {}, 'New revision set')),
    h(
      'div',
      { class: 'row' },
      field('Name', textInput(draft.name, (v) => (draft.name = v))),
      field('Date', textInput(draft.date, (v) => (draft.date = v)))
    ),
    field(
      'Colour',
      h(
        'div',
        { style: { display: 'flex', gap: '5px', flexWrap: 'wrap' } },
        ...REV_COLORS.map((c) => {
          const chip = h(
            'span',
            {
              class: `rev-chip${c.color === draft.color ? ' on' : ''}`,
              onClick: (e) => {
                draft.color = c.color;
                draft.name = draft.name.replace(/^\w+ Revision$/, `${c.name} Revision`);
                e.currentTarget.parentElement
                  .querySelectorAll('.rev-chip')
                  .forEach((x) => x.classList.remove('on'));
                e.currentTarget.classList.add('on');
              },
            },
            h('span', { class: 'dot', style: { background: c.color } }),
            c.name
          );
          return chip;
        })
      )
    ),
    checkbox('Show revision marks in the margin', rev.showMarks, (v) => (rev.showMarks = v))
  );

  openDialog({
    title: 'Revisions',
    body,
    wide: true,
    buttons: [
      {
        label: 'Start New Revision',
        onClick: () => {
          editor.commit(() => {
            const id = `r${rev.sets.length + 1}`;
            rev.sets.push({ ...draft, id, mark: '*', active: true });
            rev.current = id;
            return null;
          });
          toast?.(`Now marking changes as "${draft.name}".`);
        },
      },
      { label: 'Cancel' },
      {
        label: 'Done',
        primary: true,
        onClick: () => editor.hardRender(null),
      },
    ],
  });
}

function today() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export function reportsDialog(editor, { onExportCSV, onJumpToScene } = {}) {
  const doc = editor.doc;
  const pagination = editor.pagination;
  const styles = editor.styles;

  const tabs = ['Summary', 'Scenes', 'Characters', 'Locations'];
  let active = 'Summary';

  const content = h('div', {});
  const tabBar = h('div', { class: 'side-tabs', style: { padding: '0 0 12px' } });

  const draw = () => {
    content.innerHTML = '';
    tabBar.querySelectorAll('.side-tab').forEach((b) => {
      b.classList.toggle('active', b.textContent === active);
    });

    if (active === 'Summary') content.appendChild(summaryPane(doc, pagination, styles));
    else if (active === 'Scenes') {
      content.appendChild(
        table(sceneReport(doc, pagination, styles), SCENE_COLUMNS, (row) => onJumpToScene?.(row.id))
      );
    } else if (active === 'Characters') {
      content.appendChild(characterPane(characterReport(doc, pagination)));
    } else {
      content.appendChild(table(locationReport(doc, pagination), LOCATION_COLUMNS));
    }
  };

  for (const t of tabs) {
    tabBar.appendChild(
      h(
        'button',
        {
          class: `side-tab${t === active ? ' active' : ''}`,
          onClick: () => {
            active = t;
            draw();
          },
        },
        t
      )
    );
  }

  const body = h('div', {}, tabBar, content);
  draw();

  openDialog({
    title: 'Reports',
    body,
    wide: true,
    buttons: [
      {
        label: 'Export CSV',
        onClick: () => {
          const map = {
            Scenes: [sceneReport(doc, pagination, styles), SCENE_COLUMNS, 'scenes'],
            Characters: [characterReport(doc, pagination), CHARACTER_COLUMNS, 'characters'],
            Locations: [locationReport(doc, pagination), LOCATION_COLUMNS, 'locations'],
          };
          const entry = map[active];
          if (!entry) return true; // Summary has nothing tabular to export
          onExportCSV?.(toCSV(entry[0], entry[1]), entry[2]);
          return true;
        },
      },
      { label: 'Close', primary: true },
    ],
  });
}

function summaryPane(doc, pagination, styles) {
  const s = statistics(doc, pagination, styles);
  const row = (label, value) =>
    h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, String(value)));

  return h(
    'div',
    {},
    h(
      'table',
      { class: 'data' },
      h('tbody', {},
        row('Pages', s.pages),
        row('Estimated runtime', `${s.pages} min`),
        row('Scenes', s.scenes),
        row('Speaking roles', s.speakingRoles),
        row('Total words', s.words.toLocaleString()),
        row('Dialogue words', `${s.dialogueWords.toLocaleString()} (${Math.round(s.dialogueShare * 100)}%)`),
        row('Action words', s.actionWords.toLocaleString()),
        row('Average scene length', `${s.averageSceneLength} pages`),
        row('Interior / Exterior', `${s.intCount} / ${s.extCount}`),
        row('Day / Night', `${s.dayCount} / ${s.nightCount}`)
      )
    ),
    h('div', { class: 'hint', style: { marginTop: '10px' } },
      'Runtime uses the standard one-page-per-minute estimate.')
  );
}

function characterPane(rows) {
  const max = Math.max(...rows.map((r) => r.words), 1);
  const table = h(
    'table',
    { class: 'data' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...['Character', 'Speeches', 'Words', 'Scenes', 'Share', 'Pages'].map((c) => h('th', {}, c))
      )
    ),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          {},
          h('td', { class: 'mono' }, r.name),
          h('td', { class: 'num' }, String(r.cues)),
          h('td', { class: 'num' }, String(r.words)),
          h('td', { class: 'num' }, String(r.scenes)),
          h(
            'td',
            {},
            h('div', {
              class: 'bar',
              style: { width: `${Math.max(2, (r.words / max) * 100)}%` },
              title: `${Math.round(r.share * 100)}%`,
            })
          ),
          h('td', { class: 'num' }, `${r.firstPage}–${r.lastPage}`)
        )
      )
    )
  );
  return table;
}

function table(rows, columns, onRowClick) {
  return h(
    'table',
    { class: 'data' },
    h('thead', {}, h('tr', {}, ...columns.map((c) => h('th', {}, c.label)))),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          { style: onRowClick ? { cursor: 'pointer' } : {}, onClick: () => onRowClick?.(r) },
          ...columns.map((c) => {
            const v = c.get(r);
            return h('td', { class: typeof v === 'number' ? 'num' : '' }, Array.isArray(v) ? v.join(', ') : String(v ?? ''));
          })
        )
      )
    )
  );
}

/* ------------------------------------------------------------------ *
 * Notes
 * ------------------------------------------------------------------ */

export function notesDialog(editor, elementId) {
  const el = editor.doc.elements.find((e) => e.id === elementId);
  if (!el) return;
  const notes = el.notes.map((n) => ({ ...n }));

  const list = h('div', {});
  const rebuild = () => {
    list.innerHTML = '';
    notes.forEach((n, i) => {
      list.appendChild(
        h(
          'div',
          { class: 'field' },
          h('textarea', { onInput: (e) => (n.text = e.target.value) }, n.text),
          h(
            'button',
            {
              class: 'btn',
              onClick: () => {
                notes.splice(i, 1);
                rebuild();
              },
            },
            'Delete note'
          )
        )
      );
    });
    if (!notes.length) list.appendChild(h('div', { class: 'hint' }, 'No notes on this element.'));
  };
  rebuild();

  const body = h(
    'div',
    {},
    h('div', { class: 'hint', style: { marginBottom: '10px' } }, el.text.slice(0, 90) || '(empty element)'),
    list,
    h(
      'button',
      {
        class: 'btn',
        onClick: () => {
          notes.push({ id: `n${Date.now()}`, text: '', color: '#f2c94c' });
          rebuild();
        },
      },
      '+ Add note'
    )
  );

  openDialog({
    title: 'Notes',
    body,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: () => {
          editor.commit(() => {
            el.notes = notes.filter((n) => n.text.trim());
            return null;
          });
          editor.hardRender(null);
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Go to scene
 * ------------------------------------------------------------------ */

export function gotoSceneDialog(editor, onPick) {
  const scenes = getScenes(editor.doc);
  const input = h('input', { type: 'text', placeholder: 'Type to filter scenes…' });
  const list = h('div', { style: { maxHeight: '340px', overflow: 'auto' } });
  let filtered = scenes;
  let index = 0;

  const draw = () => {
    list.innerHTML = '';
    filtered.forEach((s, i) => {
      list.appendChild(
        h(
          'div',
          {
            class: `nav-scene${i === index ? ' active' : ''}`,
            onClick: () => {
              onPick(s.id);
              closeDialog();
            },
          },
          h(
            'div',
            { class: 'h' },
            h('span', { class: 'n' }, s.sceneNumber || String(s.index + 1)),
            h('span', { class: 't' }, s.heading || '(no heading)')
          )
        )
      );
    });
    if (!filtered.length) list.appendChild(h('div', { class: 'hint' }, 'No matching scenes.'));
  };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = q
      ? scenes.filter(
          (s) =>
            s.heading.toLowerCase().includes(q) ||
            String(s.sceneNumber || s.index + 1).toLowerCase() === q
        )
      : scenes;
    index = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(index + 1, filtered.length - 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(index - 1, 0);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[index]) {
        onPick(filtered[index].id);
        closeDialog();
      }
    }
  });

  draw();
  openDialog({
    title: 'Go to Scene',
    body: h('div', {}, h('div', { class: 'field' }, input), list),
    buttons: [{ label: 'Close', primary: true }],
  });
}

/* ------------------------------------------------------------------ *
 * Page locking
 * ------------------------------------------------------------------ */

export function pageLockDialog(editor, lock, toast) {
  if (!lock) {
    editor.commit(() => {
      unlockPages(editor.doc);
      return null;
    });
    toast?.('Pages unlocked. Page numbers will renumber freely.');
    editor.hardRender(null);
    return;
  }

  editor.commit(() => {
    lockPages(editor.doc, editor.pagination);
    return null;
  });
  toast?.(
    `Pages locked at ${editor.pagination.totalPages}. New material will produce A-pages.`
  );
  editor.hardRender(null);
}

export function lockScenesAction(editor, toast) {
  editor.commit(() => {
    editor.doc.sceneNumbering.enabled = true;
    lockSceneNumbers(editor.doc);
    return null;
  });
  toast?.('Scene numbers locked. New scenes will take letter suffixes.');
  editor.hardRender(null);
}

/* ------------------------------------------------------------------ *
 * Keyboard shortcuts
 * ------------------------------------------------------------------ */

export function shortcutsDialog() {
  const groups = [
    [
      'Writing',
      [
        ['Enter', 'New element of the natural next type'],
        ['Tab', 'Cycle element type — or add a parenthetical after a cue'],
        ['Shift-Tab', 'Cycle backwards'],
        ['Backspace at start', 'Merge into the element above'],
        ['⌘1 – ⌘9', 'Set element type directly'],
      ],
    ],
    [
      'Format',
      [
        ['⌘B / ⌘I / ⌘U', 'Bold, italic, underline'],
        ['⌘⌥D', 'Toggle dual dialogue'],
      ],
    ],
    [
      'Navigate',
      [
        ['⌘F', 'Find and replace'],
        ['⌘G / ⌘⇧G', 'Find next / previous'],
        ['⌘J', 'Go to scene'],
        ['⌘\\', 'Toggle sidebar'],
        ['⌘⇧B', 'Index cards'],
        ['⌘R', 'Reports'],
      ],
    ],
    [
      'File',
      [
        ['⌘S', 'Save'],
        ['⌘P', 'Export PDF'],
        ['⌘O', 'Open'],
        ['⌘Z / ⌘⇧Z', 'Undo / redo'],
      ],
    ],
  ];

  const body = h(
    'div',
    {},
    ...groups.map(([name, rows]) =>
      h(
        'div',
        { style: { marginBottom: '16px' } },
        h('label', { style: { fontWeight: '600', color: 'var(--muted)', fontSize: '11.5px' } }, name),
        h(
          'table',
          { class: 'data' },
          h(
            'tbody',
            {},
            ...rows.map(([k, d]) =>
              h('tr', {}, h('td', { class: 'mono', style: { width: '150px' } }, k), h('td', {}, d))
            )
          )
        )
      )
    )
  );

  openDialog({ title: 'Keyboard Shortcuts', body, buttons: [{ label: 'Close', primary: true }] });
}
