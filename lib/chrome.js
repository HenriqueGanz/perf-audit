'use strict';

/**
 * chrome.js — localiza um executavel do Chrome/Chromium.
 *
 * Ordem: CHROME_PATH > Chrome for Testing no cache do Puppeteer (versao mais
 * nova) > Chrome/Chromium do sistema. Retorna null se nada for encontrado.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_SUBPATHS = [
  ['chrome-linux64', 'chrome'],
  ['chrome-linux', 'chrome'],
  ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-win64', 'chrome.exe'],
];

const SYSTEM_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function compareVersions(a, b) {
  const pa = a.replace(/^[^-]+-/, '').split('.').map(Number);
  const pb = b.replace(/^[^-]+-/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function findFromPuppeteerCache() {
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).sort(compareVersions); // mais nova primeiro
  for (const d of dirs) {
    for (const sub of CACHE_SUBPATHS) {
      const candidate = path.join(base, d, ...sub);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  return findFromPuppeteerCache() || SYSTEM_PATHS.find((p) => fs.existsSync(p)) || null;
}

function requireChrome() {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error('Chrome nao encontrado. Rode "npx puppeteer browsers install chrome@stable" ou exporte CHROME_PATH.');
  }
  return chrome;
}

module.exports = { findChrome, requireChrome };
