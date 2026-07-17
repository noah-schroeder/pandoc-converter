'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Output formats. This is the single source of truth for how each user-facing
// format maps to a pandoc writer, a file extension, and any extra flags.
// ---------------------------------------------------------------------------
const FORMATS = {
  docx: { ext: 'docx', to: 'docx', standalone: true },
  // embed: inline images/CSS as data URIs so the .html is self-contained and
  // stays intact when moved away from its source folder (docx/odt/epub already
  // package images internally).
  html: { ext: 'html', to: 'html', standalone: true, embed: true },
  markdown: { ext: 'md', to: 'markdown', standalone: false },
  epub: { ext: 'epub', to: 'epub', standalone: true },
  odt: { ext: 'odt', to: 'odt', standalone: true },
  rtf: { ext: 'rtf', to: 'rtf', standalone: true },
  latex: { ext: 'tex', to: 'latex', standalone: true },
  plain: { ext: 'txt', to: 'plain', standalone: false },
};

// Extensions we treat as LaTeX source (enables citations + project handling).
const LATEX_EXTS = ['.tex', '.latex', '.ltx'];
function isLatexPath(p) {
  return LATEX_EXTS.includes(path.extname(p).toLowerCase());
}

// ---------------------------------------------------------------------------
// Project helpers. An Overleaf/LaTeX "project" is a folder (or a .zip of one)
// containing a main .tex plus \input chapters, a .bib, images, and maybe a
// .csl citation style. To convert it, pandoc must run with its working
// directory set to the project so those relative references resolve.
// ---------------------------------------------------------------------------

// Turn an absolute path into a forward-slashed path relative to `root`, so the
// same label identifies a file whether it came from a zip entry or the disk.
function toLabel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// Shallow-ish recursive file walk, capped so a pathological tree can't hang us.
function walkFiles(root, exts, { maxDepth = 12, maxFiles = 20000 } = {}) {
  const out = [];
  let count = 0;
  const wanted = exts && exts.map((e) => e.toLowerCase());
  function rec(dir, depth) {
    if (depth > maxDepth || count > maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (count++ > maxFiles) return;
      if (e.name === '.git' || e.name === '__MACOSX' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full, depth + 1);
      else if (e.isFile()) {
        if (!wanted || wanted.includes(path.extname(e.name).toLowerCase())) out.push(full);
      }
    }
  }
  rec(root, 0);
  return out;
}

// Strip LaTeX line comments (an unescaped %) so commented-out or prose mentions
// of \begin{document} don't cause false matches.
function stripComments(tex) {
  return tex.replace(/(^|[^\\])%.*$/gm, '$1');
}

const RE_DOCCLASS = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/;
const RE_BEGINDOC = /\\begin\{document\}/;
const RE_INCLUDE = /\\(?:input|include|subfile|subfileinclude)\s*\{([^}]*)\}/g;

// A file is a "main" candidate only if it has BOTH \documentclass and
// \begin{document} (a chapter/fragment has neither). Also record its document
// class and the files it pulls in, so ambiguous projects can be ranked.
function analyzeTex(content) {
  const clean = stripComments(content);
  const dc = clean.match(RE_DOCCLASS);
  const includes = [];
  let m;
  while ((m = RE_INCLUDE.exec(clean))) includes.push(m[1].trim());
  return {
    isMain: !!dc && RE_BEGINDOC.test(clean),
    cls: dc ? dc[1].trim() : '',
    includes,
  };
}

