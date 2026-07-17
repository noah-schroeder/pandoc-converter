# Pandoc Converter

A fully vibe-coded (Claude Opus 4.8) dead-simple desktop app for converting documents, powered by [pandoc](https://pandoc.org).
Built for non-technical users: **choose a file → pick a format → click Convert.**

Why? I got tired of having to manually convert markdown to something libre writer can read. Yea i know about extensions. Didn't want that. Wanted to build this. Because Claude did it. And why not? I'll use it. 

- **Fully standalone** — pandoc is bundled inside the app. Users install nothing else.
- **Fully isolated** — the app never touches or depends on anything in the user's
  system: it uses its own bundled pandoc (never a system install), makes no network
  calls at runtime, changes no PATH or environment, and writes only the output file
  the user picks.
- **Closes completely** — quitting the window fully exits the app on every OS.
- **Cross-platform** — Windows, macOS, and Linux, each with a one-click installer.

Supported output formats: **Word (.docx), Web page (.html), Markdown (.md),
E-book (.epub), OpenDocument (.odt), Rich Text (.rtf), LaTeX (.tex),
Plain text (.txt).**

Input can be any format pandoc reads (Word, Markdown, HTML, **LaTeX `.tex`**, EPUB,
OpenDocument, and more) — just pick the file; the format is detected automatically.

*(Converting **to** PDF is intentionally not included yet — that would require
bundling a large LaTeX engine. Reading and writing LaTeX `.tex` source needs no such
engine, so it is fully supported. See "Adding PDF later" below.)*

---

## For users

Download the installer for your system and run it:

| OS      | File                                  | How to use                     |
| ------- | ------------------------------------- | ------------------------------ |
| Windows | `Pandoc Converter Setup 1.0.0.exe`    | Double-click to install        |
| macOS   | `Pandoc Converter-1.0.0.dmg`          | Open, drag to Applications     |
| Linux   | `Pandoc Converter-1.0.0.AppImage`     | Make executable, double-click  |
| Linux   | `pandoc-converter_1.0.0_amd64.deb`    | `sudo apt install ./…deb`      |

Then: **Choose a file** (or drag it onto the window) → **Convert to** a format →
optionally pick a **Save to** folder → **Convert**. Use **Show file** / **Open
folder** to find your result.

---

## For developers

### Prerequisites
- Node.js 18+ (developed on Node 24) and npm.

### Setup
```bash
npm install
npm run fetch-pandoc      # downloads the pandoc binary for THIS OS into resources/pandoc/
```

### Run in development
```bash
npm start
```

### Build installers
`electron-builder` builds for the OS you run it on:
```bash
npm run dist          # build for the current OS
npm run dist:linux    # AppImage + .deb
npm run dist:win      # NSIS one-click .exe
npm run dist:mac      # .dmg
```
Output lands in `dist/`.

> **Cross-platform note:** pandoc ships as a native, per-OS binary, and
> electron-builder only builds for the OS it runs on (a Mac `.dmg` in particular
> cannot be built on Linux at all). So each installer must be built on its own OS.
>
> **Easiest way to get all of them:** the included GitHub Actions workflow
> ([.github/workflows/build.yml](.github/workflows/build.yml)) builds Windows,
> macOS (Apple Silicon + Intel), and Linux installers on GitHub's runners — no need
> to own a Mac or PC. Push the project to GitHub, open the **Actions** tab, and run
> **Build installers** (or push a tag like `v1.0.0` to also attach them to a
> Release). Download the finished installers from the run's **Artifacts**.

> **Signing note:** the macOS `.dmg` and Windows `.exe` are unsigned. They install
> and run fine for local/testing use, but for warning-free distribution to end
> users you'll want an Apple Developer cert (notarization) and a Windows code-signing
> cert.

### Project layout
```
src/main.js            Electron main process — window, IPC, spawns bundled pandoc
src/preload.js         The only (sandboxed) bridge to the renderer
src/renderer/          The single-screen UI (index.html, styles.css, renderer.js)
scripts/fetch-pandoc.js  Build-time: downloads the pandoc binary per OS
scripts/make-icon.js   Build-time: generates build/icon.png (no external tools)
resources/pandoc/      Bundled pandoc binaries (git-ignored; created by fetch-pandoc)
```

### How isolation is enforced
- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; its only capabilities are the handful of functions in
  `preload.js`.
- Pandoc is invoked by **absolute path** to the bundled binary via `execFile`
  (no shell), so the system PATH/environment is never consulted.
- `window-all-closed → app.quit()` with no macOS exception, so closing the window
  fully terminates the process.

### Adding PDF later
Add a `pdf` entry to the `FORMATS` map in [src/main.js](src/main.js) and bundle a
PDF engine (e.g. TinyTeX for LaTeX-quality output, or an HTML→PDF path). This was
deliberately left out to keep the app small.

### Updating the bundled pandoc version
Change `PANDOC_VERSION` in [scripts/fetch-pandoc.js](scripts/fetch-pandoc.js),
delete `resources/pandoc/`, and re-run `npm run fetch-pandoc`.

---

## License

Licensed under the **GNU General Public License, version 2** — see [LICENSE](LICENSE).

This app bundles [pandoc](https://pandoc.org), which is itself distributed under the
GPL (version 2 or later), so the GPL-2.0 license applies consistently to the whole
package.
