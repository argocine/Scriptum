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
  breakdownReport,
  BREAKDOWN_COLUMNS,
} from '../features/reports.js';
import { auditDocument } from '../features/format-assistant.js';
import {
  MAX_SPRINT_MINUTES,
  MAX_SPRINT_WORD_TARGET,
  MIN_SPRINT_MINUTES,
} from '../features/sprint.js';
import {
  TableReadController,
  buildTableReadSegments,
  localSpeechVoices,
  tableReadSpeakers,
  voiceKey,
} from '../features/table-read.js';
import {
  addProductionCategory,
  applyProductionTag,
  ensureProductionItem,
  removeProductionTags,
} from '../core/production.js';
import {
  MAX_SNAPSHOTS,
  compareSnapshotToDocument,
  createRevisionSnapshot,
  deleteRevisionSnapshot,
  restoreRevisionSnapshot,
  revisionChangeReportText,
} from '../features/snapshots.js';
import {
  MAX_STORY_BEATS,
  MAX_STORY_LANES,
  MAX_STORY_SECTIONS,
  addStoryBeat,
  addStoryLane,
  addStorySection,
  deleteStoryEntry,
  updateStoryEntry,
} from '../features/story.js';

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
  // One modal shell serves the whole application. Close the current owner
  // before replacing its DOM so feature-specific cleanup (speech, timers,
  // listeners) can never become unreachable behind a newer dialog.
  closeCurrent?.();
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
    if (closeCurrent && closeCurrent !== close) return;
    overlay.classList.add('hidden');
    appEl.inert = false;
    document.removeEventListener('keydown', onKey);
    if (closeCurrent === close) closeCurrent = null;
    onClose?.();
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus();
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
            if (!keepOpen && closeCurrent === close) close();
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
 * Revision Room snapshots
 * ------------------------------------------------------------------ */

