# Privacy Policy

Last updated: 31 August 2026

Scriptum is designed to work without an account, a server, or a data business.
The application does not collect, transmit, sell, or share personal data or
screenplay content. It contains no analytics, advertising, telemetry, cloud
sync, crash reporting, or tracking code.

Alternate dialogue, production tags, Revision Room snapshots, and Story
Timeline planning are part of the screenplay document. They are saved inside
the local `.scriptum` file and, while work is unsaved, may also be present in
the local crash-recovery copy described below. Scriptum never uploads these
features or their contents.

Focus Mode and writing-sprint progress are session-only. Timer and word-goal
values stay in memory and are discarded when the sprint ends or the app quits.

Table Read uses the browser or operating system speech-synthesis interface but
offers only voices explicitly marked as on-device. Scriptum refuses voices
marked as remote or whose local status is unknown. It does not use the
microphone, record audio, store voice assignments, or upload screenplay text.

PDF export is rendered on the device by the bundled browser engine or the
browser's print system. It may use and embed fonts already installed on the
computer. Scriptum does not download fonts, contact a font service, or send the
screenplay away for conversion. Private notes and production-tag annotations
are not included in screenplay PDF output.

## Desktop application

- Scriptum reads a screenplay only after you choose a file or open a supported
  document, and writes only when you choose Save or an export destination.
- While a document has unsaved changes, Scriptum keeps one crash-recovery copy
  in an atomic file inside the application's private data directory on that
  computer. It is replaced as you
  edit and is deleted after a successful save, an explicit discard, a clean
  quit, or use of **Privacy → Clear & Disable Recovery**. That control also
  keeps recovery off until the app is restarted. An unclaimed recovery copy
  expires and is removed on launch after 14 days.
- The application blocks HTTP and HTTPS requests from its renderer, disables
  Chromium background networking, and has no production network dependency.
  On macOS it may use the operating system's on-device spellchecker. Spellcheck
  is disabled on Windows and Linux to prevent Chromium dictionary downloads.
- The macOS package removes Electron's generic camera, microphone, audio
  capture, and Bluetooth usage declarations. App Transport Security network
  allowances are disabled in addition to Scriptum's cross-platform request
  block and permission denial.
- The single help link to the Fountain syntax reference opens the exact
  `https://fountain.io/syntax` page in your default browser. Scriptum does not
  append screenplay text or other parameters to that URL.

## Browser application

The browser edition performs editing and export locally in the browser. It
does not send screenplay content to GitHub or to a Scriptum server. Unsaved
crash recovery is stored in the current tab's session storage, not persistent
local storage. Closing the tab normally ends that recovery session. Scriptum
also removes screenplay recovery data left in persistent browser storage by
pre-1.0 versions.

Browser spellcheck is disabled because some browsers offer enhanced spelling
services that can transmit typed text. The native macOS application may enable
only the operating system's on-device spellchecker.

The hosted browser edition is delivered by GitHub Pages. GitHub may process
ordinary web-hosting information such as IP address, browser details, request
time, and requested page under its own privacy statement. That hosting data is
controlled by GitHub, not collected by Scriptum's application code. A locally
built desktop copy does not use GitHub Pages.

Scriptum stores a light/dark theme preference in local browser storage. That
preference contains no screenplay content. Scriptum does not set application
cookies.

## Your control

Use the **Privacy** button in Scriptum to see the active recovery-storage mode,
erase recovery data immediately, and keep it disabled until the app or tab is
restarted. You can also clear the site's storage in your browser settings or
remove the desktop application and its local profile.
Your saved screenplay and export files remain wherever you chose to put them
and can be deleted with your operating system's normal file tools.

## Changes and questions

Material changes to this policy will be recorded in this repository. Privacy
questions can be opened as a GitHub issue; do not include private screenplay
content. Security vulnerabilities should instead follow [SECURITY.md](SECURITY.md).
