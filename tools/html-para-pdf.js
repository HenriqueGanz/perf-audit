#!/usr/bin/env node
/**
 * html-para-pdf.js — gera um PDF de pagina unica (sem quebras) a partir de
 * um HTML. Util para relatorios longos que perdem a leitura quando o
 * navegador os divide em paginas A4.
 *
 * USO
 *   node tools/html-para-pdf.js <entrada.html> [saida.pdf] [--largura=1000]
 *
 * Forca tema claro (prefers-color-scheme e data-theme="light") e midia
 * "screen", e remove botoes de troca de tema. Limite pratico: leitores
 * como o Acrobat aceitam paginas de ate ~5 m (14.400 pt) de altura.
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');
const { requireChrome } = require('../lib/chrome');

(async () => {
  const [entradaArg, saidaArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!entradaArg) {
    console.error('Uso: node tools/html-para-pdf.js <entrada.html> [saida.pdf] [--largura=1000]');
    process.exit(1);
  }
  const larguraArg = process.argv.find((a) => a.startsWith('--largura='));
  const LARGURA = larguraArg ? parseInt(larguraArg.slice(10), 10) : 1000; // px
  const entrada = path.resolve(entradaArg);
  const saida = path.resolve(saidaArg || entrada.replace(/\.html?$/i, '') + '.pdf');

  const browser = await puppeteer.launch({ executablePath: requireChrome(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: LARGURA, height: 1200 });
  await page.emulateMediaType('screen');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto('file://' + entrada, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    // Controles de tela (troca de tema etc.) nao fazem sentido no PDF
    document.querySelectorAll('[data-theme-toggle], .theme-toggle').forEach((e) => e.remove());
  });
  await page.evaluate(() => document.fonts.ready);
  const altura = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.pdf({
    path: saida,
    width: `${LARGURA}px`,
    height: `${altura + 2}px`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    pageRanges: '1',
  });
  await browser.close();
  console.log(`${saida}  ${LARGURA}×${altura}px`);
  if (altura * 0.75 > 14400) console.log('Aviso: altura acima de 14.400 pt; alguns leitores podem cortar a pagina.');
})().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
