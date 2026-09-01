# Scriptum

A free, open screenwriting application with real industry-standard formatting.

Built for writers who need professional pages and shouldn't have to pay a
subscription to get them. Nothing is locked, nothing phones home, and the file
format is plain JSON you could read in a text editor if this program vanished
tomorrow.

---

## Running it

```bash
npm install
npm start
```

To try it without Electron, in any Chromium browser:

```bash
python3 tools/serve.py
```

then open `http://localhost:8123`. The browser build is fully functional; it
just uses download links instead of native Save dialogs.

---

## Installing

Download the file for your machine from the
[Releases page](../../releases) and open it.

| Machine | File |
|---|---|
| Mac, Apple Silicon (M1 and later) | `Scriptum-*-arm64.dmg` |
| Mac, Intel | `Scriptum-*-x64.dmg` |
| Windows | `Scriptum-Setup-*.exe` |
| Linux | `Scriptum-*.AppImage` |

### The first-launch warning

These builds do not carry a paid, publicly trusted developer signature. The
macOS build is ad-hoc signed so its bundle can be verified locally, but it is
not signed with an Apple Developer ID or notarized. macOS and Windows will
therefore warn you the first time you open it. This is expected, and it is a
statement about a missing publisher identity, not about the software.

**macOS** — the app is blocked on first open. Go to **System Settings →
Privacy & Security**, scroll to the bottom, and click **Open Anyway** next to
the message about Scriptum. You only do this once.

If you would rather clear it from the terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Scriptum.app
```

On macOS 15 and later, Control-clicking the app and choosing Open no longer
works for this — use System Settings or the command above.

**Windows** — SmartScreen shows "Windows protected your PC". Click **More
info**, then **Run anyway**.

**Linux** — mark the AppImage executable and run it:

```bash
chmod +x Scriptum-*.AppImage && ./Scriptum-*.AppImage
```

### Building it yourself

```bash
npm run dist          # macOS: native Apple Silicon and Intel builds
npm run dist:all      # macOS, Windows and Linux
```

Installers land in `dist/`.

---

## Publishing

### Desktop releases

`.github/workflows/release.yml` builds macOS, Windows and Linux installers and
attaches them to a GitHub Release. It runs on GitHub's free tier for public
repositories.

```bash
npm version minor      # bumps package.json and tags the commit
git push --follow-tags
```

Then watch the Actions tab. When it finishes, the release is published with
every installer attached.

### The browser version

`.github/workflows/pages.yml` publishes `src/` to GitHub Pages on every push to
`main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

This is worth doing. The browser build is fully functional — same formatting
engine, same PDF export — and it needs no download, no install and no account.
For someone on a library computer or a school Chromebook, it is the only
version that will run at all. It costs nothing to host.

The only difference is that it uses the browser's download and file-picker
dialogs instead of native ones, and it keeps crash recovery only in the
current browser tab rather than persistently between browser sessions.

### Privacy

Scriptum has no accounts, analytics, advertising, telemetry, cloud sync or
crash reporting. The desktop app blocks HTTP and HTTPS requests from its own
renderer and does not send screenplay content anywhere. Files and recovery
snapshots stay on the device; the browser version keeps screenplay recovery
in tab-scoped session storage and removes recovery data left by pre-1.0 builds.

The **Privacy** button explains the current storage mode and lets you clear
and disable recovery for the rest of the session. The hosted version is
delivered by GitHub Pages, so GitHub receives the ordinary connection metadata
needed to serve a web page. Read the complete [privacy policy](PRIVACY.md) and
[security policy](SECURITY.md).

### Signing, if you ever want to remove the warnings

- **macOS**: Apple Developer Program, $99/year. Remove the ad-hoc
  `"identity": "-"` setting from `package.json`, add the certificate to the
  repository as `CSC_LINK` and `CSC_KEY_PASSWORD`, set
  `CSC_IDENTITY_AUTO_DISCOVERY` back to `true` in the workflow, and add
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to notarize.
- **Windows**: an OV or EV code-signing certificate, roughly $100–400/year.
- **Linux**: nothing needed.

None of this is required for the software to work. It only removes the
first-launch warning.

### Getting it in front of writers

Once there is a public release, the places screenwriters actually look:
r/Screenwriting, r/Fountain, the Fountain community, Done Deal Pro, and
Stage 32. A Homebrew cask (`brew install --cask scriptum`) becomes possible
once the project has some traction — Homebrew requires a certain level of
notability before accepting a submission.

---

## What it does

### Formatting

Courier 12pt at exactly 10 characters and 6 lines per inch, on US Letter or A4.
Nine element types — Scene Heading, Action, Character, Parenthetical, Dialogue,
Transition, Shot, General, Act Break — each at its standard margin:

| Element | Left | Width |
|---|---|---|
| Scene Heading | 1.5" | 60 characters |
| Action | 1.5" | 60 characters |
| Character | 3.7" | 38 characters |
| Parenthetical | 3.1" | 30 characters |
| Dialogue | 2.5" | 40 characters |
| Transition | flush right to 7.5" | — |

55 lines to a page. Every margin is adjustable in **Format → Element Settings**
if your production wants something different.

### Writing

The keyboard does the formatting so you never reach for a menu mid-scene:

- **Enter** moves to the element that naturally follows — Character after
  Dialogue, Action after a Scene Heading, Dialogue after a cue.
