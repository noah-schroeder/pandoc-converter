# Changelog

All notable changes to Pandoc Converter are documented here. This project adheres
to [Semantic Versioning](https://semver.org).

## [1.1.0] — 2026-07-17

### Added
- **LaTeX / Overleaf project conversion.** Convert a whole project, not just a
  single file: **drop the `.zip`** you download from Overleaf (*Menu → Download →
  Source*) or click **Choose a folder** for an already-unzipped project.
- **Automatic main-file detection.** The app finds the main document (the `.tex`
  containing `\documentclass` + `\begin{document}`) — it can have any name, not
  just `main.tex`. `\input`/`\include` chapters and images are pulled in and
  resolved automatically.
- **Citations & bibliographies.** Via pandoc's `--citeproc`, `\cite{…}` becomes
  formatted in-text citations plus a generated references list. Both biblatex
  (`\addbibresource`) and classic BibTeX (`\bibliography{…}`) are supported.
- **Citation styles.** If a `.csl` file is included in the project, it is applied
  automatically; otherwise pandoc's default style is used.
- **Multiple-document prompt.** If a project contains more than one file that could
  be the main document (e.g. several drafts), the app asks which to convert rather
  than guessing, with the most likely candidate marked *(likely)*.
- **Self-contained HTML.** HTML output now inlines images and styles
  (`--embed-resources`), so a converted web page stays intact when moved.

### Changed
- The file picker now accepts `.zip`, `.tex`, and project folders in addition to
  single documents.

### Security
- Project `.zip` files are extracted only to a temporary directory (removed after
  each conversion) with a **zip-slip guard** that refuses any entry attempting to
  write outside that directory.

### Notes
- Pandoc is not a full LaTeX engine: TikZ drawings, exotic packages, and heavy
  custom macros may be dropped or approximated. Standard papers and theses
  (sections, figures, tables, math, citations) convert cleanly.

## [1.0.0]

### Added
- Initial release: a simple, standalone, cross-platform document converter powered
  by a bundled copy of [pandoc](https://pandoc.org).
- One-click conversion — choose a file, pick a format, convert.
- Output formats: Word (`.docx`), Web page (`.html`), Markdown (`.md`), E-book
  (`.epub`), OpenDocument (`.odt`), Rich Text (`.rtf`), LaTeX (`.tex`), and Plain
  text (`.txt`); input format detected automatically.
- Drag-and-drop, light/dark theme, and per-OS installers (Windows NSIS, macOS
  `.dmg`, Linux AppImage + `.deb`).
- Fully isolated: uses its own bundled pandoc, makes no network calls at runtime,
  and quitting the window fully closes the app on every OS.

[1.1.0]: https://github.com/noah-schroeder/pandoc-converter/releases/tag/v1.1.0
[1.0.0]: https://github.com/noah-schroeder/pandoc-converter/releases/tag/v1.0.0
