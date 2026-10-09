'use strict';

/**
 * local.js — motor Lighthouse local (fallback do PageSpeed).
 *
 * Executa o CLI do Lighthouse instalado como dependencia do projeto e
 * retorna o LHR (Lighthouse Result) ja parseado.
 *
 * A nota daqui NAO e comparavel com a do PageSpeed: a medicao roda nesta
 * maquina e nesta rede, com CPU e latencia diferentes. Compare local com
 * local e PSI com PSI.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { requireChrome } = require('../chrome');

function lighthouseCli() {
  try {
    const pkgPath = require.resolve('lighthouse/package.json');
    const bin = require(pkgPath).bin.lighthouse;
    return { cmd: process.execPath, pre: [path.join(path.dirname(pkgPath), bin)] };
  } catch (e) {
    // Sem dependencia local: tenta o lighthouse do PATH
    return { cmd: 'lighthouse', pre: [] };
  }
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {'mobile'|'desktop'} o.form
 * @param {string} o.outDir
 * @param {string} o.basename   nome do arquivo sem extensao
 * @param {string[]} [o.block]  padroes para --blocked-url-patterns
 * @returns {{ lhr: object, lhrPath: string }}
 */
function runLocal({ url, form, outDir, basename, block = [] }) {
  const lhrPath = path.join(outDir, `${basename}.lhr.json`);
  const chromePath = requireChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-'));

  const { cmd, pre } = lighthouseCli();
  const args = [
    ...pre,
    url,
    '--only-categories=performance',
    `--form-factor=${form}`,
    '--output=json',
    `--output-path=${lhrPath}`,
    '--quiet',
    `--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --user-data-dir=${userDataDir}`,
  ];
  if (form === 'desktop') args.push('--preset=desktop');

  // Bloquear a URL equivale a perguntar "e se este recurso nao carregasse?",
  // sem tocar em producao.
  if (block.length) {
    args.push('--blocked-url-patterns');
    for (const pattern of block) args.push(pattern);
  }

  const res = spawnSync(cmd, args, {
    env: { ...process.env, CHROME_PATH: chromePath },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  fs.rmSync(userDataDir, { recursive: true, force: true });

  if (res.error) throw res.error;
  if (!fs.existsSync(lhrPath)) {
    throw new Error(`Lighthouse nao gerou JSON. stderr: ${(res.stderr || '').slice(-500)}`);
  }
  return { lhr: JSON.parse(fs.readFileSync(lhrPath, 'utf8')), lhrPath };
}

module.exports = { runLocal };
