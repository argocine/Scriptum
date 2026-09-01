# Privacy Policy

Last updated: 31 August 2026

Scriptum is designed to work without an account, a server, or a data business.
The application does not collect, transmit, sell, or share personal data or
screenplay content. It contains no analytics, advertising, telemetry, cloud
sync, crash reporting, or tracking code.

## Desktop application

- Scriptum reads a screenplay only after you choose a file or open a supported
  document, and writes only when you choose Save or an export destination.
- While a document has unsaved changes, Scriptum keeps one crash-recovery copy
  in the application's local storage on that computer. It is replaced as you
  edit and is deleted after a successful save, an explicit discard, a clean
  quit, or use of **Privacy → Clear & Disable Recovery**. That control also
  keeps recovery off until the app is restarted. An unclaimed recovery copy
  expires and is removed on launch after 14 days.
- The application blocks HTTP and HTTPS requests from its renderer, disables
  Chromium background networking, and has no production network dependency.
  On macOS it may use the operating system's on-device spellchecker. Spellcheck
  is disabled on Windows and Linux to prevent Chromium dictionary downloads.
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
