/** Local-only screenplay table reads built on explicitly on-device system voices. */

import { ElementType } from '../core/format.js';
import { baseCharacterName } from '../core/model.js';

export const MAX_TABLE_READ_SEGMENTS = 10000;
export const MAX_TABLE_READ_SPEAKERS = 500;
export const MAX_TABLE_READ_TEXT_LENGTH = 20000;
export const MAX_TABLE_READ_CHARACTERS = 5_000_000;

const NARRATION_TYPES = new Set([
  ElementType.SCENE_HEADING,
  ElementType.ACTION,
  ElementType.TRANSITION,
  ElementType.SHOT,
  ElementType.GENERAL,
  ElementType.ACT_BREAK,
]);

export function buildTableReadSegments(doc, { includeOmitted = false } = {}) {
  const segments = [];
  let speaker = '';
  let parenthetical = '';
  let omittedScene = false;
  let characterCount = 0;
  const append = (entry) => {
    const remaining = MAX_TABLE_READ_CHARACTERS - characterCount;
    if (remaining <= 0) return false;
    entry.text = entry.text.slice(0, remaining);
    if (!entry.text) return false;
    segments.push(entry);
    characterCount += entry.text.length;
    return characterCount < MAX_TABLE_READ_CHARACTERS;
  };
  for (const element of doc?.elements || []) {
    if (segments.length >= MAX_TABLE_READ_SEGMENTS) break;
    const text = speechText(element?.text);
    if (element?.type === ElementType.SCENE_HEADING) {
      omittedScene = !!element.omitted;
      speaker = '';
      parenthetical = '';
      if ((!omittedScene || includeOmitted) && text) {
        const prefix = element.sceneNumber ? `Scene ${speechText(element.sceneNumber)}. ` : '';
        if (!append(segment(element, 'narration', 'Narrator', `${prefix}${text}`))) break;
      }
      continue;
    }
    if (omittedScene && !includeOmitted) continue;
    if (element?.type === ElementType.CHARACTER) {
      speaker = speechText(baseCharacterName(text)) || 'Unassigned character';
      parenthetical = '';
      continue;
    }
    if (element?.type === ElementType.PARENTHETICAL) {
      parenthetical = stripOuterParentheses(text);
      continue;
    }
    if (element?.type === ElementType.DIALOGUE) {
      if (text) {
        const spoken = parenthetical ? `${parenthetical}. ${text}` : text;
        if (!append(segment(element, 'dialogue', speaker || 'Unassigned character', spoken))) break;
      }
      parenthetical = '';
      continue;
    }
    if (NARRATION_TYPES.has(element?.type)) {
      if (text && !append(segment(element, 'narration', 'Narrator', text))) break;
      speaker = '';
      parenthetical = '';
    }
  }
  return segments;
}

export function tableReadSpeakers(segments) {
  const seen = new Set();
  const speakers = [];
  for (const entry of segments || []) {
    if (entry.kind !== 'dialogue' || seen.has(entry.speaker)) continue;
    seen.add(entry.speaker);
    speakers.push(entry.speaker);
    if (speakers.length >= MAX_TABLE_READ_SPEAKERS) break;
  }
  return speakers;
}