export function revisionRoomDialog(
  editor,
  { confirm, normalizeState, onExportReport, onGoTo, toast } = {}
) {
  let selectedId = editor.doc.revisionRoom.snapshots.at(-1)?.id || null;
  let comparison = null;
  const nameInput = h('input', {
    type: 'text',
    maxlength: '120',
    value: `Snapshot ${editor.doc.revisionRoom.snapshots.length + 1}`,
  });
  const noteInput = h('textarea', { maxlength: '2000', rows: '2', placeholder: 'Optional note' });
  const list = h('div', { class: 'snapshot-list' });
  const results = h('div', {
    class: 'snapshot-results',
    role: 'region',
    'aria-label': 'Snapshot comparison results',
  });
  const resultStatus = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const counter = h('div', { class: 'hint' });

  const selectedSnapshot = () =>
    editor.doc.revisionRoom.snapshots.find((snapshot) => snapshot.id === selectedId) || null;

  const drawResults = () => {
    results.innerHTML = '';
    if (!comparison) {
      resultStatus.textContent = 'No snapshot comparison is open.';
      results.appendChild(
        h('div', { class: 'side-empty' }, 'Choose a snapshot and compare it with the screenplay on screen.')
      );
      return;
    }
    const c = comparison;
    resultStatus.textContent =
      `Comparison ready: ${c.counts.added} added, ${c.counts.removed} removed, ` +
      `${c.counts.changed} changed, and ${c.counts.moved} moved.`;
    results.appendChild(
      h(
        'div',
        { class: 'snapshot-summary' },
        h('span', {}, `${c.counts.added} added`),
        h('span', {}, `${c.counts.removed} removed`),
        h('span', {}, `${c.counts.changed} changed`),
        h('span', {}, `${c.counts.moved} moved`)
      )
    );
    if (c.documentChanges.length) {
      results.appendChild(
        h('p', { class: 'hint' }, `Document settings changed: ${c.documentChanges.join(', ')}`)
      );
    }
    if (!c.changes.length) {
      results.appendChild(h('div', { class: 'side-empty' }, 'No screenplay-element differences.'));
      return;
    }
    const rows = h('div', { class: 'snapshot-changes' });
    for (const entry of c.changes) {
      const targetId = editor.doc.elements.some((element) => element.id === entry.elementId)
        ? entry.elementId
        : null;
      const row = h(
        targetId ? 'button' : 'div',
        targetId
          ? { type: 'button', class: 'snapshot-change', onClick: () => onGoTo?.(targetId) }
          : { class: 'snapshot-change' },
        h('span', { class: `snapshot-kind ${entry.kind}` }, entry.kind),
        h(
          'span',
          { class: 'snapshot-copy' },
          h('b', {}, entry.afterScene || entry.beforeScene || 'Before first scene'),
          h('span', {}, (entry.afterText || entry.beforeText || '(empty)').slice(0, 160)),
          entry.fields?.length ? h('small', {}, entry.fields.join(', ')) : null
        )
      );
      rows.appendChild(row);
    }
    results.appendChild(rows);
  };

  const rebuild = () => {
    const snapshots = editor.doc.revisionRoom.snapshots;
    counter.textContent = `${snapshots.length} of ${MAX_SNAPSHOTS} snapshots. They are stored locally in the screenplay and recovery data, and never uploaded by Scriptum.`;
    list.innerHTML = '';
    if (!snapshots.length) {
      list.appendChild(h('div', { class: 'side-empty' }, 'No snapshots yet. Make one before a rewrite or major cut.'));
    }
    for (const snapshot of [...snapshots].reverse()) {
      list.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: `snapshot-row${snapshot.id === selectedId ? ' active' : ''}`,
            'aria-pressed': String(snapshot.id === selectedId),
            onClick: () => {
              selectedId = snapshot.id;
              comparison = null;
              rebuild();
              drawResults();
              list.querySelector('.snapshot-row.active')?.focus();
            },
          },
          h('b', {}, snapshot.name),
          h('span', {}, new Date(snapshot.created).toLocaleString()),
          snapshot.note ? h('small', {}, snapshot.note) : null,
          h('small', {}, `${snapshot.state.elements?.length || 0} elements`)
        )
      );
    }
  };

  const controls = h(
    'div',
    { class: 'snapshot-controls' },
    h(
      'button',
      {
        type: 'button',
        class: 'btn primary',
        onClick: () => {
          if (editor.doc.revisionRoom.snapshots.length >= MAX_SNAPSHOTS) {
            toast?.(`Delete a snapshot before adding another; the limit is ${MAX_SNAPSHOTS}.`);
            return;
          }
          let result;
          editor.commit(() => {
            result = createRevisionSnapshot(editor.doc, {
              name: nameInput.value,
              note: noteInput.value,
            });
            return null;
          });
          if (!result?.ok) {
            toast?.(result?.reason || 'Could not create that snapshot.');
            return;
          }
          selectedId = result.snapshot.id;
          comparison = null;
          nameInput.value = `Snapshot ${editor.doc.revisionRoom.snapshots.length + 1}`;
          noteInput.value = '';
          rebuild();
          drawResults();
          list.querySelector('.snapshot-row.active')?.focus();
          toast?.(`Saved “${result.snapshot.name}”.`);
        },
      },
      'Make Snapshot'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onClick: () => {
          const snapshot = selectedSnapshot();
          if (!snapshot) return toast?.('Choose a snapshot first.');
          comparison = compareSnapshotToDocument(snapshot, editor.doc);
          drawResults();
        },
      },
      'Compare to Current'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onClick: () => {
          const snapshot = selectedSnapshot();
          if (!snapshot || !comparison) return toast?.('Compare a snapshot before exporting its report.');
          onExportReport?.(revisionChangeReportText(comparison, snapshot.name), snapshot.name);
        },
      },
      'Export Report'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onClick: async () => {
          const snapshot = selectedSnapshot();
          if (!snapshot) return toast?.('Choose a snapshot first.');
          if (editor.doc.revisionRoom.snapshots.length >= MAX_SNAPSHOTS) {
            return toast?.('Delete one snapshot first so Scriptum can make a safety copy before restoring.');
          }
          const choice = await confirm?.({
            message: `Restore “${snapshot.name}”?`,
            detail: 'Scriptum will first make an automatic safety snapshot of the screenplay on screen.',
            buttons: ['Restore Snapshot', 'Cancel'],
            defaultId: 1,
          });
          if (choice !== 0) return;
          let result;
          editor.commit(() => {
            result = restoreRevisionSnapshot(editor.doc, snapshot.id, { normalizeState });
            return null;
          }, { rebuildVocab: true });
          if (!result?.ok) return toast?.(result?.reason || 'Could not restore that snapshot.');
          editor.hardRender(null);
          comparison = null;
          selectedId = snapshot.id;
          rebuild();
          drawResults();
          toast?.(`Restored “${snapshot.name}”; a safety snapshot was saved.`);
        },
      },
      'Restore'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn danger',
        onClick: async () => {
          const snapshot = selectedSnapshot();
          if (!snapshot) return toast?.('Choose a snapshot first.');
          const choice = await confirm?.({
            message: `Delete “${snapshot.name}”?`,
            detail: 'This removes only the saved checkpoint, not the screenplay on screen.',
            buttons: ['Delete Snapshot', 'Cancel'],
            defaultId: 1,
          });
          if (choice !== 0) return;
          editor.commit(() => {
            deleteRevisionSnapshot(editor.doc, snapshot.id);
            return null;
          });
          selectedId = editor.doc.revisionRoom.snapshots.at(-1)?.id || null;
          comparison = null;
          rebuild();
          drawResults();
        },
      },
      'Delete'
    )
  );

  const body = h(
    'div',
    { class: 'revision-room' },
    h(
      'div',
      { class: 'snapshot-create' },
      field('Snapshot name', nameInput),
      field('Note', noteInput),
      controls,
      counter
    ),
    resultStatus,
    h('div', { class: 'snapshot-columns' }, list, results)
  );
  rebuild();
  drawResults();
  openDialog({
    title: 'Revision Room',
    body,
    wide: true,
    buttons: [{ label: 'Close', primary: true }],
  });
}

