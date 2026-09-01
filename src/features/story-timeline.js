/** Accessible horizontal story map rendered from the live screenplay. */

import { resolveStoryTimeline } from './story.js';

export class StoryTimeline {
  constructor(host, editor, callbacks = {}) {
    this.host = host;
    this.editor = editor;
    this.callbacks = callbacks;
  }

  render() {
    const timeline = resolveStoryTimeline(this.editor.doc, this.editor.pagination);
    this.host.innerHTML = '';
    this.host.appendChild(this.toolbar(timeline));
    if (!timeline.scenes.length) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.textContent = 'Write a scene heading to begin mapping the story.';
      this.host.appendChild(empty);
      this.host.appendChild(this.laneTray(timeline));
      if (timeline.unplacedSections.length || timeline.unplacedBeats.length) {
        this.host.appendChild(this.unplacedTray(timeline));
      }
      return;
    }

    const scroll = document.createElement('div');
    scroll.className = 'story-scroll';
    const grid = document.createElement('div');
    grid.className = 'story-grid';
    grid.style.setProperty('--story-scenes', String(timeline.scenes.length));
    grid.style.minWidth = `${170 + timeline.scenes.length * 170}px`;
    scroll.appendChild(grid);

    grid.appendChild(this.sceneHeader(timeline));
    grid.appendChild(this.sectionRow('Acts', 'act', timeline));
    grid.appendChild(this.sectionRow('Sequences', 'sequence', timeline));
    for (const lane of timeline.lanes) grid.appendChild(this.laneRow(lane, timeline));
    if (timeline.beats.some((beat) => !beat.laneId)) {
      grid.appendChild(this.laneRow(null, timeline));
    }
    this.host.appendChild(scroll);

