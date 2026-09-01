# Scriptum Roadmap

This roadmap records product direction, not a release promise. A feature is
available only when it appears in the changelog for a published release.

## Status

| Area | Status | Release |
|---|---|---|
| Writer's Tools: Format Assistant, Focus Mode, writing sprints, Alternate Dialogue | Complete | 1.1.0 |
| Revision Room: local snapshots, comparison, reports, safe restore | Complete | 1.1.0 |
| Production: tagging, breakdown reports, revision output | Complete | 1.1.0 |
| Story Timeline: acts, sequences, lanes, scene-linked and unplaced beats | Complete | 1.1.0 |
| Story Studio: freeform Beat Board and Board-to-Timeline-to-Pages workflow | **Pending** | 2.0 candidate |

## Story Studio 2.0

**Status: Pending — specification only.**

Scriptum 1.1 includes a dependable scene-based Story Timeline and Index Card
board. Story Studio will build on that foundation. It is not considered
complete until writers can develop ideas as independent beats, arrange those
beats visually, place them in the screenplay's structure, and deliberately
turn them into pages without copying and pasting.

No release date is assigned. Until the acceptance criteria below are met, the
shipping feature remains named **Story Timeline**, not Story Studio.

### Product principles

- Keep every beat local to the native `.scriptum` project. Do not add accounts,
  telemetry, remote services, or network-dependent behavior.
- Treat an unplaced beat as valid work. A beat must not require a scene, lane,
  act, sequence, or page position.
- Make structural edits reversible through the existing undo and Revision Room
  systems.
- Keep beat-to-page operations explicit and non-destructive. Editing a beat
  must never silently rewrite screenplay text, and unlinking a beat must never
  delete its scene.
- Provide keyboard and assistive-technology equivalents for every pointer
  operation, including moving, resizing, selecting, and assigning beats.
- Preserve complete Story Studio data in `.scriptum`. Warn before exporting to
  an interchange format that cannot carry it.

### Target workflow

1. Capture an idea as a beat without creating a scene.
2. Arrange and group beats on a freeform Beat Board.
3. Assign beats to acts, sequences, story lanes, and optional screenplay
   scenes.
4. Refine scene order and parallel story lines in the structural Timeline.
5. Convert selected beats into a reviewed screenplay scaffold or link them to
   existing scenes.
6. Continue rearranging scenes without breaking stable beat and scene links.

### Implementation order

#### 1. Data model and migration

- Extend the story schema with bounded, finite board coordinates and dimensions
  for beats and structural markers.
- Retain the existing stable beat, lane, section, and scene identifiers.
- Define deterministic ordering for overlapping beats and multi-beat
  conversion.
- Migrate existing Timeline beats into a readable automatic board layout.
- Continue opening native format versions 1 and 2. Reject unsupported future
  schemas and malformed or oversized board data with clear errors.
- Add fixtures proving that save/open, cloning, undo, recovery, and Revision
  Room snapshots preserve the new data without aliasing or silent loss.

**Gate:** Existing 1.1 projects open with the same screenplay and Story
Timeline content, and a save/open round trip produces a stable Story Studio
layout.

#### 2. Shared interaction commands

- Move story mutations out of individual views into reusable, deterministic
  commands.
- Add single- and multi-selection, duplicate, delete, move, resize, reorder,
  link, unlink, and assignment commands.
- Route every mutation through the editor transaction system so one user action
  is one undoable operation.
- Implement pointer drag-and-drop and documented keyboard movement using the
  same commands.
- Announce completed moves and invalid destinations without making the canvas
  excessively noisy for screen readers.

**Gate:** Every pointer operation has a keyboard path, is undoable, and has
model-level tests independent of the rendered view.

#### 3. Freeform Beat Board

- Add a dedicated **Beat Board** beside the existing **Scene Cards** and
  **Timeline** views.
- Support inline creation and editing, free placement, resizing, colour,
  duplication, multi-selection, and group movement.
- Add zoom, pan, zoom-to-fit, and a command to restore a readable automatic
  layout.
