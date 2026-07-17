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
  html: { ext: 'html', to: 'html', standalone: true },
  markdown: { ext: 'md', to: 'markdown', standalone: false },
  epub: { ext: 'epub', to: 'epub', standalone: true },
  odt: { ext: 'odt', to: 'odt', standalone: true },
  rtf: { ext: 'rtf', to: 'rtf', standalone: true },
  latex: { ext: 'tex', to: 'latex', standalone: true },
  plain: { ext: 'txt', to: 'plain', standalone: false },
};

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
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
    dir: path.dirname(filePath),
  };
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
  const { inputPath, format, outputFolder } = payload || {};

  const spec = FORMATS[format];
  if (!inputPath || !spec) {
    return { ok: false, message: 'Please choose a file and an output format first.' };
  }
  if (!fs.existsSync(inputPath)) {
    return { ok: false, message: 'The source file could not be found. Please choose it again.' };
  }

  const bin = pandocPath();
  if (!fs.existsSync(bin)) {
    return {
      ok: false,
      message: 'The bundled converter is missing. Please reinstall the app.',
    };
  }
  ensureExecutable(bin);

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const folder = outputFolder || path.dirname(inputPath);
  const outputPath = path.join(folder, `${baseName}.${spec.ext}`);

  if (path.resolve(outputPath) === path.resolve(inputPath)) {
    return {
      ok: false,
      message: 'The converted file would overwrite the original. Choose a different format or folder.',
    };
  }

  const args = [inputPath, '-t', spec.to, '-o', outputPath];
  if (spec.standalone) args.push('--standalone');

  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, timeout: 120000 }, (err, _stdout, stderr) => {
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
});
