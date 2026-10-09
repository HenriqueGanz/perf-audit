'use strict';

/**
 * engine.js — escolhe o motor de medicao e faz o fallback.
 *
 *   auto  (padrao) PageSpeed se houver PSI_API_KEY; se o PSI falhar, Lighthouse local
 *   psi            so PageSpeed; falha explicita, sem fallback
 *   local          so Lighthouse local
 *
 * Bloqueio de URL (--block) so existe no motor local.
 */
const { runPsi } = require('./engines/psi');
const { runLocal } = require('./engines/local');

const MOTORES = ['auto', 'psi', 'local'];

/**
 * @returns {Promise<{ lhr, lhrPath, motor: 'psi'|'local', motivoFallback: string|null, campo, origem }>}
 */
async function medir({ url, form, motor = 'auto', block = [], outDir, basename }) {
  if (!MOTORES.includes(motor)) throw new Error(`--motor deve ser um de: ${MOTORES.join(', ')}`);
  const key = process.env.PSI_API_KEY || '';

  if (block.length && motor === 'psi') {
    throw new Error('O PageSpeed nao bloqueia URLs. Use --motor=local (ou auto) com --block.');
  }

  let motivoFallback = null;
  if (motor === 'auto') {
    if (block.length) motivoFallback = '--block exige o motor local';
    else if (!key) motivoFallback = 'PSI_API_KEY nao definida';
  }

  if (motor === 'psi' || (motor === 'auto' && !motivoFallback)) {
    if (!key) console.log('  Aviso: sem PSI_API_KEY a cota publica do PageSpeed se esgota rapido.');
    try {
      const r = await runPsi({ url, form, outDir, basename, key });
      return { ...r, motor: 'psi', motivoFallback: null };
    } catch (e) {
      if (motor === 'psi') throw new Error(`PageSpeed falhou: ${e.message}`);
      motivoFallback = `PageSpeed falhou (${e.message})`;
    }
  }

  if (motivoFallback) console.log(`  Usando Lighthouse local: ${motivoFallback}`);
  const r = runLocal({ url, form, outDir, basename, block });
  return { ...r, motor: 'local', motivoFallback, campo: null, origem: null };
}

module.exports = { medir, MOTORES };
