# Scriptum

## The blank page is hard enough.

Scriptum is a free, open-source screenwriting application that takes care of
the page while you take care of the story.

Industry-standard formatting. Familiar keyboard controls. Professional PDF
export. No subscription, no account, and no one looking over your shoulder.

Your screenplay belongs to you. It stays on your device and is saved in an
open, readable format—not trapped behind a service that may disappear
tomorrow.

[Write in your browser](https://argocine.github.io/Scriptum/) ·
[Download Scriptum](../../releases)

---

## Made for writing

The best formatting is the kind you stop noticing.

Press **Enter** and Scriptum moves naturally from a scene heading to action,
from a character cue to dialogue, and from dialogue back to action. Press
**Tab** to change the element type. Begin with `INT.` or `EXT.` and the page
understands what comes next.

Autocomplete remembers your characters, locations, times of day, transitions,
and extensions such as `(V.O.)` and `(CONT'D)`.

You keep writing. Scriptum keeps the page in order.

The complete keyboard flow:

- **Enter** moves to the element that naturally follows—Character after
  Dialogue, Action after a Scene Heading, Dialogue after a cue.
- **Tab** cycles the element type; on a finished character cue it opens a
  parenthetical instead.
- Typing `INT. ` or `EXT. ` promotes the line to a Scene Heading automatically.
- **⌘1–⌘9** set the element type outright.
- Autocomplete offers characters, locations, times of day, standard
  transitions, and extensions such as `(V.O.)` and `(CONT'D)`.
- Backspace at the start of an element merges it upward.

## A screenplay on screen. The same screenplay on paper.

Scriptum formats in Courier 12pt at exactly 10 characters and 6 lines per
inch, using US Letter or A4 pages. Nine element types—Scene Heading, Action,
Character, Parenthetical, Dialogue, Transition, Shot, General, and Act
Break—each use their standard margins:

| Element | Left | Width |
|---|---|---|
| Scene Heading | 1.5" | 60 characters |
| Action | 1.5" | 60 characters |
| Character | 3.7" | 38 characters |
| Parenthetical | 3.1" | 30 characters |
| Dialogue | 2.5" | 40 characters |
| Transition | flush right to 7.5" | — |

Pages contain 55 lines. Every margin is adjustable in **Format → Element
Settings** when a production needs something different.

Pagination follows screenplay practice:

- Scene headings stay with the action that follows.
- Character cues stay with their dialogue.
- Parentheticals stay with the speech they modify.
- Split dialogue receives `(MORE)` and `(CONT'D)` automatically.
- Action and dialogue keep at least two lines on either side of a page break.

Pagination is computed by counting characters rather than measuring rendered
text. The page count in the editor is the page count in the exported PDF.

## Ready when production is

Scriptum includes the tools a draft needs when it leaves the writer's desk:

- Lockable scene numbers with lettered insertions
- Revision sets in the standard colour order, with revision marks and headers
- Locked pages and A-pages
- Omitted scenes
- Dual dialogue
- Notes attached to individual elements
- Scene, character, location, and statistical reports
- CSV report export

Scene reports include lengths in eighths of a page and cast by scene. Character
reports include speeches, words, scenes, and first and last appearances.
Location reports and overall statistics include interior/exterior and day/night
splits.

## Your script is not our business

Scriptum has no accounts, analytics, advertising, telemetry, cloud sync, or
crash reporting.

The desktop application blocks HTTP and HTTPS requests from its renderer. Your
screenplay and recovery snapshot remain on your device. Recovery can be cleared
or disabled from the **Privacy** panel.

The browser edition keeps recovery data only in the current browser tab.
Because it is delivered through GitHub Pages, GitHub receives the ordinary
connection information required to serve a website. Scriptum does not receive
your screenplay.

Read the complete [privacy policy](PRIVACY.md) and
[security policy](SECURITY.md).

## Your files remain useful—with or without Scriptum

| Format | Import | Export |
|---|---:|---:|
| Scriptum (`.scriptum`) | ✅ | ✅ |
| Final Draft (`.fdx`) | ✅ | ✅ |
| Fountain (`.fountain`) | ✅ | ✅ |
| PDF | — | ✅ |
| Plain text | ✅ | ✅ |

Bold, italic, and underline survive every supported round trip. Dual dialogue,
scene numbers, revision sets, and the title page survive FDX round trips.

The native `.scriptum` format is plain JSON. It can be inspected with an
ordinary text editor and does not depend on a proprietary service.

The PDF writer has no dependencies and embeds no fonts. It uses Courier,
Courier-Bold, Courier-Oblique, and Courier-BoldOblique, which every PDF reader
is required to provide and whose metrics are exactly the 10 characters per
inch the format assumes. Output is small and carries no font licensing.

---

## Installing Scriptum

Download the appropriate installer from the [Releases page](../../releases).

| Machine | File |
|---|---|
| Mac, Apple Silicon (M1 and later) | `Scriptum-*-arm64.dmg` |
| Mac, Intel | `Scriptum-*-x64.dmg` |
| Windows | `Scriptum-Setup-*.exe` |
| Linux | `Scriptum-*.AppImage` |

### First launch

The current builds do not carry a publicly trusted publisher signature. macOS
and Windows will therefore display a warning the first time Scriptum opens.
This indicates that the publisher identity has not been certified; it does not
indicate that the application contains malware.

**macOS:** Open **System Settings → Privacy & Security**, scroll down, and
select **Open Anyway** beside the Scriptum message. This is required only once.

Alternatively:

```bash
xattr -dr com.apple.quarantine /Applications/Scriptum.app
```

On macOS 15 and later, Control-clicking the app and choosing Open no longer
works for this. Use System Settings or the command above.

**Windows:** In the SmartScreen message, select **More info**, followed by
**Run anyway**.

**Linux:**

```bash
chmod +x Scriptum-*.AppImage
./Scriptum-*.AppImage
```

## What Scriptum does not pretend to be

Scriptum does not currently provide:

- Real-time collaboration or cloud sync
- Alternate dialogue storage
- A complete Story Map or Beat Board system (an index-card board and scene
  navigator are included, but not a structural timeline)
- Draft comparison
- Speech-to-script dictation or table reads
- Production tagging for scheduling software
- Non-Latin characters in PDF exports

The editor and `.scriptum`, `.fdx`, `.fountain`, and plain-text files support
full Unicode. PDF export currently uses the standard Courier faces and
supports Western European text, including accents, curly quotes, dashes, and
ellipses. Unsupported characters are replaced with `?` in the PDF only.

No vague promises. No feature list written by the advertising department.
Just the application as it exists today.

## Built in the open

Scriptum is open source, licensed under MIT, and developed in public. We're
continually working on new features, refinements, and fixes.

If something would make Scriptum better for the way you write, tell us.
[Open an issue](../../issues) with a suggestion or a bug report. Thoughtful
pull requests are welcome too.

Good software gets better when the people using it have a say.

---

## For developers

### Running it

```bash
npm install
npm start
```

To run Scriptum without Electron, use any Chromium browser:

```bash
python3 tools/serve.py
```

Then open `http://localhost:8123`. The browser build is fully functional; it
uses download links instead of native Save dialogs.

### Building it yourself

```bash
npm run dist          # macOS: native Apple Silicon and Intel builds
npm run dist:all      # macOS, Windows and Linux
```

Installers are written to `dist/`.

### Publishing desktop releases

`.github/workflows/release.yml` builds macOS, Windows, and Linux installers and
attaches them to a GitHub Release. It runs on GitHub's free tier for public
repositories.

```bash
npm version minor      # bumps package.json and tags the commit
git push --follow-tags
```

The release is published with every installer attached when the workflow
finishes.

### Publishing the browser version

`.github/workflows/pages.yml` publishes `src/` to GitHub Pages on every push to
`main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

The browser build uses the same formatting engine and PDF exporter as the
desktop application. It uses the browser's download and file-picker dialogs
instead of native dialogs, and keeps crash recovery in the current browser tab
rather than persistently between browser sessions.

### Code signing

The current release uses an ad-hoc signature on macOS and has no publicly
trusted publisher signature on Windows.

- **macOS:** Join the Apple Developer Program, remove the ad-hoc
  `"identity": "-"` setting from `package.json`, add the certificate as the
  `CSC_LINK` and `CSC_KEY_PASSWORD` repository secrets, set
  `CSC_IDENTITY_AUTO_DISCOVERY` to `true`, and provide notarization credentials.
- **Windows:** Configure a publicly trusted Authenticode code-signing service
  or certificate. Scriptum may qualify for the free open-source program
  provided by SignPath Foundation.
- **Linux:** No platform code-signing certificate is required.

Code signing is not required for the software to function. It removes the
first-launch publisher warning and allows users to verify the publisher and
integrity of the downloaded application.

### Layout

```text
electron/          Main process: window, native menus, file dialogs
  main.cjs
  preload.cjs      The only bridge to the filesystem
src/
  core/
    format.js      Page and element geometry—the single source of truth
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

Pagination is computed in character and line units, never by measuring the
DOM. The editor renders each element at exactly the character width used by the
paginator. Browser line breaking therefore lands on the same words, keeping
the editor, PDF, and plain-text export in agreement.

### Tests

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
and verifies that the application can always be quit, with and without unsaved
changes. This guards against regressions in Electron's cancelled
`beforeunload` behavior.

## Licence

[MIT](LICENSE). Use it. Change it. Give it away.