function normIncludeLabel(inc) {
  let p = inc.split('\\').join('/').replace(/^\.\//, '');
  if (!/\.tex$/i.test(p)) p += '.tex';
  return p;
}

// Order main candidates best-first. The real root is the one that is NOT a
// `subfiles` document, is not itself \input by another candidate, pulls other
// files in, and sits shallow with a root-ish name.
const ROOT_NAMES = /^(main|thesis|root|master|dissertation|paper|report|book|manuscript|document)\.tex$/i;
function rankCandidates(cands) {
  const labels = new Set(cands.map((c) => c.label));
  const includedByOther = new Set();
  for (const c of cands) {
    for (const inc of c.includes) {
      const l = normIncludeLabel(inc);
      if (labels.has(l)) includedByOther.add(l);
    }
  }
  const score = (c) => {
    let s = 0;
    if (/\bsubfiles\b/.test(c.cls)) s -= 100;          // a subfile is never the root
    if (includedByOther.has(c.label)) s -= 50;         // included elsewhere → not root
    if (c.includes.length) s += 30;                    // orchestrates other files
    if (ROOT_NAMES.test(c.label.split('/').pop())) s += 20;
    s -= c.label.split('/').length;                    // prefer shallower paths
    return s;
  };
  return [...cands].sort((a, b) => score(b) - score(a));
}

// Ranked main-.tex candidates under `root` (best guess first).
function findMainTexInDir(root) {
  const cands = [];
  for (const f of walkFiles(root, ['.tex'])) {
    try {
      if (fs.statSync(f).size > 5 * 1024 * 1024) continue;
      const info = analyzeTex(fs.readFileSync(f, 'utf8'));
      if (info.isMain) cands.push({ abs: f, label: toLabel(root, f), cls: info.cls, includes: info.includes });
    } catch { /* unreadable file — skip */ }
  }
  return rankCandidates(cands);
}

function findFirstByExt(root, ext) {
  const hits = walkFiles(root, [ext]);
  return hits.length ? hits[0] : null;
}

// Safely extract a zip into destDir, refusing any entry that would escape it
// (zip-slip). Nothing is written if any entry is unsafe.
function extractZipSafe(zipPath, destDir) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const destResolved = path.resolve(destDir);
  for (const entry of zip.getEntries()) {
    const target = path.resolve(destDir, entry.entryName);
    if (target !== destResolved && !target.startsWith(destResolved + path.sep)) {
      throw new Error(`Unsafe path in zip: ${entry.entryName}`);
    }
  }
  zip.extractAllTo(destDir, true);
}

// Inspect a zip's contents in memory (no extraction) to preview the project.
function inspectZip(zipPath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const cands = [];
  let hasBib = false;
  let hasCsl = false;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = e.entryName;
    if (name.startsWith('__MACOSX/')) continue;
    const ext = path.extname(name).toLowerCase();
    if (ext === '.bib') hasBib = true;
    else if (ext === '.csl') hasCsl = true;
    else if (ext === '.tex') {
      let content = '';
      try { content = e.getData().toString('utf8'); } catch { /* skip */ }
      const info = analyzeTex(content);
      if (info.isMain) cands.push({ label: name, cls: info.cls, includes: info.includes });
    }
  }
  const candidates = rankCandidates(cands).map((c) => ({ label: c.label }));
  return { hasBib, hasCsl, candidates };
}

// ---------------------------------------------------------------------------
// Resolve the bundled pandoc binary. Never falls back to a system install, so
// the app cannot depend on anything in the user's environment.
// ---------------------------------------------------------------------------
function pandocPath() {
  const plat = process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'mac' : 'linux';
  const binName = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'pandoc')
    : path.join(__dirname, '..', 'resources', 'pandoc');
  return path.join(base, plat, binName);
}

function ensureExecutable(binPath) {
  if (process.platform === 'win32') return;
  try {
    fs.accessSync(binPath, fs.constants.X_OK);
  } catch {
    try { fs.chmodSync(binPath, 0o755); } catch { /* best effort */ }
  }
}

// A simple form UI needs no GPU; disabling avoids driver-related startup issues
// on the wide range of machines non-technical users may have.
app.disableHardwareAcceleration();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'Pandoc Converter',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keep the app self-contained: no external navigation, no popups.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the window fully quits — on EVERY OS, including macOS. (User requirement.)
app.on('window-all-closed', () => {
  app.quit();
});

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('pick-input-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a file to convert',
    properties: ['openFile'],
    filters: [
      {
        name: 'Documents & LaTeX projects',
        extensions: [
          'docx', 'odt', 'rtf', 'html', 'htm', 'md', 'markdown', 'epub',
          'tex', 'latex', 'ltx', 'txt', 'rst', 'org', 'zip',
        ],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
    dir: path.dirname(filePath),
  };
});