- **Tab** cycles the element type; on a finished character cue it opens a
  parenthetical instead.
- Typing `INT. ` or `EXT. ` promotes the line to a Scene Heading by itself.
- **⌘1–⌘9** set the element type outright.
- Autocomplete offers your characters, your locations, times of day, standard
  transitions, and extensions like `(V.O.)` and `(CONT'D)`.
- Backspace at the start of an element merges it upward.

### Pagination

Page breaks follow production practice, not a word processor's:

- A scene heading is never the last thing on a page.
- A character cue is never orphaned from its dialogue.
- A parenthetical never separates from the speech it modifies.
- Split dialogue gets `(MORE)` at the foot and `NAME (CONT'D)` at the head.
- Action and dialogue keep at least two lines on either side of a break.

Pagination is computed by counting characters rather than measuring rendered
text, so **the page count on screen is the page count in the PDF** — which
matters, because a screenplay is judged by its page count.

### Production

- Scene numbers in either or both margins, lockable so that new scenes take
  letter suffixes (12, 12A, 13) and numbers already sent to a crew never shift.
- Revision sets in the standard colour order (Blue, Pink, Yellow, Green,
  Goldenrod…), with asterisks in the right margin and the revision name in the
  page header.
- Page locking, which turns inserted material into A-pages.
- Omitted scenes.
- Dual dialogue.
- Notes attached to any element.

### Reports

Scene report (with lengths in eighths of a page and cast per scene), character
report (speeches, words, scenes, first and last page), location report, and
overall statistics including interior/exterior and day/night splits. Any of
them exports to CSV.

### Files

| Format | Import | Export |
|---|---|---|
| Scriptum (`.scriptum`) | ✅ | ✅ |
| Final Draft (`.fdx`) | ✅ | ✅ |
| Fountain (`.fountain`) | ✅ | ✅ |
| PDF | — | ✅ |
| Plain text | ✅ | ✅ |

Bold, italic and underline survive every round trip. Dual dialogue, scene
numbers, revision sets and the title page survive FDX round trips.

The PDF writer has no dependencies and embeds no fonts: it uses Courier,
Courier-Bold, Courier-Oblique and Courier-BoldOblique, which every PDF reader
is required to provide and whose metrics are exactly the 10 characters per inch
the format assumes. Output is small and carries no font licensing.

---

## Layout

```
electron/          Main process: window, native menus, file dialogs
  main.cjs
  preload.cjs      The only bridge to the filesystem
src/
  core/
    format.js      Page and element geometry — the single source of truth
    model.js       Document model, element flow, character indexing
    paginate.js    The formatting engine: wrapping, page breaks, MORE/CONT'D
    autocomplete.js
  io/
    pdf.js         Dependency-free PDF 1.4 writer
    fdx.js         Final Draft XML
    fountain.js    Fountain plain text
    project.js     Native format, plain-text export, autosave
  features/
    reports.js  cards.js  find.js
  ui/
    editor.js      Editing surface and every mutation path
    render.js      Paginator output → editable DOM
    dialogs.js
  app.js           Shell: wiring, file commands, sidebar, status bar
test/              Run with `npm test`
tools/serve.py     Static server for the browser build
```

The design decision everything else follows from: **pagination is computed in
character and line units, never by measuring the DOM.** The editor renders each
element at exactly the character width the paginator used, so the browser's own
line breaking lands on the same words, and the screen, the PDF and the plain
text export all agree.

---

## Tests

```bash
npm test          # 69 checks, no Electron needed, runs in about a second
npm run test:app  # launches the real app; takes about half a minute
```

`npm test` covers the native file-access boundary, project-file validation,
line wrapping, page-break rules, MORE/CONT'D splitting, scene numbering and
A-scenes, locked pages and A-pages, Fountain parsing and round-tripping,
reports, and the exact point coordinates and WinAnsi encoding of exported PDF
text.

`npm run test:app` drives a real Electron instance over the DevTools protocol
and asserts that the application can always be quit — with and without unsaved
changes. That is a regression test for a bug that made Scriptum impossible to
quit: Electron treats a cancelled `beforeunload` as a silent, absolute veto
rather than showing a prompt, so the renderer's unsaved-work guard, which is
correct in a browser, made the window refuse to close forever.

---

## Not implemented

Honest list of what Final Draft has that this doesn't:

- Real-time collaboration and cloud sync
- Alt Dialogue (storing alternate takes of a line)
- The full Story Map / Beat Board suite — there is an index-card board and a
  scene navigator, but not the structural timeline
- Script comparison between drafts
- Speech-to-script dictation and table reads
- Production tagging for scheduling software
- Non-Latin alphabets in the **PDF export**. The PDF uses the standard Courier
  faces every reader provides, which cover Western European text — accents,
  curly quotes, dashes and ellipses all come through. Anything outside that
  set (Cyrillic, Greek, Hebrew, Arabic, CJK, emoji) is replaced with `?` in
  the PDF only; the editor, and the `.scriptum`, `.fdx`, `.fountain` and plain
  text exports, are all full Unicode. Fixing it means embedding a font.

Sensible next steps if you want to extend it: bundling Courier Prime (free,
SIL Open Font License) so pages look identical on machines without Courier
New; a draft-comparison view; and a proper structural timeline.

---

## Licence

[MIT](LICENSE). Use it, change it, give it away.