- Allow optional act, sequence, and lane assignment without requiring a scene
  link.
- Provide list or structured fallback navigation so the same content remains
  operable without spatial interaction.
- Preserve the viewport as a preference while keeping screenplay content and
  board layout inside the project.

**Gate:** A writer can outline a feature using beats alone, close and reopen the
project, and recover the same content and layout using either pointer or
keyboard controls.

#### 4. Structural Timeline upgrade

- Add drag-and-drop and keyboard reassignment between scenes and lanes.
- Add explicit ordering for multiple beats in one scene/lane cell.
- Make act and sequence boundaries movable, with their scope visible before a
  move is committed.
- Add lane collapse, lane reordering, filters, text search, and zoom-to-fit for
  long screenplays.
- Keep unplaced and filtered-out work discoverable; filtering must never look
  like deletion.
- Keep scene cards and Timeline entries attached through stable identifiers
  when scenes move.

**Gate:** A screenplay with at least 150 scenes and several parallel lanes can
be navigated and reorganized without losing beats, links, or keyboard focus.

#### 5. Board-to-Pages bridge

- Allow a beat to link to an existing scene without changing either one's
  text.
- Provide **Create Scene from Beat** with a preview of the scene heading,
  synopsis, optional action text, and insertion point.
- Allow an ordered selection of beats to create a screenplay scaffold in one
  reviewed, undoable transaction.
- Keep the originating beats and link them to the new scenes after conversion.
- Make subsequent synchronization explicit. Offer suggested updates for review;
  do not automatically overwrite a scene or beat.
- Define safe behavior for omitted, deleted, duplicated, and imported scenes,
  including a visible unlinked state.

**Gate:** A writer can move from independent beats to editable screenplay
scenes and reverse the transaction without orphaning, duplicating, or silently
rewriting material.

#### 6. Output and interchange

- Add a local outline report containing acts, sequences, lanes, beats, scene
  links, and page references.
- Add printable Beat Board and Timeline views whose output excludes private
  notes unless the writer explicitly includes them.
- Preserve full fidelity in `.scriptum` and keep existing FDX and Fountain
  warnings wherever Story Studio data would be omitted.
- Do not invent undocumented interchange fields. Any future mapping must be
  based on a documented format and covered by round-trip fixtures.

**Gate:** Native export is lossless, lossy exports are disclosed before the
file is written, and all output is generated locally.

#### 7. Hardening and release

- Add model, migration, hostile-project, DOM interaction, keyboard,
  accessibility, and real-Electron tests.
- Exercise empty projects and limits of 300 scenes, 40 lanes, 100 structural
  sections, and 2,000 beats.
- Verify undo/redo, crash recovery, safe quit, Revision Room restore, and
  cross-platform save/open behavior after board operations.
- Confirm that rendered titles and descriptions use text nodes and cannot
  inject HTML or script.
- Run the complete unit and real-app suites on macOS, Windows, and Linux.
- Conduct hands-on outlining sessions with short, feature-length, and
  multi-lane sample projects before changing the public feature name.

**Gate:** No known data-loss, privacy, security, critical accessibility, or
release-blocking usability defect remains.

### Definition of done

Story Studio 2.0 is complete only when all of the following are true:

- The target workflow can be completed without manual copying and pasting.
- Beat Board, Timeline, Scene Cards, and screenplay pages share stable links.
- Pointer, keyboard, and assistive-technology workflows reach the same actions.
- Existing projects migrate automatically and can be safely restored.
- Native save/open is lossless and lossy interchange is clearly disclosed.
- All processing remains local and the network-denial security model is
  unchanged.
- The complete automated test matrix passes and hands-on usability testing has
  been recorded.
- User documentation, privacy documentation, file-format notes, and the
  changelog describe the shipped behavior accurately.

### Out of scope

Story Studio 2.0 does not include cloud synchronization, real-time
collaboration, generative writing, analytics, production scheduling, or
budgeting. Those capabilities require separate product and privacy decisions
and are not implied by this roadmap.

