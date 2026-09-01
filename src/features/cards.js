/**
 * cards.js — The index card board.
 *
 * Every card is a scene. Dragging a card moves the whole scene — heading and
 * all its elements — which is the point: restructuring an act should be one
 * gesture, not a cut-and-paste operation that risks losing a page of dialogue.
 */

import { ElementType } from '../core/format.js';
import { getScenes, replaceElementTextByDiff } from '../core/model.js';

export const CARD_COLORS = [
  { name: 'None', value: null },
  { name: 'Red', value: '#e06a80' },
  { name: 'Orange', value: '#eb9a4e' },
  { name: 'Yellow', value: '#e6c25a' },
  { name: 'Green', value: '#6bbf7f' },
  { name: 'Blue', value: '#5b8dff' },
  { name: 'Purple', value: '#a67ce0' },
];

export class CardBoard {
  constructor(host, editor, { onJumpToScene } = {}) {
    this.host = host;
    this.editor = editor;
    this.onJumpToScene = onJumpToScene || (() => {});
    this.dragId = null;
  }

  render() {
    const doc = this.editor.doc;
    const scenes = getScenes(doc);
    this.host.innerHTML = '';

    if (!scenes.length) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.textContent = 'No scenes yet. Write a scene heading to see cards here.';
      this.host.appendChild(empty);
      return;
    }

    scenes.forEach((scene, index) => {
      this.host.appendChild(this.buildCard(scene, index, scenes));
    });
  }

  buildCard(scene, index, scenes) {
    const doc = this.editor.doc;
    const heading = doc.elements.find((e) => e.id === scene.id);

    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.sceneId = scene.id;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `Scene ${scene.sceneNumber || index + 1}`);
    if (heading?.cardColor) card.style.setProperty('--card-color', heading.cardColor);

    const num = document.createElement('div');
    num.className = 'card-num';
    num.textContent = `${scene.sceneNumber || index + 1}`;
    card.appendChild(num);

    const head = document.createElement('div');
    head.className = 'card-head';
    head.contentEditable = 'true';
    head.setAttribute('role', 'textbox');
    head.setAttribute('aria-label', `Scene ${scene.sceneNumber || index + 1} heading`);
    head.spellcheck = false;
    head.textContent = scene.heading || '(no heading)';
    head.addEventListener('blur', () => {
      const text = head.textContent.trim();
      if (text === scene.heading) return;
      this.editor.commit(() => {
        const el = this.editor.doc.elements.find((e) => e.id === scene.id);
        if (el) replaceElementTextByDiff(el, text);
        return null;
      }, { rebuildVocab: true });
      this.render();
    });
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        head.blur();
      }
    });
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'card-text';
    body.contentEditable = 'true';
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', `Scene ${scene.sceneNumber || index + 1} synopsis`);
    const displayedSynopsis = heading?.synopsis || scene.summary || '';
    body.textContent = displayedSynopsis;
    body.addEventListener('blur', () => {
      const text = body.textContent.trim();
      if (text === displayedSynopsis) return;
      this.editor.commit(() => {
        const el = this.editor.doc.elements.find((e) => e.id === scene.id);
        if (el) el.synopsis = text;
        return null;
      });
    });
    card.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const count = scene.elements.filter((e) => e.type !== ElementType.SCENE_HEADING).length;
    foot.textContent = `${count} element${count === 1 ? '' : 's'}`;

    const colors = document.createElement('div');
    colors.className = 'card-colors';
    for (const c of CARD_COLORS.slice(1)) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `card-color${heading?.cardColor === c.value ? ' on' : ''}`;
      dot.style.background = c.value;
      dot.title = c.name;
      dot.setAttribute('aria-label', `${c.name} card colour`);
      dot.setAttribute('aria-pressed', String(heading?.cardColor === c.value));
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.editor.commit(() => {
          const el = this.editor.doc.elements.find((x) => x.id === scene.id);
          if (el) el.cardColor = el.cardColor === c.value ? null : c.value;
          return null;
        });
        this.render();
        this.host
          .querySelector(`.card[data-scene-id="${scene.id}"] .card-color[aria-label="${c.name} card colour"]`)
          ?.focus();
      });
      colors.appendChild(dot);
    }
    foot.appendChild(colors);

    const order = document.createElement('div');
    order.className = 'card-order';
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.className = 'card-order-button';
    earlier.textContent = '←';
    earlier.title = 'Move scene earlier';
    earlier.setAttribute('aria-label', 'Move scene earlier');
    earlier.disabled = index === 0;
    earlier.addEventListener('click', (event) => {
      event.stopPropagation();
      this.moveScene(scene.id, scenes[index - 1]?.id || null, 'earlier');
    });
    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'card-order-button';
    later.textContent = '→';
    later.title = 'Move scene later';
    later.setAttribute('aria-label', 'Move scene later');
    later.disabled = index === scenes.length - 1;
    later.addEventListener('click', (event) => {
      event.stopPropagation();
      this.moveScene(scene.id, scenes[index + 2]?.id || null, 'later');
    });
    order.append(earlier, later);
    foot.appendChild(order);
    card.appendChild(foot);

    card.addEventListener('dblclick', (e) => {
      if (e.target === head || e.target === body) return;
      this.onJumpToScene(scene.id);
    });

    card.addEventListener('dragstart', (e) => {
      this.dragId = scene.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', scene.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      this.host.querySelectorAll('.card').forEach((c) => c.classList.remove('drop-before'));
      this.dragId = null;
    });
    card.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === scene.id) return;
      e.preventDefault();
      card.classList.add('drop-before');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drop-before');
      if (this.dragId && this.dragId !== scene.id) {
        this.moveScene(this.dragId, scene.id);
      }
    });

    return card;
  }

  /** Move an entire scene (heading plus body) to sit before `beforeSceneId`. */
  moveScene(sceneId, beforeSceneId, focusDirection = '') {
    this.editor.commit(() => {
      const doc = this.editor.doc;
      const scenes = getScenes(doc);
      const from = scenes.find((s) => s.id === sceneId);
      const to = beforeSceneId ? scenes.find((s) => s.id === beforeSceneId) : null;
      if (!from || (beforeSceneId && !to)) return null;

      const block = doc.elements.slice(from.startIndex, from.endIndex + 1);
      const rest = [
        ...doc.elements.slice(0, from.startIndex),
        ...doc.elements.slice(from.endIndex + 1),
      ];

      // Recompute the target position against the array with the block removed.
      let insertAt = beforeSceneId ? rest.findIndex((e) => e.id === beforeSceneId) : rest.length;
      if (insertAt === -1) insertAt = rest.length;

      rest.splice(insertAt, 0, ...block);
      doc.elements = rest;
      return null;
    }, { rebuildVocab: true });

    this.render();
    if (focusDirection) {
      this.host
        .querySelector(`.card[data-scene-id="${sceneId}"] .card-order-button[aria-label="Move scene ${focusDirection}"]`)
        ?.focus();
    }
  }
}