// Pick a whole (already-unzipped) LaTeX project folder.
ipcMain.handle('pick-input-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a LaTeX project folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  return {
    path: dir,
    name: path.basename(dir),
    dir: path.dirname(dir),
    isFolder: true,
  };
});

// Preview what a selection is (LaTeX project? bibliography? multiple mains?)
// without doing any conversion, so the UI can guide the user up front.
ipcMain.handle('inspect-input', async (_e, inputPath) => {
  try {
    if (!inputPath || !fs.existsSync(inputPath)) return { kind: 'unknown' };
    const st = fs.statSync(inputPath);

    if (st.isDirectory()) {
      const candidates = findMainTexInDir(inputPath).map((m) => ({ label: m.label }));
      return {
        kind: 'folder',
        isLatexProject: candidates.length > 0,
        candidates: candidates.length ? candidates : null,
        hasBib: !!findFirstByExt(inputPath, '.bib'),
        hasCsl: !!findFirstByExt(inputPath, '.csl'),
      };
    }

    if (inputPath.toLowerCase().endsWith('.zip')) {
      const { hasBib, hasCsl, candidates } = inspectZip(inputPath);
      return {
        kind: 'zip',
        isLatexProject: candidates.length > 0,
        candidates: candidates.length ? candidates : null,
        hasBib,
        hasCsl,
      };
    }

    // A plain single file. If it's LaTeX, still surface bib/csl sitting next to it.
    if (isLatexPath(inputPath)) {
      const dir = path.dirname(inputPath);
      return {
        kind: 'file',
        isLatexProject: true,
        candidates: null,
        hasBib: !!findFirstByExt(dir, '.bib'),
        hasCsl: !!findFirstByExt(dir, '.csl'),
      };
    }
    return { kind: 'file', isLatexProject: false, candidates: null };
  } catch {
    return { kind: 'unknown' };
  }
});

ipcMain.handle('pick-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to save the converted file',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-folder', async (_e, folder) => {
  if (folder) await shell.openPath(folder);
});

