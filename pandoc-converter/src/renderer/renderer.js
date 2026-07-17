'use strict';

// State
let inputFile = null;      // { path, name, dir }
let outputFolder = null;   // chosen folder, or null = "same as file"

// Elements
const pickFileBtn = document.getElementById('pick-file');
const fileboxEmpty = document.getElementById('filebox-empty');
const fileboxFilled = document.getElementById('filebox-filled');
const fileNameEl = document.getElementById('file-name');
const formatEl = document.getElementById('format');
const pickFolderBtn = document.getElementById('pick-folder');
const folderPathEl = document.getElementById('folder-path');
const convertBtn = document.getElementById('convert');
const convertLabel = convertBtn.querySelector('.convert-label');
const spinner = convertBtn.querySelector('.spinner');
const resultEl = document.getElementById('result');
const dropHint = document.getElementById('drop-hint');

let busy = false;

function setInputFile(file) {
  inputFile = file;
  if (file) {
    fileNameEl.textContent = file.name;
    fileNameEl.title = file.path;
    fileboxEmpty.hidden = true;
    fileboxFilled.hidden = false;
  } else {
    fileboxEmpty.hidden = false;
    fileboxFilled.hidden = true;
  }
  updateFolderLabel();
  updateConvertState();
}

function updateFolderLabel() {
  if (outputFolder) {
    folderPathEl.textContent = outputFolder;
    folderPathEl.title = outputFolder;
    folderPathEl.classList.remove('is-default');
  } else {
    folderPathEl.textContent = 'Same folder as your file';
    folderPathEl.removeAttribute('title');
    folderPathEl.classList.add('is-default');
  }
}

function updateConvertState() {
  convertBtn.disabled = busy || !inputFile;
}

function clearResult() {
  resultEl.hidden = true;
  resultEl.className = 'result';
  resultEl.innerHTML = '';
}

// ---- File selection ----
pickFileBtn.addEventListener('click', async () => {
  if (busy) return;
  const file = await window.api.pickInputFile();
  if (file) {
    setInputFile(file);
    clearResult();
  }
});

pickFolderBtn.addEventListener('click', async () => {
  if (busy) return;
  const folder = await window.api.pickOutputFolder();
  if (folder) {
    outputFolder = folder;
    updateFolderLabel();
  }
});

formatEl.addEventListener('change', clearResult);

// ---- Drag and drop ----
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (busy) return;
  dragDepth++;
  dropHint.classList.add('active');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropHint.classList.remove('active');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropHint.classList.remove('active');
  if (busy) return;
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  const fullPath = window.api.getPathForFile(f);
  if (!fullPath) return;
  const name = fullPath.split(/[\\/]/).pop();
  const dir = fullPath.slice(0, fullPath.length - name.length - 1);
  setInputFile({ path: fullPath, name, dir });
  clearResult();
});

// ---- Convert ----
function setBusy(state) {
  busy = state;
  convertBtn.classList.toggle('is-busy', state);
  spinner.hidden = !state;
  convertLabel.textContent = state ? 'Converting…' : 'Convert';
  updateConvertState();
}

convertBtn.addEventListener('click', async () => {
  if (busy || !inputFile) return;
  clearResult();
  setBusy(true);
  try {
    const res = await window.api.convert({
      inputPath: inputFile.path,
      format: formatEl.value,
      outputFolder,
    });
    showResult(res);
  } catch (err) {
    showResult({ ok: false, message: 'Something went wrong. Please try again.' });
  } finally {
    setBusy(false);
  }
});

function showResult(res) {
  resultEl.hidden = false;
  if (res && res.ok) {
    resultEl.className = 'result success';
    resultEl.innerHTML = `
      <div class="result-title">✓ Done!</div>
      <div class="result-detail">Saved <strong></strong></div>
      <div class="result-actions">
        <button class="result-btn primary" id="res-show">Show file</button>
        <button class="result-btn" id="res-open">Open folder</button>
      </div>`;
    resultEl.querySelector('strong').textContent = res.fileName;
    document.getElementById('res-show').addEventListener('click', () => window.api.showItem(res.outputPath));
    document.getElementById('res-open').addEventListener('click', () => window.api.openFolder(res.folder));
  } else {
    resultEl.className = 'result error';
    resultEl.innerHTML = `
      <div class="result-title">Couldn't convert</div>
      <div class="result-detail"></div>`;
    resultEl.querySelector('.result-detail').textContent =
      (res && res.message) || 'Something went wrong. Please try again.';
  }
}

// Init
updateFolderLabel();
updateConvertState();