export function localSpeechVoices(voices) {
  const seen = new Set();
  return [...(voices || [])]
    .filter((voice) => voice?.localService === true)
    .filter((voice) => {
      const key = voiceKey(voice);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      String(a.lang || '').localeCompare(String(b.lang || '')) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );
}

export function voiceKey(voice) {
  if (!voice || voice.localService !== true) return '';
  if (voice.voiceURI) return String(voice.voiceURI);
  if (!voice.name && !voice.lang) return '';
  return `${voice.name || ''}\u0000${voice.lang || ''}`;
}

export class TableReadController {
  constructor({ synthesis, Utterance, onUpdate = () => {} } = {}) {
    this.synthesis = synthesis;
    this.Utterance = Utterance;
    this.onUpdate = onUpdate;
    this.segments = [];
    this.resolveVoice = () => null;
    this.rate = 1;
    this.index = 0;
    this.status = 'idle';
    this.error = '';
    this.utterance = null;
    this.generation = 0;
  }

  load(segments, { resolveVoice = () => null, rate = 1, startIndex = 0 } = {}) {
    this.stop({ notify: false });
    this.segments = Array.isArray(segments)
      ? segments.slice(0, MAX_TABLE_READ_SEGMENTS).map((entry) => ({ ...entry }))
      : [];
    this.resolveVoice = resolveVoice;
    this.rate = safeRate(rate);
    this.index = boundedIndex(startIndex, this.segments.length);
    this.status = this.segments.length ? 'ready' : 'idle';
    this.error = '';
    this.notify();
    return this.snapshot();
  }

  play() {
    if (!this.segments.length) return this.fail('There is no screenplay text to read.');
    if (this.status === 'paused') {
      try {
        this.synthesis?.resume?.();
      } catch {
        return this.fail('The on-device speech engine could not resume playback.');
      }
      this.status = 'playing';
      this.notify();
      return this.snapshot();
    }
    if (this.status === 'playing') return this.snapshot();
    if (this.status === 'completed') this.index = 0;
    return this.speakCurrent();
  }

  pause() {
    if (this.status !== 'playing') return this.snapshot();
    try {
      this.synthesis?.pause?.();
    } catch {
      return this.fail('The on-device speech engine could not pause playback.');
    }
    this.status = 'paused';
    this.notify();
    return this.snapshot();
  }

  stop({ notify = true } = {}) {
    this.generation += 1;
    this.resetSynthesis();
    this.utterance = null;
    if (this.status !== 'idle') this.status = 'stopped';
    if (notify) this.notify();
    return this.snapshot();
  }

  seek(index, { autoplay = this.status === 'playing' } = {}) {
    this.generation += 1;
    this.resetSynthesis();
    this.utterance = null;
    this.index = boundedIndex(index, this.segments.length);
    this.status = this.segments.length ? 'ready' : 'idle';
    this.error = '';
    if (autoplay) return this.speakCurrent();
    this.notify();
    return this.snapshot();
  }

  setRate(rate) {
    this.rate = safeRate(rate);
    this.notify();
    return this.rate;
  }

  destroy() {
    this.stop({ notify: false });
    this.segments = [];
    this.status = 'idle';
  }

  speakCurrent() {
    const entry = this.segments[this.index];
    if (!entry) {
      this.status = 'completed';
      this.notify();
      return this.snapshot();
    }
    if (!this.synthesis || typeof this.synthesis.speak !== 'function' || !this.Utterance) {
      return this.fail('Speech synthesis is not available in this browser or operating system.');
    }
    const voice = this.resolveVoice(entry);
    if (!voice || voice.localService !== true) {
      return this.fail(`No on-device voice is assigned to ${entry.speaker}.`);
    }
    const generation = ++this.generation;
    let utterance;
    try {
      utterance = new this.Utterance(entry.text);
      utterance.voice = voice;
      utterance.rate = this.rate;
    } catch {
      return this.fail('The on-device speech engine could not prepare this line.');
    }
    utterance.onend = () => {
      if (generation !== this.generation) return;
      this.utterance = null;
      if (this.index + 1 >= this.segments.length) {
        this.status = 'completed';
        this.notify();
        return;
      }
      this.index += 1;
      this.speakCurrent();
    };
    utterance.onerror = (event) => {
      if (generation !== this.generation) return;
      this.utterance = null;
      this.fail(`The on-device voice could not read this line${event?.error ? ` (${event.error})` : ''}.`);
    };
    this.utterance = utterance;
    this.status = 'playing';
    this.error = '';
    this.notify();
    try {
      this.synthesis.speak(utterance);
    } catch {
      return this.fail('The on-device speech engine could not start playback.');
    }
    return this.snapshot();
  }

  fail(message) {
    this.generation += 1;
    this.resetSynthesis();
    this.utterance = null;
    this.status = 'error';
    this.error = message;
    this.notify();
    return this.snapshot();
  }

  snapshot() {
    return {
      status: this.status,
      index: this.index,
      total: this.segments.length,
      segment: this.segments[this.index] || null,
      rate: this.rate,
      error: this.error,
    };
  }

  notify() {
    this.onUpdate(this.snapshot());
  }

  resetSynthesis() {
    // Web Speech cancel() clears the queue but deliberately preserves its
    // paused flag. Resume after cancellation so a later local utterance can
    // never be left queued silently behind a stale Pause.
    try { this.synthesis?.cancel?.(); } catch { /* engine is already unavailable */ }
    try { this.synthesis?.resume?.(); } catch { /* no queued speech remains */ }
  }
}

function segment(element, kind, speaker, text) {
  return {
    id: `${String(element.id || 'element')}:${kind}`,
    elementId: String(element.id || ''),
    sourceType: element.type,
    kind,
    speaker,
    text: speechText(text),
  };
}

function speechText(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TABLE_READ_TEXT_LENGTH)
    : '';
}

function stripOuterParentheses(value) {
  const text = speechText(value);
  return text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1).trim() : text;
}

function safeRate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.5, Math.min(2, number)) : 1;
}

function boundedIndex(value, length) {
  if (!length) return 0;
  return Math.max(0, Math.min(length - 1, Math.floor(Number(value) || 0)));
}
