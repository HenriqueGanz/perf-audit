'use strict';

/**
 * psi.js — motor PageSpeed Insights (API v5).
 *
 * A medicao roda nos servidores do Google: e o mesmo numero que o cliente
 * ve em pagespeed.web.dev. A resposta traz o mesmo LHR do Lighthouse
 * (lighthouseResult) e, quando ha trafego suficiente, os dados de campo do
 * CrUX (usuarios reais) em loadingExperience / originLoadingExperience.
 *
 * Limites: so URLs publicas; sem bloqueio de URL, cabecalhos ou cookies.
 * Cota com chave: 25.000 consultas/dia e 400 a cada 100 s.
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const TIMEOUT_MS = 120000;
const ESPERAS_MS = [5000, 15000]; // novas tentativas em 429/5xx/rede

class PsiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PsiError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chamar(url, form, key) {
  const qs = new URLSearchParams({ url, strategy: form, category: 'performance', locale: 'pt_BR' });
  if (key) qs.set('key', key);

  let res;
  try {
    res = await fetch(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new PsiError(`falha de rede: ${e.message}`, 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    throw new PsiError(`HTTP ${res.status}: ${msg.slice(0, 200)}`, res.status);
  }
  return body;
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {'mobile'|'desktop'} o.form
 * @param {string} o.outDir
 * @param {string} o.basename
 * @param {string} o.key  PSI_API_KEY
 * @returns {Promise<{ lhr: object, lhrPath: string, campo: object|null, origem: object|null }>}
 */
async function runPsi({ url, form, outDir, basename, key }) {
  let body;
  for (let tentativa = 0; ; tentativa++) {
    try {
      body = await chamar(url, form, key);
      break;
    } catch (e) {
      // Cota diaria esgotada nao volta em segundos: falha direto
      const cotaDiaria = e.status === 429 && /per day/i.test(e.message);
      const repetivel = !cotaDiaria && (e.status === 0 || e.status === 429 || e.status >= 500);
      if (!repetivel || tentativa >= ESPERAS_MS.length) throw e;
      console.log(`  PSI ${e.message} — nova tentativa em ${ESPERAS_MS[tentativa] / 1000}s`);
      await sleep(ESPERAS_MS[tentativa]);
    }
  }

  const lhr = body.lighthouseResult;
  if (!lhr) throw new PsiError('resposta sem lighthouseResult', 200);

  fs.writeFileSync(path.join(outDir, `${basename}.psi.json`), JSON.stringify(body));
  const lhrPath = path.join(outDir, `${basename}.lhr.json`);
  fs.writeFileSync(lhrPath, JSON.stringify(lhr));

  return {
    lhr,
    lhrPath,
    campo: body.loadingExperience || null,
    origem: body.originLoadingExperience || null,
  };
}

module.exports = { runPsi, PsiError };