    if (timeline.unplacedSections.length || timeline.unplacedBeats.length) {
      this.host.appendChild(this.unplacedTray(timeline));
    }
  }

  toolbar(timeline) {
    const bar = document.createElement('div');
    bar.className = 'story-toolbar';
    const title = document.createElement('div');
    title.className = 'story-title';
    title.textContent = `${timeline.scenes.length} scenes · ${timeline.beats.length + timeline.unplacedBeats.length} beats`;
    bar.appendChild(title);
    bar.append(
      control('+ Act', 'Add act', () => this.callbacks.onAddSection?.('act')),
      control('+ Sequence', 'Add sequence', () => this.callbacks.onAddSection?.('sequence')),
      control('+ Lane', 'Add story lane', () => this.callbacks.onAddLane?.()),
      control('+ Beat', 'Add story beat', () => this.callbacks.onAddBeat?.())
    );
    return bar;
  }

  sceneHeader(timeline) {
    const row = storyRow('Scenes / Pages');
    for (const scene of timeline.scenes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'story-scene';
      button.title = scene.heading || 'Untitled scene';
      button.setAttribute(
        'aria-label',
        `Scene ${scene.sceneNumber || scene.index + 1}, page ${scene.page || 'unknown'}: ${scene.heading || 'untitled'}`
      );
      const number = document.createElement('b');
      number.textContent = `SC. ${scene.sceneNumber || scene.index + 1}`;
      const page = document.createElement('span');
      page.textContent = `p. ${scene.page || '—'}`;
      const heading = document.createElement('small');
      heading.textContent = scene.heading || '(untitled scene)';
      button.append(number, page, heading);
      button.addEventListener('click', () => this.callbacks.onJumpToScene?.(scene.id));
      row.appendChild(button);
    }
    return row;
  }

  sectionRow(label, kind, timeline) {
    const row = storyRow(label);
    row.classList.add('story-sections');
    const sections = timeline.sections.filter((section) => section.kind === kind);
    const groups = [];
    for (const section of sections) {
      const group = groups.at(-1);
      if (group?.sceneIndex === section.sceneIndex) group.sections.push(section);
      else groups.push({ sceneIndex: section.sceneIndex, sections: [section] });
    }
    groups.forEach((group, index) => {
      const next = groups[index + 1];
      const stack = document.createElement('div');
      stack.className = 'story-section-stack';
      stack.style.gridColumn = `${group.sceneIndex + 2} / ${next ? next.sceneIndex + 2 : timeline.scenes.length + 2}`;
      for (const section of group.sections) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `story-section ${kind}`;
        chip.dataset.storyId = section.id;
        chip.style.setProperty('--story-color', section.color);
        chip.textContent = section.name;
        chip.title = `${kind === 'act' ? 'Act' : 'Sequence'} beginning at scene ${section.sceneIndex + 1}`;
        chip.addEventListener('click', () => this.callbacks.onEditSection?.(section.id));
        stack.appendChild(chip);
      }
      row.appendChild(stack);
    });
    return row;
  }

  laneRow(lane, timeline) {
    const row = storyRow('');
    row.classList.add('story-lane');
    const label = row.firstElementChild;
    if (lane) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'story-lane-name';
      edit.dataset.storyId = lane.id;
      edit.style.setProperty('--story-color', lane.color);
      edit.textContent = lane.name;
      edit.title = `Edit ${lane.name} lane`;
      edit.addEventListener('click', () => this.callbacks.onEditLane?.(lane.id));
      label.appendChild(edit);
    } else {
      label.textContent = 'Unassigned lane';
    }

    for (const scene of timeline.scenes) {
      const cell = document.createElement('div');
      cell.className = 'story-cell';
      cell.dataset.sceneId = scene.id;
      const beats = timeline.beats.filter(
        (beat) => beat.sceneId === scene.id && (beat.laneId || null) === (lane?.id || null)
      );
      for (const beat of beats) cell.appendChild(this.beatCard(beat));
      row.appendChild(cell);
    }
    return row;
  }

  beatCard(beat) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'story-beat';
    button.dataset.storyId = beat.id;
    button.style.setProperty('--story-color', beat.color);
    button.setAttribute('aria-label', `Edit story beat: ${beat.title}`);
    const title = document.createElement('b');
    title.textContent = beat.title;
    button.appendChild(title);
    if (beat.description) {
      const copy = document.createElement('span');
      copy.textContent = beat.description;
      button.appendChild(copy);
    }
    button.addEventListener('click', () => this.callbacks.onEditBeat?.(beat.id));
    return button;
  }

  laneTray(timeline) {
    const tray = document.createElement('section');
    tray.className = 'story-unplaced story-lane-tray';
    tray.setAttribute('aria-label', 'Story lanes');
    const title = document.createElement('h3');
    title.textContent = 'Story lanes';
    tray.appendChild(title);
    for (const lane of timeline.lanes) {
      const button = control(lane.name, `Edit ${lane.name} lane`, () =>
        this.callbacks.onEditLane?.(lane.id)
      );
      button.dataset.storyId = lane.id;
      button.style.setProperty('--story-color', lane.color);
      tray.appendChild(button);
    }
    return tray;
  }

  focusEntry(id) {
    if (id) {
      const target = [...this.host.querySelectorAll('[data-story-id]')].find(
        (element) => element.dataset.storyId === id
      );
      if (target) {
        target.focus();
        return true;
      }
    }
    return false;
  }

  unplacedTray(timeline) {
    const tray = document.createElement('section');
    tray.className = 'story-unplaced';
    tray.setAttribute('aria-label', 'Unplaced story items');
    const title = document.createElement('h3');
    title.textContent = 'Unplaced';
    tray.appendChild(title);
    for (const section of timeline.unplacedSections) {
      const button = control(
        `${section.kind === 'act' ? 'Act' : 'Sequence'}: ${section.name}`,
        `Place ${section.name}`,
        () => this.callbacks.onEditSection?.(section.id)
      );
      button.dataset.storyId = section.id;
      button.style.setProperty('--story-color', section.color);
      tray.appendChild(button);
    }
    for (const beat of timeline.unplacedBeats) tray.appendChild(this.beatCard(beat));
    return tray;
  }
}

function storyRow(labelText) {
  const row = document.createElement('div');
  row.className = 'story-row';
  const label = document.createElement('div');
  label.className = 'story-row-label';
  label.textContent = labelText;
  row.appendChild(label);
  return row;
}

function control(text, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}
