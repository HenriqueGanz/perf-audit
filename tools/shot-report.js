#!/usr/bin/env node
/**
 * shot-report.js — recorta prints do relatorio HTML do Lighthouse
 *
 * PARA QUE SERVE
 * Produzir prints para apresentacao a partir do relatorio HTML oficial
 * (gerado com --html em bin/audit.js ou tools/evidence-round.js), sem
 * depender da interface do PageSpeed, que nao se deixa automatizar.
 *
 * Se o relatorio veio do motor PSI, o print mostra o mesmo numero que o
 * cliente ve no PageSpeed. Se veio do motor local, a nota tende a sair
 * abaixo da do PageSpeed (outra maquina, outra rede): deixe isso claro
 * onde o print for usado.
 *
 * USO
 *   node tools/shot-report.js <arquivo.report.html> <prefixo> [--saida=pasta]
 *
 * Gera, em --saida (padrao reports/prints/):
 *   <prefixo>-nota.png         medidor + as cinco metricas
 *   <prefixo>-diagnostico.png  lista de diagnosticos
 */
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { requireChrome } = require('../lib/chrome');

const ROOT = path.resolve(__dirname, '..');

async function shot(page, selector, file, fallbackClip) {
  const el = await page.$(selector);
  if (el) {
    const box = await el.boundingBox();
    if (box && box.width > 50 && box.height > 50) {
      await el.screenshot({ path: file });
      return true;
    }
  }
  if (fallbackClip) {
    await page.screenshot({ path: file, clip: fallbackClip });
    return true;
  }
  return false;
}

(async () => {
  const [htmlPath, prefix] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const saidaArg = process.argv.find((a) => a.startsWith('--saida='));
  const outDir = path.resolve(saidaArg ? saidaArg.slice(8) : path.join(ROOT, 'reports', 'prints'));
  if (!htmlPath || !prefix) {
    console.error('Uso: node tools/shot-report.js <arquivo.report.html> <prefixo> [--saida=pasta]');
    process.exit(1);
  }
  if (!fs.existsSync(htmlPath)) {
    console.error(`Nao encontrei: ${htmlPath}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: requireChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  // Esconde o rodape promocional e o seletor de throttling, que poluem o print.
  await page.evaluate(() => {
    document.querySelectorAll('.lh-footer, .lh-topbar, .lh-scorescale').forEach((el) => el.remove());
  });

  const nota = path.join(outDir, `${prefix}-nota.png`);
  const diag = path.join(outDir, `${prefix}-diagnostico.png`);

  const okNota = await shot(page, '.lh-category-wrapper, .lh-scores-container', nota,
    { x: 0, y: 0, width: 1100, height: 900 });
  const okDiag = await shot(page, '.lh-audit-group--diagnostics, .lh-clump--diagnostic', diag, null);

  console.log(`  nota:        ${okNota ? nota : '(nao gerado)'}`);
  console.log(`  diagnostico: ${okDiag ? diag : '(nao gerado)'}`);

  await browser.close();
})().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
