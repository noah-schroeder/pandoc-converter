#!/usr/bin/env node
/*
 * fetch-pandoc.js  (build-time only — never runs inside the shipped app)
 *
 * Downloads the official pandoc binary for the CURRENT host platform + arch and
 * drops just the executable into resources/pandoc/<plat>/. The packaged app then
 * ships that binary and invokes it by absolute path, so end users install nothing.
 *
 * Release builds for each OS should run this on that OS (locally or in CI) so the
 * correct native binary gets bundled.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const tar = require('tar');

const PANDOC_VERSION = '3.10';

// Map Node's platform/arch onto pandoc's release asset names + our bundle folder.
function resolveTarget() {
  const platform = process.platform; // 'win32' | 'darwin' | 'linux'
  const arch = process.arch; // 'x64' | 'arm64' | ...

  if (platform === 'linux') {
    const a = arch === 'arm64' ? 'arm64' : 'amd64';
    return {
      dir: 'linux',
      binName: 'pandoc',
      asset: `pandoc-${PANDOC_VERSION}-linux-${a}.tar.gz`,
      kind: 'tar',
    };
  }
  if (platform === 'darwin') {
    const a = arch === 'arm64' ? 'arm64' : 'x86_64';
    return {
      dir: 'mac',
      binName: 'pandoc',
      asset: `pandoc-${PANDOC_VERSION}-${a}-macOS.zip`,
      kind: 'zip',
    };
  }
  if (platform === 'win32') {
    return {
      dir: 'win',
      binName: 'pandoc.exe',
      asset: `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`,
      kind: 'zip',
    };
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

// Recursively find the pandoc executable inside an extracted release tree.
function findBinary(root, binName) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === binName) {
        return full;
      }
    }
  }
  return null;
}

async function download(url, destFile) {
  console.log(`  downloading ${url}`);
  const res = await fetch(url); // Node 18+ global fetch follows redirects
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destFile, buf);
  return destFile;
}

async function main() {
  const target = resolveTarget();
  const projectRoot = path.resolve(__dirname, '..');
  const outDir = path.join(projectRoot, 'resources', 'pandoc', target.dir);
  const outBin = path.join(outDir, target.binName);

  if (fs.existsSync(outBin)) {
    console.log(`✓ pandoc already present at ${path.relative(projectRoot, outBin)} — skipping.`);
    console.log('  (delete resources/pandoc to re-download)');
    return;
  }

  console.log(`Fetching pandoc ${PANDOC_VERSION} for ${target.dir} (${process.arch})...`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-dl-'));
  try {
    const url = `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/${target.asset}`;
    const archive = path.join(tmp, target.asset);
    await download(url, archive);

    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    if (target.kind === 'tar') {
      await tar.x({ file: archive, cwd: extractDir });
    } else {
      new AdmZip(archive).extractAllTo(extractDir, true);
    }

    const found = findBinary(extractDir, target.binName);
    if (!found) {
      throw new Error(`Could not locate ${target.binName} inside ${target.asset}`);
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(found, outBin);
    if (process.platform !== 'win32') {
      fs.chmodSync(outBin, 0o755);
    }

    console.log(`✓ Bundled pandoc → ${path.relative(projectRoot, outBin)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n✗ fetch-pandoc failed:', err.message);
  console.error('  You can retry with: npm run fetch-pandoc');
  process.exit(1);
});
