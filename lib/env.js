'use strict';

/**
 * env.js — carrega o arquivo .env da raiz do projeto em process.env.
 * Sem dependencia externa. Variaveis ja definidas no ambiente tem prioridade.
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file = path.resolve(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

module.exports = { loadEnv };
