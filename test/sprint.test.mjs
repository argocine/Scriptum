import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDocument } from '../src/core/model.js';
import {
  MAX_SPRINT_MINUTES,
  MAX_SPRINT_WORD_TARGET,
  WritingSprint,
  formatSprintTime,
} from '../src/features/sprint.js';
import { serializeProject } from '../src/io/project.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nFocus mode and writing sprints');

t('starts a deterministic timer and counts only words added during the session', () => {
  let clock = 1000;
  const sprint = new WritingSprint({ now: () => clock });
  const started = sprint.start({ durationMinutes: 1, wordTarget: 100 }, 250);
  assert.equal(started.status, 'running');
  assert.equal(started.remainingMs, 60000);
  clock += 30000;
  const halfway = sprint.snapshot(290);
  assert.equal(halfway.elapsedMs, 30000);
  assert.equal(halfway.remainingMs, 30000);
  assert.equal(halfway.wordsWritten, 40);
  assert.equal(halfway.progress, 0.4);
});

t('pause and resume exclude paused time without interval drift', () => {
  let clock = 0;
  const sprint = new WritingSprint({ now: () => clock });
  sprint.start({ durationMinutes: 1, wordTarget: 0 }, 10);
  clock = 15000;
  assert.equal(sprint.pause(20).elapsedMs, 15000);
  clock = 45000;
  assert.equal(sprint.snapshot(25).elapsedMs, 15000);
  assert.equal(sprint.resume(25).status, 'running');
  clock = 60000;
  assert.equal(sprint.snapshot(30).elapsedMs, 30000);
});

t('completes exactly at the deadline and freezes the final word result', () => {
  let clock = 0;
  const sprint = new WritingSprint({ now: () => clock });
  sprint.start({ durationMinutes: 1, wordTarget: 50 }, 100);
  clock = 60000;
  const completed = sprint.snapshot(165);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.remainingMs, 0);
  assert.equal(completed.wordsWritten, 65);
  assert.equal(completed.targetReached, true);
  clock += 60000;
  assert.equal(sprint.snapshot(999).wordsWritten, 65);
});

t('pause or end at the deadline cannot strand a zero-time active session', () => {
  let clock = 0;
  const paused = new WritingSprint({ now: () => clock });
  paused.start({ durationMinutes: 1 }, 0);
  clock = 60000;
  assert.equal(paused.pause(10).status, 'completed');
  const ended = new WritingSprint({ now: () => clock });
  ended.start({ durationMinutes: 1 }, 0);
  clock = 120000;
  assert.equal(ended.end(20).status, 'completed');
});

t('word progress never becomes negative after deletions', () => {
  const sprint = new WritingSprint({ now: () => 0 });
  sprint.start({ durationMinutes: 25, wordTarget: 500 }, 1000);
  const result = sprint.snapshot(800);
  assert.equal(result.wordsWritten, 0);
  assert.equal(result.progress, 0);
});

t('settings are clamped to explicit safe limits', () => {
  const sprint = new WritingSprint({ now: () => 0 });
  let result = sprint.start({ durationMinutes: 9999, wordTarget: 999999 }, -5);
  assert.equal(result.durationMs, MAX_SPRINT_MINUTES * 60000);
  assert.equal(result.wordTarget, MAX_SPRINT_WORD_TARGET);
  assert.equal(result.startWords, 0);
  sprint.reset();
  result = sprint.start({ durationMinutes: Number.NaN, wordTarget: -100 }, 0);
  assert.equal(result.durationMs, 25 * 60000);
  assert.equal(result.wordTarget, 0);
});

t('ending and resetting a session are explicit', () => {
  let clock = 0;
  const sprint = new WritingSprint({ now: () => clock });
  sprint.start({ durationMinutes: 5, wordTarget: 10 }, 20);
  clock = 30000;
  const ended = sprint.end(27);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.wordsWritten, 7);
  sprint.reset();
  assert.equal(sprint.snapshot().status, 'idle');
});

t('time formatting remains readable beyond one hour', () => {
  assert.equal(formatSprintTime(0), '00:00');
  assert.equal(formatSprintTime(1001), '00:02');
  assert.equal(formatSprintTime(90 * 60000), '90:00');
});

t('sprint state is absent from project files and the feature has no storage or network access', () => {
  const json = serializeProject(createDocument());
  assert.doesNotMatch(json, /writingSprint|sprintStatus|durationMs/);
  const source = fs.readFileSync(new URL('../src/features/sprint.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket/);
});

t('toolbar, HUD, accessibility, native menus, reset paths, and privacy copy are wired', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../src/ui/dialogs.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const privacy = fs.readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
  assert.match(html, /id="tb-focus"/);
  assert.match(html, /id="tb-sprint"/);
  assert.match(html, /id="focus-progress" role="progressbar"/);
  assert.match(html, /id="focus-announcer" aria-live="polite"/);
  assert.match(css, /\.focus-mode #toolbar/);
  assert.match(css, /#focus-hud\[hidden\]/);
  assert.match(dialogs, /Start a Writing Sprint/);
  assert.match(dialogs, /pendingStart/);
  assert.match(app, /resetWritingSprint\(\);\s*editor\.load/g);
  assert.match(app, /aria-valuetext/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /event\.key === 'F6'/);
  assert.match(app, /menu:sprint-pause/);
  assert.match(app, /menu:sprint-end/);
  assert.match(dialogs, /previousFocus\.getClientRects\(\)\.length/);
  assert.match(main, /menu:focus/);
  assert.match(main, /menu:sprint/);
  assert.match(preload, /menu:focus/);
  assert.match(preload, /menu:sprint/);
  assert.match(privacy, /session-only/);
});

console.log(`\n${pass} Focus and sprint checks passed.`);
