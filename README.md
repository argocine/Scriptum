# Scriptum

## The blank page is hard enough.

Scriptum is a free, open-source screenwriting application that takes care of
the page while you take care of the story.

No subscription. No account. No advertising. No one looking over your
shoulder. Your screenplay stays on your device in an open, readable format.

[Write in your browser](https://argocine.github.io/Scriptum/) ·
[Download the desktop app](https://github.com/argocine/Scriptum/releases/latest) ·
[Suggest a feature](https://github.com/argocine/Scriptum/issues)

---

## Made for the way writers work

The best formatting is the kind you stop noticing.

Press **Enter** and Scriptum moves naturally from scene heading to action, from
character to dialogue, and back again. Press **Tab** to change the element.
Begin with `INT.` or `EXT.` and the page understands what comes next.

Autocomplete remembers characters, locations, times of day, transitions, and
extensions such as `(V.O.)` and `(CONT'D)`. The Format Assistant catches
structural mistakes without offering opinions about spelling, style, or taste.

The complete writing flow includes:

- Industry-standard Scene Heading, Action, Character, Parenthetical, Dialogue,
  Transition, Shot, General, and Act Break elements
- **Enter**, **Tab**, and **Ctrl/⌘ + 1–9** keyboard formatting
- Character, location, time-of-day, transition, and extension autocomplete
- Bold, italic, underline, dual dialogue, notes, and omitted scenes
- Find and replace, scene navigation, word count, runtime, and page count
- US Letter and A4 pages with adjustable element and page geometry

## Keep every good idea

A rewrite should not require an archaeological expedition through old files.

- **Alternate Dialogue** keeps several versions of a line inside one dialogue
  element and prints only the version currently selected.
- **Revision Room** creates named, immutable snapshots, compares drafts, and
  restores an earlier state only after making a safety snapshot of the present.
- **Revision Sets** provide the standard colour sequence, headers, marks, locked
  pages, A-pages, and locked scene numbers with lettered insertions.

## See the story before it sees an audience

The Index Card board and **Story Timeline** put structure beside the pages,
where it belongs. Organize acts and sequences, create colour-coded story lanes,
place beats against scenes, and find work that has not yet found its place.

Cards, beats, lanes, snapshots, and dialogue alternatives stay attached to
stable screenplay identifiers when scenes move. They are saved in the native
`.scriptum` document—not in a separate account or service.

## Ready when production is

Scriptum follows the draft beyond the writer's desk:

- Tag selected text with production categories and reusable breakdown items
- Browse the live breakdown by scene and export clean CSV reports
- Generate scene, character, location, statistics, and revision-change reports
- Lock scene and page numbering without renumbering material already distributed
- Print revision marks, revision headers, scene numbers, dual dialogue, and a
  professional title page

Production tags and private notes help you work; they are not printed into the
screenplay PDF.

## A quieter room to finish the work

**Focus Mode** removes the surrounding interface while keeping the screenplay
and an optional writing sprint in view. Sprints track elapsed time and net new
words in memory only; they are not written into the project file.

**Table Read** reads action and dialogue aloud with voices the operating system
or browser explicitly marks as on-device. Scriptum refuses remote or unknown
voices. It never turns on the microphone and never records audio.

## The page you see is the page you send

Pagination is calculated in screenplay lines and monospaced character cells:

- 12-point type at 10 Latin character cells and 6 lines per inch
- 55 body lines on the default page
- Scene headings stay with the following action
- Character cues and parentheticals stay with their dialogue
- Split dialogue receives `(MORE)` and `(CONT'D)` automatically
- Action and dialogue keep at least two lines on either side of a page break

PDF export is rendered locally by Chromium from the same pagination model.
It includes open-licensed Noto fallback fonts for Latin, Cyrillic, CJK,
Devanagari, Arabic, and Hebrew text, embeds the fonts it uses, and produces
searchable tagged output. Other scripts and emoji can use fonts already
installed on the computer. Scriptum never downloads a font or sends text to a
font service.

## Your script is not our business

Scriptum has no accounts, analytics, advertising, telemetry, cloud sync, or
crash-reporting service.

The desktop renderer is sandboxed, has no Node.js access, denies system
permissions, and blocks HTTP and HTTPS traffic. Files can be read or written
only after you choose them in a system dialog. The sole help link opens the
exact Fountain syntax page in your normal browser without adding screenplay
text or query parameters.

Unsaved desktop work has one local recovery copy. It is removed after a clean
save, discard, or quit and can be erased or disabled from **Privacy**. The
browser edition keeps recovery in the current tab rather than persistent site
storage. Theme preference is the only non-screenplay browser preference kept
between sessions.

The hosted edition is delivered by GitHub Pages, so GitHub receives the normal
connection information needed to serve a website. Scriptum's application code
does not receive or transmit the screenplay.

Read the complete [privacy policy](PRIVACY.md) and
[security policy](SECURITY.md).

## Files that remain yours

| Format | Import | Export | What it carries |
|---|:---:|:---:|---|
| Scriptum (`.scriptum`) | Yes | Yes | Full-fidelity document, including Scriptum-only planning and production data |
| Final Draft (`.fdx`) | Yes | Yes | Screenplay text and supported formatting/interchange metadata |
| Fountain (`.fountain`, `.spmd`) | Yes | Yes | Screenplay text, inline emphasis, notes, scene numbers, and dual-dialogue syntax |
| Plain text (`.txt`) | Yes | Yes | Readable screenplay text without rich project metadata |
| PDF | No | Yes | Visible screenplay and title page as searchable, tagged output |

Final Draft and Fountain do not carry Alternate Dialogue choices, production
tags, Revision Room history, or Story Timeline data. Scriptum warns before such
an export. Save as `.scriptum` first to preserve the complete project.

The native format is unobfuscated JSON. It can be inspected with an ordinary
text editor and does not depend on Scriptum continuing to exist.
Scriptum 1.1 writes native format version 2; those files require Scriptum 1.1
or newer, while Scriptum 1.1 continues to open version 1 projects.

---

## Installing Scriptum

Download the file for your machine from the
[Releases page](https://github.com/argocine/Scriptum/releases/latest).

| Machine | Download |
|---|---|
| Mac, Apple Silicon (M1 or later) | `Scriptum-*-arm64.dmg` |
| Mac, Intel | `Scriptum-*-x64.dmg` |
| Windows, 64-bit Intel/AMD | `Scriptum-Setup-*-x64.exe` |
| Linux, 64-bit Intel/AMD | `Scriptum-*-x64.AppImage` or `Scriptum-*-x64.deb` |

The macOS desktop build requires macOS 13 or later. The Apple Silicon download
contains a native `arm64` application; it is not an Intel build running through
Rosetta.

### First launch and publisher warnings

Current macOS builds are ad-hoc signed but not Apple-notarized. Windows builds
do not have a publicly trusted publisher certificate. The operating system
therefore displays a first-launch warning.

- **macOS:** Move Scriptum to Applications, try to open it once, then use
  **System Settings → Privacy & Security → Open Anyway** and confirm.
- **Windows:** In Microsoft Defender SmartScreen, choose **More info**, verify
  that the file came from this repository, then choose **Run anyway**.
- **Linux:** Mark the AppImage executable with
  `chmod +x Scriptum-*-x64.AppImage`, then run it. For Debian or Ubuntu, use
  `sudo apt install ./Scriptum-*-x64.deb`.

Every release includes `SHA256SUMS.txt`. Compare a download before opening it
when chain-of-custody matters. Releases also have signed GitHub build-provenance
attestations; verify one with
`gh attestation verify FILE --repo argocine/Scriptum`. Building from the tagged
source remains the most independently inspectable option.

On macOS or Linux, place the download beside `SHA256SUMS.txt` and run
`shasum -a 256 -c SHA256SUMS.txt`. On Windows, run
`Get-FileHash .\Scriptum-Setup-*-x64.exe -Algorithm SHA256` in PowerShell and
compare the result with the matching checksum entry.

## What Scriptum does not do

Scriptum does not provide real-time collaboration, cloud sync, an online
screenplay account, speech-to-script dictation, or scheduling/budgeting-system
integration. FDX, Fountain, CSV, and plain text are the interchange paths.

Those limits are deliberate facts, not fine print.

## Built in the open

Scriptum is MIT-licensed free software, developed in public, and continually
improved with new features, refinements, and fixes.

If something would make Scriptum better for the way you write,
[open an issue](https://github.com/argocine/Scriptum/issues). Suggestions, bug
reports, accessibility feedback, translations, and thoughtful pull requests
are welcome.

Good software gets better when the people using it have a say.

---

## For developers

### Run and test

Development requires Node.js 22.12.0 or newer.

```bash
npm ci
npm start
npm test
npm run test:app
```

`npm test` runs the deterministic model, parser, pagination, privacy, security,
feature, and PDF-model suites. `npm run test:app` launches real Electron
instances to verify quit safety and produce an actual Unicode PDF; when Poppler
tools are available it also checks extracted text, page count, and embedded
fonts. The CI matrix runs these checks on macOS, Windows, and Linux.

Run the browser edition locally with:

```bash
python3 tools/serve.py
```

Then open `http://localhost:8123`. Ordinary saves become browser downloads;
PDF export uses the browser's system print dialog; crash recovery remains in
the current tab.

### Build

```bash
npm run dist          # macOS: separate native arm64 and x64 builds
npm run dist:all      # macOS, Windows, and Linux targets
```

Installers are written to `dist/`. The macOS packaging hook removes Electron's
unused capture-capability descriptions and disables App Transport Security
network allowances before the app is signed.

`dist:all` is a convenience command and cross-building requires the host tools
documented by electron-builder (including Wine for some Windows targets and
Linux packaging tools for DEB/AppImage). The pinned GitHub Actions release
workflow is the supported way to produce the complete public matrix.

### Architecture

```text
electron/           main process, native menus, file capabilities, preload bridge
build/              icons, entitlements, and package-hardening hook
src/core/           document model, Unicode cells, formatting, pagination
src/features/       cards, timeline, snapshots, tags, reports, sprints, table read
src/io/             Scriptum, FDX, Fountain, text, and local PDF output
src/ui/             editor renderer and accessible dialogs
src/app.js          application shell and command wiring
test/               deterministic and real-Electron regression suites
```

The Electron renderer uses context isolation, Chromium sandboxing, no Node
integration, a restrictive CSP, denied permissions, blocked renderer network
requests, exact-path file grants, ASAR integrity, and restrictive Electron
fuses. Project files are treated as untrusted input and normalized before use.

### Releases

Pushing a version tag such as `v1.1.0` runs the release workflow on macOS,
Windows, and Linux, tests every target, builds the installers, generates
`SHA256SUMS.txt`, signs build-provenance attestations, and creates the GitHub
Release. The workflow rejects tags that do not exactly match `package.json` or
whose commit is not on `main`. Pushing to `main` publishes the static browser
edition through GitHub Pages.

Paid Apple Developer ID/notarization and Windows Authenticode certificates are
not currently configured. See [SECURITY.md](SECURITY.md) for the resulting
authenticity limits.

## License

[MIT](LICENSE). Use it. Change it. Give it away.
