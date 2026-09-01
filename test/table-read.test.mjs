import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ElementType } from '../src/core/format.js';
import { createDocument, createElement } from '../src/core/model.js';
import {
  MAX_TABLE_READ_SEGMENTS,
  TableReadController,
  buildTableReadSegments,
  localSpeechVoices,
  tableReadSpeakers,
  voiceKey,
} from '../src/features/table-read.js';
import { serializeProject } from '../src/io/project.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nLocal-only Table Read');

function screenplay() {
  return createDocument({
    elements: [
      createElement(ElementType.SCENE_HEADING, 'INT. CAFÉ - NIGHT', { id: 's1', sceneNumber: '12A' }),
      createElement(ElementType.ACTION, 'Rain needles the window.', { id: 'a1' }),
      createElement(ElementType.CHARACTER, 'MARA (V.O.)', { id: 'c1' }),
      createElement(ElementType.PARENTHETICAL, '(softly)', { id: 'p1' }),
      createElement(ElementType.DIALOGUE, 'We made it.', { id: 'd1' }),
      createElement(ElementType.SCENE_HEADING, 'EXT. ALLEY - NIGHT', { id: 's2', omitted: true }),
      createElement(ElementType.ACTION, 'This omitted scene stays quiet.', { id: 'a2' }),
      createElement(ElementType.SCENE_HEADING, 'INT. CAR - LATER', { id: 's3' }),
      createElement(ElementType.CHARACTER, 'NOAH', { id: 'c2' }),
      createElement(ElementType.DIALOGUE, 'Drive.', { id: 'd2' }),
    ],
  });
}

t('builds narration and character dialogue in screenplay order', () => {
  const segments = buildTableReadSegments(screenplay());
  assert.deepEqual(segments.map((entry) => [entry.kind, entry.speaker]), [
    ['narration', 'Narrator'],
    ['narration', 'Narrator'],
    ['dialogue', 'MARA'],
    ['narration', 'Narrator'],
    ['dialogue', 'NOAH'],
  ]);
  assert.equal(segments[0].text, 'Scene 12A. INT. CAFÉ - NIGHT');
  assert.equal(segments[2].text, 'softly. We made it.');
  assert.ok(segments.every((entry) => !entry.text.includes('omitted scene')));
  assert.deepEqual(tableReadSpeakers(segments), ['MARA', 'NOAH']);
});

t('omitted scenes are read only when explicitly requested', () => {
  const segments = buildTableReadSegments(screenplay(), { includeOmitted: true });
  assert.ok(segments.some((entry) => entry.text.includes('omitted scene')));
});

t('control characters are removed and oversized input is bounded', () => {
  const elements = [];
  for (let i = 0; i < MAX_TABLE_READ_SEGMENTS + 5; i += 1) {
    elements.push(createElement(ElementType.ACTION, `Line\u0000 ${i}`));
  }
  const segments = buildTableReadSegments(createDocument({ elements }));
  assert.equal(segments.length, MAX_TABLE_READ_SEGMENTS);
  assert.ok(segments.every((entry) => !entry.text.includes('\u0000')));
  const combined = createDocument({ elements: [
    createElement(ElementType.CHARACTER, 'MARA'),
    createElement(ElementType.PARENTHETICAL, `(${`a`.repeat(20000)})`),
    createElement(ElementType.DIALOGUE, 'b'.repeat(20000)),
  ] });
  assert.equal(buildTableReadSegments(combined)[0].text.length, 20000);
});

t('voice discovery admits only explicitly on-device voices and removes duplicates', () => {
  const local = { voiceURI: 'local:a', name: 'Alice', lang: 'en-US', localService: true };
  const voices = localSpeechVoices([
    { voiceURI: 'remote', name: 'Cloud', lang: 'en-US', localService: false },
    { voiceURI: 'unknown', name: 'Unknown', lang: 'en-US' },
    local,
    { ...local },
    { voiceURI: 'local:b', name: 'Béa', lang: 'fr-FR', localService: true },
  ]);
  assert.deepEqual(voices.map(voiceKey), ['local:a', 'local:b']);
});

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

function fakeSynthesis() {
  return {
    spoken: [],
    cancelCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    speak(utterance) { this.spoken.push(utterance); },
    cancel() { this.cancelCount += 1; },
    pause() { this.pauseCount += 1; },
    resume() { this.resumeCount += 1; },
  };
}

