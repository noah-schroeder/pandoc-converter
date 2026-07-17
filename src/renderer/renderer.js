'use strict';

// State
let inputFile = null;        // { path, name, dir, isFolder? }
let outputFolder = null;     // chosen folder, or null = "same as file"
let projectInfo = null;      // result of inspectInput for the current selection
let chosenMainTex = null;    // label of the main .tex when a project has several

// Elements
const pickFileBtn = document.getElementById('pick-file');
const pickProjectFolderBtn = document.getElementById('pick-project-folder');
const fileboxEmpty = document.getElementById('filebox-empty');
const fileboxFilled = document.getElementById('filebox-filled');
const fileIconEl = document.getElementById('file-icon');
const fileNameEl = document.getElementById('file-name');
const projectInfoEl = document.getElementById('project-info');
const formatEl = document.getElementById('format');
const pickFolderBtn = document.getElementById('pick-folder');
const folderPathEl = document.getElementById('folder-path');
const convertBtn = document.getElementById('convert');
const convertLabel = convertBtn.querySelector('.convert-label');
const spinner = convertBtn.querySelector('.spinner');
const resultEl = document.getElementById('result');
const dropHint = document.getElementById('drop-hint');

let busy = false;

function iconFor(file) {
  if (file.isFolder) return '📁';
  if (/\.zip$/i.test(file.name)) return '📦';
  return '📄';
}

function setInputFile(file) {
  inputFile = file;
  projectInfo = null;
  chosenMainTex = null;
  if (file) {
    fileIconEl.textContent = iconFor(file);
    fileNameEl.textContent = file.name;
    fileNameEl.title = file.path;
    fileboxEmpty.hidden = true;
    fileboxFilled.hidden = false;
  } else {
    fileboxEmpty.hidden = false;
    fileboxFilled.hidden = true;
  }
  renderProjectInfo(null);
  updateFolderLabel();
  updateConvertState();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Ask the main process what the selection is (LaTeX project? bibliography?
// multiple main files?) and reflect it in the UI.
async function refreshProjectInfo() {
  if (!inputFile) { renderProjectInfo(null); return; }
  const target = inputFile.path;
  const info = await window.api.inspectInput(target);
  // Guard against a newer selection having replaced this one mid-await.
  if (!inputFile || inputFile.path !== target) return;
  // A dropped item may turn out to be a folder — reflect that in the icon.
  if (info.kind === 'folder' && !inputFile.isFolder) {
    inputFile.isFolder = true;
    fileIconEl.textContent = iconFor(inputFile);
  }
  projectInfo = info;
  renderProjectInfo(info);
  updateConvertState();
}

function renderProjectInfo(info) {
  if (!info || !info.isLatexProject) {
    projectInfoEl.hidden = true;
    projectInfoEl.innerHTML = '';
    return;
  }
  const found = [];
  if (info.hasBib) found.push('bibliography');
  if (info.hasCsl) found.push('citation style');
  const detail = found.length ? `Found: ${found.join(' + ')}.` : 'No bibliography detected.';
  const multi = info.candidates && info.candidates.length > 1;

  let html = `<div class="pi-head"><span class="pi-badge">LaTeX project</span>`
    + `<span class="pi-detail">${detail}</span></div>`;

  if (multi) {
    // Several files could be the main document (e.g. multiple drafts). Don't
    // guess — make the user pick. Candidates are ordered best-guess-first.
    if (!info.candidates.some((c) => c.label === chosenMainTex)) chosenMainTex = null;
    html += `<div class="pi-ask">Found ${info.candidates.length} possible main documents — which should we convert?</div>`
      + `<label class="pi-choose"><span class="pi-choose-label">Main file:</span>`
      + `<select id="maintex-select" class="pi-select">`
      + `<option value="" disabled${chosenMainTex ? '' : ' selected'}>Choose the main .tex…</option>`
      + info.candidates.map((c, i) => {
        const sel = c.label === chosenMainTex ? ' selected' : '';
        const tag = i === 0 ? ' (likely)' : '';
        return `<option value="${escapeHtml(c.label)}"${sel}>${escapeHtml(c.label)}${tag}</option>`;
      }).join('')
      + `</select></label>`;
  } else if (info.candidates && info.candidates.length === 1) {
    html += `<div class="pi-choose">Main file: <strong>${escapeHtml(info.candidates[0].label)}</strong></div>`;
  }

  projectInfoEl.innerHTML = html;
  projectInfoEl.hidden = false;

  if (multi) {
    document.getElementById('maintex-select').addEventListener('change', (e) => {
      chosenMainTex = e.target.value || null;
      updateConvertState();
    });
  }
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

// When a project has several possible main files, the user must pick one first.
function needsMainChoice() {
  return !!(projectInfo && projectInfo.candidates && projectInfo.candidates.length > 1 && !chosenMainTex);
}

function updateConvertState() {
  convertBtn.disabled = busy || !inputFile || needsMainChoice();
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
    refreshProjectInfo();
  }
});

pickProjectFolderBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (busy) return;
  const folder = await window.api.pickInputFolder();
  if (folder) {
    setInputFile(folder);
    clearResult();
    refreshProjectInfo();
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
  refreshProjectInfo();
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
      chosenMainTex,
    });
    // Defensive: if the project turned out to have several main files, surface
    // the chooser (normally already shown from inspect) — not a scary error.
    if (res && res.needsMainSelection) {
      projectInfo = {
        isLatexProject: true,
        candidates: res.candidates,
        hasBib: projectInfo && projectInfo.hasBib,
        hasCsl: projectInfo && projectInfo.hasCsl,
      };
      renderProjectInfo(projectInfo);
      projectInfoEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      showResult(res);
    }
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
