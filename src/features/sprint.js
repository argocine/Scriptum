/** In-memory writing sprint clock. It never reads or writes screenplay data. */

export const MIN_SPRINT_MINUTES = 1;
export const MAX_SPRINT_MINUTES = 240;
export const MAX_SPRINT_WORD_TARGET = 10000;

export class WritingSprint {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.reset();
  }

  start({ durationMinutes = 25, wordTarget = 500 } = {}, startWords = 0) {
    const minutes = boundedInteger(
      durationMinutes,
      25,
      MIN_SPRINT_MINUTES,
      MAX_SPRINT_MINUTES
    );
    this.durationMs = minutes * 60 * 1000;
    this.wordTarget = boundedInteger(wordTarget, 0, 0, MAX_SPRINT_WORD_TARGET);
    this.startWords = nonnegativeInteger(startWords);
    this.finalWords = null;
    this.elapsedBeforeRun = 0;
    this.runningSince = this.now();
    this.status = 'running';
    return this.snapshot(startWords, this.runningSince);
  }

  pause(currentWords = this.startWords, at = this.now()) {
    const current = this.snapshot(currentWords, at);
    if (this.status !== 'running') return current;
    this.elapsedBeforeRun = this.elapsedAt(at);
    this.runningSince = null;
    this.status = 'paused';
    return this.snapshot(currentWords, at);
  }

  resume(currentWords = this.startWords, at = this.now()) {
    if (this.status !== 'paused') return this.snapshot(currentWords, at);
    this.runningSince = at;
    this.status = 'running';
    return this.snapshot(currentWords, at);
  }

  end(currentWords = this.startWords, at = this.now()) {
    const current = this.snapshot(currentWords, at);
    if (!this.isActive()) return current;
    this.elapsedBeforeRun = Math.min(this.durationMs, this.elapsedAt(at));
    this.runningSince = null;
    this.finalWords = nonnegativeInteger(currentWords);
    this.status = 'ended';
    return this.snapshot(this.finalWords, at);
  }

  reset() {
    this.status = 'idle';
    this.durationMs = 0;
    this.wordTarget = 0;
    this.startWords = 0;
    this.finalWords = null;
    this.elapsedBeforeRun = 0;
    this.runningSince = null;
  }

  isActive() {
    return this.status === 'running' || this.status === 'paused';
  }

  elapsedAt(at = this.now()) {
    const running = this.status === 'running' && this.runningSince != null
      ? Math.max(0, at - this.runningSince)
      : 0;
    return Math.min(this.durationMs, this.elapsedBeforeRun + running);
  }

  snapshot(currentWords = this.startWords, at = this.now()) {
    const wordsNow = this.finalWords ?? nonnegativeInteger(currentWords);
    let elapsedMs = this.elapsedAt(at);
    if (this.status === 'running' && this.durationMs && elapsedMs >= this.durationMs) {
      elapsedMs = this.durationMs;
      this.elapsedBeforeRun = elapsedMs;
      this.runningSince = null;
      this.finalWords = wordsNow;
      this.status = 'completed';
    }
    const wordsWritten = Math.max(0, wordsNow - this.startWords);
    const remainingMs = Math.max(0, this.durationMs - elapsedMs);
    const targetProgress = this.wordTarget
      ? Math.min(1, wordsWritten / this.wordTarget)
      : this.durationMs
        ? Math.min(1, elapsedMs / this.durationMs)
        : 0;
    return {
      status: this.status,
      durationMs: this.durationMs,
      elapsedMs,
      remainingMs,
      startWords: this.startWords,
      currentWords: wordsNow,
      wordsWritten,
      wordTarget: this.wordTarget,
      targetReached: this.wordTarget > 0 && wordsWritten >= this.wordTarget,
      progress: targetProgress,
    };
  }
}

export function formatSprintTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function boundedInteger(value, fallback, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function nonnegativeInteger(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}