t('controller reads sequentially, pauses, resumes, and completes', () => {
  const synthesis = fakeSynthesis();
  const voice = { voiceURI: 'local', localService: true };
  const states = [];
  const controller = new TableReadController({
    synthesis,
    Utterance: FakeUtterance,
    onUpdate: (state) => states.push(state.status),
  });
  const segments = buildTableReadSegments(screenplay()).slice(0, 2);
  controller.load(segments, { resolveVoice: () => voice, rate: 1.25 });
  assert.equal(controller.play().status, 'playing');
  assert.equal(synthesis.spoken[0].voice, voice);
  assert.equal(synthesis.spoken[0].rate, 1.25);
  assert.equal(controller.pause().status, 'paused');
  assert.equal(synthesis.pauseCount, 1);
  const resumesBeforePlay = synthesis.resumeCount;
  assert.equal(controller.play().status, 'playing');
  assert.equal(synthesis.resumeCount, resumesBeforePlay + 1);
  synthesis.spoken[0].onend();
  assert.equal(synthesis.spoken.length, 2);
  assert.equal(controller.index, 1);
  synthesis.spoken[1].onend();
  assert.equal(controller.status, 'completed');
  assert.ok(states.includes('playing'));
});

t('cancelled utterance callbacks cannot advance a newer selection', () => {
  const synthesis = fakeSynthesis();
  const voice = { voiceURI: 'local', localService: true };
  const controller = new TableReadController({ synthesis, Utterance: FakeUtterance });
  const segments = buildTableReadSegments(screenplay()).slice(0, 3);
  controller.load(segments, { resolveVoice: () => voice });
  controller.play();
  const stale = synthesis.spoken[0];
  controller.seek(2, { autoplay: true });
  stale.onend();
  assert.equal(controller.index, 2);
  assert.equal(synthesis.spoken.length, 2);
});

t('remote or unknown voices fail closed before any speech is submitted', () => {
  for (const voice of [
    { voiceURI: 'remote', localService: false },
    { voiceURI: 'unknown' },
    null,
  ]) {
    const synthesis = fakeSynthesis();
    const controller = new TableReadController({ synthesis, Utterance: FakeUtterance });
    controller.load([{ id: '1', kind: 'narration', speaker: 'Narrator', text: 'Private words.' }], {
      resolveVoice: () => voice,
    });
    const result = controller.play();
    assert.equal(result.status, 'error');
    assert.match(result.error, /on-device voice/);
    assert.equal(synthesis.spoken.length, 0);
  }
});

t('playback speed is clamped and destruction cancels speech', () => {
  const synthesis = fakeSynthesis();
  const voice = { localService: true, voiceURI: 'local' };
  const controller = new TableReadController({ synthesis, Utterance: FakeUtterance });
  controller.load([{ id: '1', kind: 'narration', speaker: 'Narrator', text: 'Line.' }], {
    resolveVoice: () => voice,
  });
  assert.equal(controller.setRate(99), 2);
  assert.equal(controller.setRate(-10), 0.5);
  controller.play();
  controller.pause();
  const resumesBeforeStop = synthesis.resumeCount;
  controller.stop();
  assert.ok(synthesis.resumeCount > resumesBeforeStop);
  controller.play();
  const before = synthesis.cancelCount;
  controller.destroy();
  assert.ok(synthesis.cancelCount > before);
  assert.equal(controller.status, 'idle');
});

t('speech-engine exceptions become contained user-facing errors', () => {
  const synthesis = fakeSynthesis();
  synthesis.speak = () => { throw new Error('engine failed'); };
  const voice = { localService: true, voiceURI: 'local' };
  const controller = new TableReadController({ synthesis, Utterance: FakeUtterance });
  controller.load([{ id: '1', kind: 'narration', speaker: 'Narrator', text: 'Line.' }], {
    resolveVoice: () => voice,
  });
  const result = controller.play();
  assert.equal(result.status, 'error');
  assert.match(result.error, /could not start playback/);
});

t('Table Read has no project persistence, microphone, or network implementation', () => {
  assert.doesNotMatch(serializeProject(createDocument()), /tableRead|voiceAssignment/);
  const source = fs.readFileSync(new URL('../src/features/table-read.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getUserMedia|MediaRecorder|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/);
  assert.match(source, /localService !== true/);
});

t('toolbar, local-only dialog, native menu, cleanup, accessibility, and privacy copy are wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../src/ui/dialogs.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const privacy = fs.readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
  assert.match(html, /id="tb-table-read"/);
  assert.match(app, /tableReadDialog\(editor\)/);
  assert.match(dialogs, /Local only:/);
  assert.match(dialogs, /'aria-label': 'Table-read lines'/);
  assert.match(dialogs, /controller\.destroy\(\)/);
  assert.match(dialogs, /closeCurrent\?\.\(\)/);
  assert.match(dialogs, /removeEventListener\?\.\('voiceschanged'/);
  assert.match(main, /menu:table-read/);
  assert.match(preload, /menu:table-read/);
  assert.match(privacy, /refuses voices\s+marked as remote/);
});

console.log(`\n${pass} local Table Read checks passed.`);
