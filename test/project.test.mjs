import assert from 'node:assert/strict';
import { ElementType, resolveStyles } from '../src/core/format.js';
import { createDocument, createElement } from '../src/core/model.js';
import {
  parseProject,
  serializeProject,
  writeAutosave,
  readAutosave,
  clearAutosave,
} from '../src/io/project.js';
import { toFDX } from '../src/io/fdx.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

function payload(document, extra = {}) {
  return JSON.stringify({
    format: 'scriptum-screenplay',
    formatVersion: 1,
    document,
    ...extra,
  });
}

console.log('\nNative project format');

t('round-trips screenplay content and production metadata', () => {
  const scene = createElement(ElementType.SCENE_HEADING, 'INT. CAFÉ - NIGHT', {
    sceneNumber: '12A',
    sceneNumberLocked: true,
    notes: [{ id: 'n1', text: 'Keep the rain.', color: '#ffee88' }],
  });
  const dialogue = createElement(ElementType.DIALOGUE, 'Déjà vu.', {
    styles: [{ start: 0, end: 4, italic: true }],
  });
  const doc = createDocument({ elements: [scene, dialogue] });
  doc.title.title = 'Night Work';
  doc.sceneNumbering = { ...doc.sceneNumbering, enabled: true, locked: true };

  const restored = parseProject(serializeProject(doc));
  assert.equal(restored.title.title, 'Night Work');
  assert.equal(restored.elements[0].sceneNumber, '12A');
  assert.equal(restored.elements[0].notes[0].text, 'Keep the rain.');
  assert.equal(restored.elements[1].text, 'Déjà vu.');
  assert.equal(restored.elements[1].styles[0].italic, true);
});

t('rejects malformed, foreign, future, and invalid-version files', () => {
  assert.throws(() => parseProject('{'), /not valid Scriptum JSON/i);
  assert.throws(() => parseProject('{}'), /not written by Scriptum/i);
  assert.throws(
    () => parseProject(payload({}, { formatVersion: 2 })),
    /newer version of Scriptum/i
  );
  assert.throws(
    () => parseProject(payload({}, { formatVersion: 'one' })),
    /invalid Scriptum format version/i
  );
});

t('repairs unsafe field types and duplicate element identifiers', () => {
  const restored = parseProject(
    payload({
      title: { title: 42, showTitlePage: 'yes' },
      sceneNumbering: { enabled: 'yes', startAt: 'many' },
      pageOverrides: { marginTop: 'bad', linesPerPage: 'bad' },
      elements: [
        null,
        { id: 'same', type: 'unknown', text: 42, styles: 'bad', notes: 'bad' },
        {
          id: 'same',
          type: ElementType.ACTION,
          text: 'Safe text',
          styles: [{ start: -5, end: 200, bold: true }],
          notes: [{ text: 99 }],
        },
      ],
    })
  );

  assert.equal(restored.title.title, 'UNTITLED');
  assert.equal(restored.sceneNumbering.enabled, false);
  assert.equal(restored.sceneNumbering.startAt, 1);
  assert.equal(restored.elements.length, 2);
  assert.equal(restored.elements[0].type, ElementType.ACTION);
  assert.equal(restored.elements[0].text, '');
  assert.notEqual(restored.elements[0].id, restored.elements[1].id);
  assert.equal(restored.elements[1].notes[0].text, '');
  assert.deepEqual(restored.elements[1].styles[0], {
    start: 0,
    end: 9,
    bold: true,
    italic: false,
    underline: false,
  });

  const styles = resolveStyles(restored.styleOverrides, restored.pageOverrides);
  assert.equal(styles.page.marginTop, 1);
  assert.equal(styles.page.linesPerPage, 55);
});

t('an empty or missing element list opens as a usable blank screenplay', () => {
  const restored = parseProject(payload({ elements: 'not-an-array' }));
  assert.equal(restored.elements.length, 1);
  assert.equal(restored.elements[0].type, ElementType.SCENE_HEADING);
});

t('browser recovery is tab-scoped while desktop recovery is persistent and clearable', () => {
  const memoryStore = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  const previousWindow = globalThis.window;
  const localStorage = memoryStore();
  const sessionStorage = memoryStore();
  const doc = createDocument();

  try {
    globalThis.window = { localStorage, sessionStorage, scriptum: null };
    localStorage.setItem('scriptum:autosave', 'legacy persistent screenplay');
    assert.equal(writeAutosave(doc, null), true);
    assert.equal(readAutosave().document.elements.length, 1);
    assert.equal(localStorage.getItem('scriptum:autosave'), null);

    globalThis.window.scriptum = {};
    assert.equal(writeAutosave(doc, '/private/screenplay.scriptum'), true);
    assert.match(localStorage.getItem('scriptum:autosave'), /private\/screenplay/);

    clearAutosave();
    assert.equal(localStorage.getItem('scriptum:autosave'), null);
    assert.equal(sessionStorage.getItem('scriptum:autosave'), null);

    // A browser can expose session storage while denying persistent storage.
    // Clearing recovery must still reach the available store.
    sessionStorage.setItem('scriptum:autosave', 'session-only screenplay');
    globalThis.window = { sessionStorage, scriptum: null };
    Object.defineProperty(globalThis.window, 'localStorage', {
      get: () => { throw new Error('storage denied'); },
    });
    clearAutosave();
    assert.equal(sessionStorage.getItem('scriptum:autosave'), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

console.log('\nFDX export');

t('preserves revision identifiers and XML-escapes metadata', () => {
  const el = createElement(ElementType.ACTION, 'A & B < C', { revisionId: '7' });
  const doc = createDocument({ elements: [el] });
  doc.title.showTitlePage = false;
  doc.revisions.sets = [
    { id: '7', name: 'Blue & Gold', color: '#7fb2ff', mark: '*', date: '' },
  ];
  const xml = toFDX(doc);
  assert.match(xml, /RevisionID="7"/);
  assert.match(xml, /Revision Number="7"/);
  assert.ok(xml.includes('A &amp; B &lt; C'));
  assert.ok(xml.includes('Name="Blue &amp; Gold"'));
});

console.log(`\n${pass} project checks passed.`);