ipcMain.handle('show-item', async (_e, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

// Turn a raw pandoc error into something a non-technical user can act on.
function friendlyError(stderr, code) {
  const raw = (stderr || '').toString().trim();
  const lower = raw.toLowerCase();
  if (lower.includes('cannot decode') || lower.includes('utf-8') || lower.includes('encoding')) {
    return "This file couldn't be read as text. It may be a format that isn't supported as an input.";
  }
  if (lower.includes('permission denied') || lower.includes('openfile')) {
    return "The file or destination folder couldn't be accessed. Check that you have permission to read the file and write to the folder.";
  }
  if (lower.includes('does not exist') || lower.includes('no such file')) {
    return 'The source file could not be found. Please choose it again.';
  }
  if (raw) {
    // Show the first meaningful line of pandoc's own message, trimmed.
    const firstLine = raw.split('\n').find((l) => l.trim()) || raw;
    return firstLine.length > 240 ? firstLine.slice(0, 240) + '…' : firstLine;
  }
  return `Conversion failed (error code ${code ?? 'unknown'}).`;
}

ipcMain.handle('convert', async (_e, payload) => {
  const { inputPath, format, outputFolder, chosenMainTex } = payload || {};

  const spec = FORMATS[format];
  if (!inputPath || !spec) {
    return { ok: false, message: 'Please choose a file and an output format first.' };
  }
  if (!fs.existsSync(inputPath)) {
    return { ok: false, message: 'The source could not be found. Please choose it again.' };
  }

  const bin = pandocPath();
  if (!fs.existsSync(bin)) {
    return {
      ok: false,
      message: 'The bundled converter is missing. Please reinstall the app.',
    };
  }
  ensureExecutable(bin);

  // A temp dir we create for a zip; removed in `finally` so nothing lingers.
  let cleanupDir = null;

  try {
    let kind;
    try {
      kind = fs.statSync(inputPath).isDirectory() ? 'folder'
        : inputPath.toLowerCase().endsWith('.zip') ? 'zip' : 'file';
    } catch {
      return { ok: false, message: 'The source could not be read. Please choose it again.' };
    }

    // Resolve the actual pandoc input, its working directory, and a nice name.
    let mainInput;      // absolute path to the file pandoc reads
    let projectRoot;    // pandoc cwd — makes \input/.bib/images resolve
    let isLatex;
    let projectName;    // basename for the output file

    // Where to look for a project-wide .csl (whole project, not just the main
    // file's folder) so it matches what `inspect` reported to the UI.
    let cslSearchRoot;

    if (kind === 'file') {
      mainInput = inputPath;
      projectRoot = path.dirname(inputPath);
      cslSearchRoot = projectRoot;
      isLatex = isLatexPath(inputPath);
      projectName = path.basename(inputPath, path.extname(inputPath));
    } else {
      let scanRoot;
      if (kind === 'zip') {
        cleanupDir = path.join(
          app.getPath('temp'),
          `pandoc-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        fs.mkdirSync(cleanupDir, { recursive: true });
        try {
          extractZipSafe(inputPath, cleanupDir);
        } catch {
          return { ok: false, message: 'This .zip could not be opened. It may be corrupt or not a real zip file.' };
        }
        scanRoot = cleanupDir;
        projectName = path.basename(inputPath, path.extname(inputPath));
      } else {
        scanRoot = inputPath;
        projectName = path.basename(inputPath);
      }

      const mains = findMainTexInDir(scanRoot);
      if (mains.length === 0) {
        return {
          ok: false,
          message: 'No main LaTeX file was found (a .tex file with \\begin{document}). Make sure this is a LaTeX project.',
        };
      }
      // mains is ranked best-first. With one clear main we use it; with several
      // (e.g. multiple drafts) we never guess silently — the user must confirm.
      let chosen;
      if (mains.length === 1) {
        chosen = mains[0];
      } else {
        chosen = chosenMainTex && mains.find((m) => m.label === chosenMainTex);
        if (!chosen) {
          return {
            ok: false,
            needsMainSelection: true,
            candidates: mains.map((m) => ({ label: m.label })),
            message: 'This project has more than one document that could be the main file. Please choose which one to convert.',
          };
        }
      }
      mainInput = chosen.abs;
      projectRoot = path.dirname(mainInput);
      cslSearchRoot = scanRoot;
      isLatex = true;
    }

    // Output goes to a real location — never the temp extraction dir.
    const folder = outputFolder || (kind === 'folder' ? inputPath : path.dirname(inputPath));
    const outputPath = path.join(folder, `${projectName}.${spec.ext}`);

    if (path.resolve(outputPath) === path.resolve(mainInput)) {
      return {
        ok: false,
        message: 'The converted file would overwrite the original. Choose a different format or folder.',
      };
    }

    // Run pandoc from within the project so relative references resolve.
    const args = [path.basename(mainInput), '-t', spec.to, '-o', outputPath];
    if (spec.standalone) args.push('--standalone');
    if (spec.embed) args.push('--embed-resources');
    if (isLatex) {
      args.push('--citeproc');
      const csl = findFirstByExt(cslSearchRoot, '.csl');
      if (csl) args.push('--csl', csl);
    }

    return await new Promise((resolve) => {
      execFile(bin, args, { cwd: projectRoot, windowsHide: true, timeout: 120000 }, (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, message: friendlyError(stderr, err.code) });
          return;
        }
        resolve({
          ok: true,
          outputPath,
          fileName: path.basename(outputPath),
          folder,
        });
      });
    });
  } finally {
    if (cleanupDir) {
      try { fs.rmSync(cleanupDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
});
