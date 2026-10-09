#!/usr/bin/env node
/**
 * tracker-count.js — conta rastreadores carregados numa pagina
 *
 * PARA QUE SERVE
 * Verificar o efeito de cada alteracao no Tag Manager. Requisicoes e bytes
 * sao DETERMINISTICOS, enquanto a nota do PageSpeed tem ruido. Depois de
 * pausar uma tag, o numero aqui muda na hora e sem ambiguidade.
 *
 * O QUE MEDE
 *   - requisicoes a dominios de rastreamento (lista padrao ou --padroes=)
 *   - IDs de medicao GA4 (gtag/js?id=G-...) distintos
 *   - requisicoes de coleta que FALHARAM
 *   - bytes e requisicoes totais da pagina
 *
 * Espera --espera= segundos (padrao 16) SEM interagir, para que tags com
 * carregamento adiado por tempo tambem disparem.
 *
 * Usa User-Agent real: alguns WAFs devolvem 403 para o UA padrao do Chrome
 * headless, e a pagina mede vazia sem erro obvio.
 *
 * USO
 *   node tools/tracker-count.js <url> [url...] [--form=mobile|desktop]
 *        [--espera=16] [--padroes='hotjar,clarity\.ms']
 *
 * --padroes acrescenta trechos (regex) a lista padrao.
 */
'use strict';

const puppeteer = require('puppeteer-core');
const { requireChrome } = require('../lib/chrome');

const UA = {
  mobile: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};
const VIEWPORT = {
  mobile: { width: 412, height: 900, isMobile: true, hasTouch: true },
  desktop: { width: 1366, height: 900 },
};

const PADROES_PADRAO = [
  'googletagmanager', 'google-analytics', 'doubleclick', 'googleadservices',
  'connect\\.facebook', 'facebook\\.com/tr', 'hotjar', 'clarity\\.ms',
  'analytics\\.tiktok', 'snap\\.licdn', 'px\\.ads\\.linkedin', 'bat\\.bing',
];

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function medir(browser, url, form, esperaMs, rastreador) {
  // Contexto isolado por URL: sem isso a segunda pagina reaproveita o cache
  // da primeira e o total de bytes sai muito abaixo do real.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(UA[form]);
  await page.setViewport(VIEWPORT[form]);

  const req = [];
  const falhas = [];
  const coleta = /collect|\/tr\?|run\.app/;
  page.on('request', (r) => { if (rastreador.test(r.url())) req.push(r.url()); });
  page.on('response', (r) => {
    if (r.status() >= 400 && (rastreador.test(r.url()) || coleta.test(r.url()))) {
      falhas.push(`${r.status()} ${r.url().slice(0, 80)}`);
    }
  });
  page.on('requestfailed', (r) => {
    if (rastreador.test(r.url()) || coleta.test(r.url())) {
      // net::ERR_ABORTED costuma ser beacon cancelado ao descarregar a pagina
      // (normal); ERR_FAILED ou ERR_NAME_NOT_RESOLVED indica envio que nao chegou.
      const motivo = (r.failure() && r.failure().errorText) || 'desconhecido';
      falhas.push(`${motivo}  ${r.url().slice(0, 72)}`);
    }
  });

  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  if (!resp || resp.status() !== 200) {
    throw new Error(`HTTP ${resp ? resp.status() : 'sem resposta'} (WAF bloqueando o navegador automatizado?)`);
  }
  await new Promise((r) => setTimeout(r, esperaMs));

  const total = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .reduce((a, r) => ({ n: a.n + 1, kb: a.kb + (r.transferSize || 0) / 1024 }), { n: 0, kb: 0 }));

  const ga4 = [...new Set(req.filter((u) => /gtag\/js/.test(u))
    .map((u) => (u.match(/[?&]id=(G-[A-Z0-9]+)/) || [])[1]).filter(Boolean))].sort();

  const porDominio = {};
  for (const u of req) {
    const h = new URL(u).hostname;
    porDominio[h] = (porDominio[h] || 0) + 1;
  }

  await page.close();
  await ctx.close();
  return { req: req.length, ga4, porDominio, falhas: [...new Set(falhas)], total };
}

(async () => {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!urls.length) {
    console.error('Uso: node tools/tracker-count.js <url> [url...] [--form=mobile|desktop] [--espera=16] [--padroes=a,b]');
    process.exit(1);
  }
  const form = arg('form', 'mobile');
  const esperaMs = parseFloat(arg('espera', '16')) * 1000;
  const extras = (arg('padroes', '') || '').split(',').map((p) => p.trim()).filter(Boolean);
  const rastreador = new RegExp(PADROES_PADRAO.concat(extras).join('|'));

  const browser = await puppeteer.launch({
    executablePath: requireChrome(), headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  for (const url of urls) {
    console.log(`\n${'='.repeat(64)}\n${url}  (${form})`);
    try {
      const m = await medir(browser, url, form, esperaMs, rastreador);
      console.log(`  requisicoes de rastreador : ${m.req}`);
      console.log(`  IDs GA4 distintos         : ${m.ga4.length}  ${m.ga4.join(', ')}`);
      console.log(`  pagina inteira            : ${m.total.n} requisicoes, ${m.total.kb.toFixed(0)} KB`);
      console.log('  por dominio:');
      for (const [h, n] of Object.entries(m.porDominio).sort((a, b) => b[1] - a[1])) {
        console.log(`     ${String(n).padStart(3)}x  ${h}`);
      }
      if (m.falhas.length) {
        console.log('  REQUISICOES COM ERRO:');
        m.falhas.slice(0, 6).forEach((f) => console.log(`     ${f}`));
      } else {
        console.log('  requisicoes com erro      : nenhuma');
      }
    } catch (e) {
      console.log(`  ERRO: ${e.message}`);
    }
  }
  await browser.close();
})().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