/* ------------------------------------------------------------------ *
 * Story Timeline editors
 * ------------------------------------------------------------------ */

export function storyEntryDialog(
  editor,
  kind,
  { entryId = null, confirm, onChange, onFocus, toast } = {}
) {
  const story = editor.doc.story;
  const collection = kind === 'lane' ? 'lanes' : kind === 'beat' ? 'beats' : 'sections';
  const existing = story[collection].find((entry) => entry.id === entryId) || null;
  let focusId = existing?.id || null;
  const scenes = getScenes(editor.doc);
  const current = editor.currentElement();
  const currentScene = current
    ? scenes.find((scene) => scene.elements.some((element) => element.id === current.id))
    : null;

  const draft = existing
    ? { ...existing }
    : kind === 'lane'
      ? { name: `Story Lane ${story.lanes.length + 1}`, color: '#5b8dff' }
      : kind === 'beat'
        ? {
            title: `Beat ${story.beats.length + 1}`,
            description: '',
            sceneId: currentScene?.id || null,
            laneId: story.lanes[0]?.id || null,
            color: '#e6c25a',
          }
        : {
            kind: kind === 'sequence' ? 'sequence' : 'act',
            name: kind === 'sequence' ? 'Sequence' : `Act ${story.sections.filter((s) => s.kind === 'act').length + 1}`,
            startSceneId: currentScene?.id || scenes[0]?.id || null,
            color: kind === 'sequence' ? '#8c75d6' : '#e06a80',
          };

  const sceneSelect = (value, onChange) =>
    h(
      'select',
      { onChange: (event) => onChange(event.target.value || null) },
      h('option', { value: '', selected: !value }, 'Unplaced'),
      ...scenes.map((scene) =>
        h(
          'option',
          { value: scene.id, selected: value === scene.id },
          `${scene.sceneNumber || scene.index + 1}. ${scene.heading || '(untitled scene)'}`
        )
      )
    );

  let body;
  let title;
  if (kind === 'lane') {
    title = existing ? 'Edit Story Lane' : 'Add Story Lane';
    body = h(
      'div',
      {},
      field('Name', textInput(draft.name, (value) => (draft.name = value), { maxlength: '120' })),
      field(
        'Colour',
        h('input', { type: 'color', value: draft.color, onInput: (event) => (draft.color = event.target.value) })
      ),
      existing && story.lanes.length === 1
        ? h('p', { class: 'hint' }, 'Every story map keeps at least one lane.')
        : null
    );
  } else if (kind === 'beat') {
    title = existing ? 'Edit Story Beat' : 'Add Story Beat';
    const laneSelect = h(
      'select',
      { onChange: (event) => (draft.laneId = event.target.value || null) },
      h('option', { value: '', selected: !draft.laneId }, 'Unassigned lane'),
      ...story.lanes.map((lane) =>
        h('option', { value: lane.id, selected: draft.laneId === lane.id }, lane.name)
      )
    );
    body = h(
      'div',
      {},
      field('Beat', textInput(draft.title, (value) => (draft.title = value), { maxlength: '160' })),
      field(
        'Description',
        h('textarea', { maxlength: '4000', rows: '5', onInput: (event) => (draft.description = event.target.value) }, draft.description || '')
      ),
      h(
        'div',
        { class: 'row' },
        field('Scene', sceneSelect(draft.sceneId, (value) => (draft.sceneId = value))),
        field('Lane', laneSelect),
        field(
          'Colour',
          h('input', { type: 'color', value: draft.color, onInput: (event) => (draft.color = event.target.value) })
        )
      )
    );
  } else {
    title = existing ? 'Edit Story Section' : `Add ${draft.kind === 'sequence' ? 'Sequence' : 'Act'}`;
    const kindSelect = h(
      'select',
      { onChange: (event) => (draft.kind = event.target.value) },
      h('option', { value: 'act', selected: draft.kind === 'act' }, 'Act'),
      h('option', { value: 'sequence', selected: draft.kind === 'sequence' }, 'Sequence')
    );
    body = h(
      'div',
      {},
      field('Name', textInput(draft.name, (value) => (draft.name = value), { maxlength: '120' })),
      h(
        'div',
        { class: 'row' },
        field('Kind', kindSelect),
        field('Begins at', sceneSelect(draft.startSceneId, (value) => (draft.startSceneId = value))),
        field(
          'Colour',
          h('input', { type: 'color', value: draft.color, onInput: (event) => (draft.color = event.target.value) })
        )
      )
    );
  }

  openDialog({
    title,
    body,
    wide: kind === 'beat',
    buttons: [
      existing && {
        label: 'Delete',
        onClick: () => {
          if (kind === 'lane' && story.lanes.length === 1) {
            toast?.('Every story map keeps at least one lane.');
            return true;
          }
          (async () => {
            const choice = await confirm?.({
              message: `Delete “${existing.name || existing.title}”?`,
              detail: kind === 'lane'
                ? 'Beats on this lane will move to Unassigned.'
                : 'This removes only the story-map entry, not screenplay text.',
              buttons: ['Delete', 'Cancel'],
              defaultId: 1,
            });
            if (choice !== 0) return;
            editor.commit(() => {
              deleteStoryEntry(story, collection, existing.id);
              return null;
            });
            focusId = null;
            onChange?.();
            closeDialog();
          })();
          return true;
        },
      },
      { label: 'Cancel' },
      {
        label: existing ? 'Save' : 'Add',
        primary: true,
        onClick: () => {
          const atLimit =
            !existing &&
            ((kind === 'lane' && story.lanes.length >= MAX_STORY_LANES) ||
              (kind === 'beat' && story.beats.length >= MAX_STORY_BEATS) ||
              ((kind === 'act' || kind === 'sequence') &&
                story.sections.length >= MAX_STORY_SECTIONS));
          if (atLimit) {
            toast?.('The story map has reached its entry limit.');
            return true;
          }
          let result = true;
          editor.commit(() => {
            if (existing) result = updateStoryEntry(story, collection, existing.id, draft);
            else if (kind === 'lane') result = addStoryLane(story, draft);
            else if (kind === 'beat') result = addStoryBeat(story, draft);
            else result = addStorySection(story, draft);
            return null;
          });
          if (!result) {
            toast?.('The story map has reached its entry limit.');
            return true;
          }
          focusId = result?.id || existing?.id || null;
          onChange?.();
        },
      },
    ].filter(Boolean),
    onClose: () => onFocus?.(focusId),
  });
}

