# Changelog

## 1.1.0 - 2026-08-31

### Added

- Deterministic Format Assistant for screenplay structure and printable text
- Alternate Dialogue choices stored with each dialogue element
- Text-anchored production tags, breakdown sidebar, reports, and CSV export
- Revision Room snapshots, draft comparison, change reports, and safe restore
- Story Timeline with acts, sequences, beats, lanes, and unplaced-scene review
- Distraction-free Focus Mode and in-memory timed writing sprints
- Local-only Table Read using voices explicitly marked on-device
- Unicode-capable, searchable, tagged PDF output with embedded local fonts
- Unicode grapheme-aware pagination for combining text, emoji, Indic conjuncts,
  Hangul Jamo, and full-width scripts

### Security and privacy

- Kept all new feature data local to the `.scriptum` document or current session
- Refused remote or unknown speech-synthesis voices and added no microphone path
- Kept PDF rendering local and excluded private notes and production tags
- Removed unused macOS camera, microphone, audio-capture, and Bluetooth package
  declarations and disabled macOS App Transport Security network allowances
- Expanded security, hostile-project, privacy, and real-Electron regression tests
- Made native document saves atomic, serialized concurrent saves, and kept
  newer edits dirty when an older write finishes
- Moved desktop crash recovery to an atomic private app-data file and made
  browser quota failures visible
- Added file-size and model-complexity limits for untrusted imports
- Added signed GitHub build-provenance attestations and packaged
  Electron/Chromium third-party notices

### Accessibility and platforms

- Added a complete browser command menu and three-choice in-app confirmations
- Kept long screenplays complete in the accessibility tree and reserved live
  announcements for explicit events
- Added keyboard region navigation, accessible notes, report tabs and actions,
  and a virtualized Table Read list
- Made the toolbar responsive and retained native system window chrome on
  Windows and Linux

## 1.0.0 - 2026-08-31

- Initial public release