/* ------------------------------------------------------------------ *
 * Format Assistant
 * ------------------------------------------------------------------ */

export function formatAssistantDialog(editor, { onGoTo } = {}) {
  const issues = auditDocument(editor.doc, editor.pagination);
  const counts = { error: 0, warning: 0, info: 0 };
  issues.forEach((issue) => {
    counts[issue.severity] += 1;
  });

  const summary = issues.length
    ? `${issues.length} ${issues.length === 1 ? 'item' : 'items'} found: ` +
      `${counts.error} errors, ${counts.warning} warnings, ${counts.info} information.`
    : 'No structural or PDF compatibility problems found.';

  const body = h(
    'div',
    {},
    h('p', { class: 'format-summary', role: 'status', 'aria-live': 'polite' }, summary),
    h(
      'p',
      { class: 'hint' },
      'Format Assistant checks document structure and PDF character support. It does not judge spelling, grammar, or writing style.'
    )
  );

  if (!issues.length) {
    body.appendChild(h('div', { class: 'format-empty' }, 'Your screenplay passed every check.'));
  } else {
    const list = h('div', { class: 'format-issues', role: 'list', 'aria-label': 'Format issues' });
    for (const issue of issues) {
      const location = [
        issue.page ? `Page ${issue.page}` : null,
        issue.field?.startsWith('title.') ? 'Title page' : null,
        issue.field?.startsWith('revisions.') ? 'Revision settings' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const row = h(
        'div',
        { class: `format-issue ${issue.severity}`, role: 'listitem' },
        h(
          'div',
          { class: 'format-issue-copy' },
          h('div', { class: 'format-issue-level' }, issue.severity),
          h('div', { class: 'format-issue-message' }, issue.message),
          location ? h('div', { class: 'format-issue-location' }, location) : null
        )
      );
      if (issue.elementId || issue.field) {
        row.appendChild(
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              'aria-label': `Go to: ${issue.message}`,
              onClick: () => {
                closeDialog();
                onGoTo?.(issue);
              },
            },
            'Go To'
          )
        );
      }
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  openDialog({
    title: 'Format Assistant',
    body,
    wide: true,
    buttons: [{ label: 'Close', primary: true }],
  });

  return issues;
}

/* ------------------------------------------------------------------ *
 * Production tags
 * ------------------------------------------------------------------ */

export function productionTagDialog(editor, { toast } = {}) {
  const selection = editor.getSelection();
  if (!selection || selection.collapsed) {
    editor.emit({ viewOnly: true, notice: 'Select screenplay text before applying a production tag.' });
    return false;
  }
  const selectedElements = editor.doc.elements.slice(selection.startIndex, selection.endIndex + 1);
  const touchesAlternates = selectedElements.some((element) => element.alternateDialogue);

  const registry = JSON.parse(JSON.stringify(editor.doc.production));
  let categoryId = registry.categories[0]?.id || '';
  let itemId = '';
  let itemName = '';

  const categorySelect = h('select', { 'aria-label': 'Production category' });
  const itemSelect = h('select', { 'aria-label': 'Existing breakdown item' });
  const itemInput = textInput('', (value) => {
    itemName = value;
    if (value.trim()) {
      itemId = '';
      itemSelect.value = '';
    }
  }, {
    placeholder: 'Or name a new item…',
    maxlength: '120',
  });
  const showTags = h('input', { type: 'checkbox' });
  showTags.checked = registry.showTags;

  const refreshCategories = () => {
    categorySelect.innerHTML = '';
    for (const category of registry.categories) {
      categorySelect.appendChild(
        h('option', { value: category.id, selected: category.id === categoryId }, category.name)
      );
    }
  };
  const refreshItems = () => {
    const items = registry.items.filter((item) => item.categoryId === categoryId);
    itemSelect.innerHTML = '';
    itemSelect.appendChild(h('option', { value: '' }, items.length ? 'Choose an existing item…' : 'No items in this category yet'));
    for (const item of items) itemSelect.appendChild(h('option', { value: item.id }, item.name));
    itemSelect.value = items.some((item) => item.id === itemId) ? itemId : '';
    itemId = itemSelect.value;
  };
  categorySelect.addEventListener('change', () => {
    categoryId = categorySelect.value;
    itemId = '';
    refreshItems();
  });
  itemSelect.addEventListener('change', () => {
    itemId = itemSelect.value;
    if (itemId) {
      itemName = '';
      itemInput.value = '';
    }
  });
  refreshCategories();
  refreshItems();

  const categoryName = textInput('', () => {}, { placeholder: 'New category name', maxlength: '120' });
  const categoryColor = h('input', { type: 'color', value: '#78909c', 'aria-label': 'New category colour' });
  const categoryBuilder = h(
    'div',
    { class: 'row' },
    categoryName,
    categoryColor,
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onClick: () => {
          const category = addProductionCategory(registry, categoryName.value, categoryColor.value);
          if (!category) return;
          categoryId = category.id;
          categoryName.value = '';
          refreshCategories();
          categorySelect.value = categoryId;
          refreshItems();
        },
      },
      'Add category'
    )
  );

  const excerpt = selectedElements
    .map((element, offset) => {
      const index = selection.startIndex + offset;
      const from = index === selection.startIndex ? selection.start.offset : 0;
      const to = index === selection.endIndex ? selection.end.offset : element.text.length;
      return element.text.slice(from, to);
    })
    .join(' ')
    .trim();

  const body = h(
    'div',
    {},
    h('p', { class: 'hint' }, `Selected: “${excerpt.slice(0, 180)}${excerpt.length > 180 ? '…' : ''}”`),
    field('Category', categorySelect),
    field('Existing item', itemSelect),
    field('New item', itemInput, 'A prop might be “silver lighter”; a cast item might be “Mara”.'),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Custom category'), categoryBuilder),
    h('label', { class: 'check' }, showTags, 'Show coloured production tags in the editor')
  );

  const selectedBounds = (element, index) => ({
    from: index === selection.startIndex ? selection.start.offset : 0,
    to: index === selection.endIndex ? selection.end.offset : element.text.length,
  });

  openDialog({
    title: 'Production Tag',
    body,
    wide: true,
    buttons: [
      {
        label: 'Remove Tags',
        onClick: () => {
          let count = 0;
          editor.commit(() => {
            editor.doc.production = registry;
            editor.doc.production.showTags = showTags.checked;
            for (let i = selection.startIndex; i <= selection.endIndex; i += 1) {
              const element = editor.doc.elements[i];
              const { from, to } = selectedBounds(element, i);
              count += removeProductionTags(element, from, to);
            }
            return null;
          });
          editor.hardRender(null);
          toast?.(count ? `Removed ${count} production tag${count === 1 ? '' : 's'}.` : 'No tags crossed that selection.');
        },
      },
      { label: 'Cancel' },
      {
        label: 'Apply Tag',
        primary: true,
        onClick: () => {
          if (touchesAlternates) {
            toast?.('Production tags cannot be added to dialogue with stored alternatives.');
            return true;
          }
          const chosen = registry.items.find((item) => item.id === itemId) ||
            ensureProductionItem(registry, categoryId, itemName);
          if (!chosen) {
            toast?.('Choose an existing item or enter a new item name.');
            return true;
          }
          let count = 0;
          editor.commit(() => {
            editor.doc.production = registry;
            editor.doc.production.showTags = showTags.checked;
            for (let i = selection.startIndex; i <= selection.endIndex; i += 1) {
              const element = editor.doc.elements[i];
              const { from, to } = selectedBounds(element, i);
              if (applyProductionTag(element, chosen.id, from, to)) count += 1;
            }
            return null;
          });
          editor.hardRender(null);
          toast?.(`Tagged ${count} screenplay element${count === 1 ? '' : 's'} as ${chosen.name}.`);
        },
      },
    ],
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export function reportsDialog(editor, { onExportCSV, onJumpToScene } = {}) {
  const doc = editor.doc;
  const pagination = editor.pagination;
  const styles = editor.styles;

  const tabs = ['Summary', 'Scenes', 'Characters', 'Locations', 'Breakdown'];
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
    } else if (active === 'Locations') {
      content.appendChild(table(locationReport(doc, pagination), LOCATION_COLUMNS));
    } else {
      content.appendChild(
        table(breakdownReport(doc, pagination), BREAKDOWN_COLUMNS, (row) => onJumpToScene?.(row.sceneId))
      );
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
            Breakdown: [breakdownReport(doc, pagination), BREAKDOWN_COLUMNS, 'breakdown'],
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
 * Local-only table read
 * ------------------------------------------------------------------ */

export function tableReadDialog(editor) {
  const segments = buildTableReadSegments(editor.doc);
  const speakers = tableReadSpeakers(segments);
  const synthesis = window.speechSynthesis || null;
  const Utterance = window.SpeechSynthesisUtterance || null;
  let voices = [];
  const assignments = new Map();
  let activeLine = null;
  let voicePoll = null;
  let voiceSignature = '';

  const privacy = h(
    'p',
    { class: 'hint table-read-privacy' },
    'Local only: Scriptum offers voices marked on-device by your browser or operating system. It refuses remote-service voices and never records audio.'
  );
  const voiceStatus = h('div', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const voiceGrid = h('div', { class: 'table-read-voices' });
  const status = h('div', { class: 'table-read-status', role: 'status', 'aria-live': 'polite' });
  const play = h('button', { class: 'btn primary', type: 'button' }, 'Read');
  const pause = h('button', { class: 'btn', type: 'button', disabled: true }, 'Pause');
  const stop = h('button', { class: 'btn', type: 'button', disabled: true }, 'Stop');
  const previous = h('button', { class: 'btn', type: 'button', 'aria-label': 'Previous table-read line' }, '←');
  const next = h('button', { class: 'btn', type: 'button', 'aria-label': 'Next table-read line' }, '→');
  const rateValue = h('span', { class: 'mono' }, '1.0×');
  const rate = h('input', {
    type: 'range', min: '0.5', max: '2', step: '0.1', value: '1',
    'aria-label': 'Table-read speed',
  });
  const controls = h(
    'div',
    { class: 'table-read-controls' },
    play,
    pause,
    stop,
    previous,
    next,
    h('label', { class: 'table-read-rate' }, 'Speed', rate, rateValue)
  );
  const list = h('div', { class: 'table-read-list', 'aria-label': 'Table-read lines' });
  const lineButtons = segments.map((entry, index) => {
    const button = h(
      'button',
      {
        class: 'table-read-line',
        type: 'button',
      },
      h('b', {}, entry.speaker),
      h('span', {}, entry.text)
    );
    list.appendChild(button);
    return button;
  });

  const resolveVoice = (entry) => {
    const role = entry.kind === 'narration' ? 'Narrator' : entry.speaker;
    const key = assignments.get(role) || assignments.get('Narrator');
    return voices.find((voice) => voiceKey(voice) === key) || null;
  };

  const controller = new TableReadController({
    synthesis,
    Utterance,
    onUpdate: (snapshot) => {
      const labels = {
        idle: 'There is no screenplay text to read.',
        ready: `${snapshot.total} lines ready.`,
        playing: `Reading line ${snapshot.index + 1} of ${snapshot.total}: ${snapshot.segment?.speaker || ''}.`,
        paused: `Paused at line ${snapshot.index + 1} of ${snapshot.total}.`,
        stopped: `Stopped at line ${snapshot.index + 1} of ${snapshot.total}.`,
        completed: `Table read complete — ${snapshot.total} lines.`,
        error: snapshot.error,
      };
      status.textContent = labels[snapshot.status] || '';
      play.textContent = snapshot.status === 'paused' ? 'Resume' : snapshot.status === 'completed' ? 'Read Again' : 'Read';
      pause.disabled = snapshot.status !== 'playing';
      stop.disabled = !['playing', 'paused'].includes(snapshot.status);
      previous.disabled = !snapshot.total || snapshot.index <= 0;
      next.disabled = !snapshot.total || snapshot.index >= snapshot.total - 1;
      if (activeLine) {
        activeLine.classList.remove('active');
        activeLine.removeAttribute('aria-current');
      }
      activeLine = lineButtons[snapshot.index] || null;
      if (activeLine) {
        activeLine.classList.add('active');
        activeLine.setAttribute('aria-current', 'true');
        if (snapshot.status === 'playing') activeLine.scrollIntoView({ block: 'nearest' });
      }
    },
  });
  controller.load(segments, { resolveVoice });

  const voiceOption = (voice, selected) =>
    h(
      'option',
      { value: voiceKey(voice), selected },
      `${voice.name || 'System voice'}${voice.lang ? ` — ${voice.lang}` : ''}`
    );
  const refreshVoices = () => {
    try {
      voices = localSpeechVoices(synthesis?.getVoices?.() || []);
    } catch {
      voices = [];
    }
    const signature = voices.map(voiceKey).join('\u0001');
    if (signature === voiceSignature && voiceGrid.childElementCount) return;
    voiceSignature = signature;
    voiceGrid.innerHTML = '';
    if (!voices.length) {
      voiceStatus.textContent = synthesis
        ? 'No on-device voices are available. Install or enable a local system voice to use Table Read.'
        : 'Speech synthesis is not available in this browser or operating system.';
      play.disabled = true;
      return;
    }
    voiceStatus.textContent = `${voices.length} on-device voice${voices.length === 1 ? '' : 's'} available. Omitted scenes are skipped.`;
    const roles = ['Narrator', ...speakers];
    roles.forEach((role, index) => {
      const existing = assignments.get(role);
      const selected = voices.some((voice) => voiceKey(voice) === existing)
        ? existing
        : voiceKey(voices[index % voices.length]);
      assignments.set(role, selected);
      const select = h(
        'select',
        { onChange: (event) => assignments.set(role, event.target.value) },
        ...voices.map((voice) => voiceOption(voice, voiceKey(voice) === selected))
      );
      voiceGrid.appendChild(field(role, select));
    });
    play.disabled = !segments.length;
    if (voices.length && voicePoll) {
      clearInterval(voicePoll);
      voicePoll = null;
    }
  };

  play.addEventListener('click', () => controller.play());
  pause.addEventListener('click', () => controller.pause());
  stop.addEventListener('click', () => controller.stop());
  previous.addEventListener('click', () => controller.seek(controller.index - 1));
  next.addEventListener('click', () => controller.seek(controller.index + 1));
  rate.addEventListener('input', () => {
    const value = controller.setRate(Number(rate.value));
    rateValue.textContent = `${value.toFixed(1)}×`;
  });
  lineButtons.forEach((button, index) => {
    button.addEventListener('click', () => controller.seek(index, { autoplay: controller.status === 'playing' }));
  });

  const onVoicesChanged = () => refreshVoices();
  synthesis?.addEventListener?.('voiceschanged', onVoicesChanged);
  refreshVoices();
  if (synthesis && !voices.length) {
    let attempts = 0;
    voicePoll = setInterval(() => {
      attempts += 1;
      refreshVoices();
      if (attempts >= 20 && voicePoll) {
        clearInterval(voicePoll);
        voicePoll = null;
      }
    }, 250);
  }

  const body = h('div', {}, privacy, voiceStatus, voiceGrid, controls, status, list);
  openDialog({
    title: 'Table Read',
    body,
    wide: true,
    buttons: [{ label: 'Close', primary: true }],
    onClose: () => {
      controller.destroy();
      synthesis?.removeEventListener?.('voiceschanged', onVoicesChanged);
      if (voicePoll) clearInterval(voicePoll);
    },
  });
}

/* ------------------------------------------------------------------ *
 * Focus mode / writing sprints
 * ------------------------------------------------------------------ */

export function sprintSetupDialog({ onStart } = {}) {
  let durationMinutes = 25;
  let wordTarget = 500;
  let pendingStart = null;
  const body = h(
    'div',
    {},
    h(
      'p',
      { class: 'hint', style: { marginTop: '0' } },
      'Set a quiet block of writing time. Sprint progress stays in memory and is discarded when the session ends.'
    ),
    h(
      'div',
      { class: 'row' },
      field(
        'Minutes',
        numberInput(durationMinutes, (value) => (durationMinutes = value), {
          min: String(MIN_SPRINT_MINUTES),
          max: String(MAX_SPRINT_MINUTES),
          step: '1',
          required: true,
        }),
        `${MIN_SPRINT_MINUTES}–${MAX_SPRINT_MINUTES} minutes`
      ),
      field(
        'Word target',
        numberInput(wordTarget, (value) => (wordTarget = value), {
          min: '0',
          max: String(MAX_SPRINT_WORD_TARGET),
          step: '25',
          required: true,
        }),
        'Use 0 for a timer-only session'
      )
    )
  );
  openDialog({
    title: 'Start a Writing Sprint',
    body,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Begin Sprint',
        primary: true,
        onClick: () => {
          pendingStart = { durationMinutes, wordTarget };
        },
      },
    ],
    onClose: () => {
      if (pendingStart) onStart?.(pendingStart);
    },
  });
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
        ['⌘⇧F', 'Focus mode'],
        ['⌘⇧K', 'Writing sprint'],
        ['F6', 'Move between the screenplay and sprint controls'],
        ['⌘⇧Space', 'Pause or resume a sprint'],
        ['⌘⇧E', 'End a sprint'],
        ['⌘⇧Y', 'Open Table Read'],
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
