#!/usr/bin/env node
/**
 * evidence-round.js — rodada de evidencias por bloqueio de URL
 *
 * PARA QUE SERVE
 * Quantificar quanto cada recurso (rastreadores, sliders, chat, etc.) custa
 * na nota, SEM tocar em producao. Bloquear a URL produz o mesmo efeito que
 * um carregamento adiado por interacao: o recurso nunca carrega durante a
 * medicao.
 *
 * Roda so no motor local: o PageSpeed nao bloqueia URLs.
 *
 * POR QUE O DESENHO E ESTE
 * Sites em hospedagem compartilhada variam muito entre execucoes seguidas.
 * Comparar medianas de 3 nao separa sinal de ruido. Por isso:
 *
 *  - N execucoes por cenario (--n=, padrao 7)
 *  - cenarios INTERCALADOS (S0,S1,S2,S0,S1,...) e nao em bloco, para
 *    cancelar a deriva do servidor ao longo do tempo
 *  - TTFB medido antes de cada execucao; acima de --max-ttfb a execucao
 *    e descartada
 *  - metricas principais sao TBT e BYTES, nao a nota: bytes sao quase
 *    deterministicos e o TBT varia bem menos que a nota
 *  - cada execucao com bloqueio e VERIFICADA: se algum alvo carregou de
 *    verdade, a execucao e marcada como invalida
 *
 * COMO SABER QUE O BLOQUEIO PEGOU
 * Uma URL bloqueada ainda aparece em network-requests, mas com
 * transferSize 0 e statusCode -1. Presenca na lista NAO significa que carregou.
 *
 * ARQUIVO DE CENARIOS (--cenarios=arquivo.json) — ver exemplos/
 *   {
 *     "url": "https://site.com/",           // URL padrao dos cenarios
 *     "cenarios": [
 *       { "id": "S0", "rotulo": "Linha de base", "bloquear": [] },
 *       { "id": "S1", "rotulo": "Sem GTM", "bloquear": ["*googletagmanager.com*"],
 *         "verificar": ["googletagmanager"] },          // opcional
 *       { "id": "S2", "rotulo": "Outra pagina", "url": "https://site.com/x/" }
 *     ]
 *   }
 * O primeiro cenario e a linha de base dos deltas. Sem "verificar", os
 * trechos sao derivados de "bloquear" (sem os asteriscos).
 *
 * USO
 *   node tools/evidence-round.js --cenarios=arquivo.json [--url=https://...]
 *        [--form=mobile|desktop] [--n=7] [--max-ttfb=1.5] [--html]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { runLocal } = require('../lib/engines/local');
const { writeHtmlReport } = require('../lib/html-report');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'reports', 'evidencias');

// Alguns WAFs devolvem 403 para clientes sem User-Agent de navegador.
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Tempo ate a chegada dos cabecalhos (inclui DNS/TLS), em segundos. */
async function ttfbSeconds(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    const t = (performance.now() - t0) / 1000;
    res.body?.cancel();
    return t;
  } catch (e) {
    return NaN;
  }
}

/** So conta como carregada se veio byte e o status nao e -1 (bloqueada). */
function loadedForReal(requests, needle) {
  return requests.some((r) =>
    r.url.includes(needle) && r.statusCode !== -1 && (r.transferSize || 0) > 0);
}

function collect(lhr) {
  const a = lhr.audits;
  const requests = a['network-requests'].details.items;
  return {
    score: Math.round(lhr.categories.performance.score * 100),
    tbt: Math.round(a['total-blocking-time'].numericValue),
    fcp: Math.round(a['first-contentful-paint'].numericValue),
    lcp: Math.round(a['largest-contentful-paint'].numericValue),
    si: Math.round(a['speed-index'].numericValue),
    cls: Number(a['cumulative-layout-shift'].numericValue.toFixed(3)),
    kb: Math.round(requests.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
    requests: requests.length,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function carregarCenarios(arquivo, urlPadrao) {
  if (!arquivo) {
    console.error('Informe --cenarios=arquivo.json (ver exemplos/cenarios.exemplo.json).');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const url = urlPadrao || cfg.url;
  const plan = (cfg.cenarios || []).map((c) => ({
    id: c.id,
    rotulo: c.rotulo || c.id,
    url: c.url || url,
    bloquear: c.bloquear || [],
    verificar: c.verificar || (c.bloquear || []).map((p) => p.replace(/\*/g, '')).filter(Boolean),
  }));
  if (!plan.length) throw new Error('Arquivo de cenarios sem "cenarios".');
  const semUrl = plan.filter((c) => !c.url).map((c) => c.id);
  if (semUrl.length) throw new Error(`Cenarios sem URL (defina "url" no arquivo ou --url=): ${semUrl.join(', ')}`);
  return plan;
}

async function main() {
  const form = arg('form', 'mobile');
  const n = parseInt(arg('n', '7'), 10);
  const maxTtfb = parseFloat(arg('max-ttfb', '1.5'));
  const wantHtml = process.argv.includes('--html');
  const plan = carregarCenarios(arg('cenarios'), arg('url'));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rodada = `${form}-${Date.now()}`;

  console.log(`Formato: ${form}`);
  console.log(`${plan.length} cenarios x ${n} execucoes, intercalados. Descarta TTFB > ${maxTtfb}s.\n`);

  const results = {};
  const lhrs = {};
  const discarded = [];
  for (const s of plan) { results[s.id] = []; lhrs[s.id] = []; }

  for (let round = 1; round <= n; round++) {
    for (const s of plan) {
      const ttfb = await ttfbSeconds(s.url);
      const stamp = `${s.id}-${form}-r${round}`;

      if (!(ttfb <= maxTtfb)) {
        console.log(`  ${stamp.padEnd(14)} DESCARTADA (TTFB ${Number.isNaN(ttfb) ? 'erro' : ttfb.toFixed(2) + 's'})`);
        discarded.push({ stamp, ttfb });
        continue;
      }

      let lhr;
      try {
        ({ lhr } = runLocal({ url: s.url, form, outDir: OUT_DIR, basename: `${rodada}-${stamp}`, block: s.bloquear }));
      } catch (e) {
        console.log(`  ${stamp.padEnd(14)} ERRO: ${e.message.slice(0, 60)}`);
        discarded.push({ stamp, erro: e.message.slice(0, 80) });
        continue;
      }
      if (lhr.runtimeError || lhr.categories?.performance?.score == null) {
        console.log(`  ${stamp.padEnd(14)} ERRO: ${lhr.runtimeError?.code || 'sem nota'}`);
        discarded.push({ stamp, erro: lhr.runtimeError?.code || 'sem nota' });
        continue;
      }

      const requests = lhr.audits['network-requests'].details.items;
      const vazou = s.verificar.filter((needle) => loadedForReal(requests, needle));
      if (s.bloquear.length && vazou.length) {
        console.log(`  ${stamp.padEnd(14)} INVALIDA — bloqueio nao pegou: ${vazou.join(', ')}`);
        discarded.push({ stamp, vazou });
        continue;
      }

      const m = collect(lhr);
      m.ttfb = ttfb;
      m.stamp = stamp;
      results[s.id].push(m);
      lhrs[s.id].push({ score: m.score, lhr });
      console.log(`  ${stamp.padEnd(14)} score ${String(m.score).padStart(3)} | TBT ${String(m.tbt).padStart(5)}ms | ${String(m.kb).padStart(5)}KB | SI ${(m.si / 1000).toFixed(1)}s | TTFB ${ttfb.toFixed(2)}s`);
    }
  }

  const stat = (id, key) => {
    const xs = results[id].map((r) => r[key]);
    return xs.length ? { mediana: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length } : null;
  };

  console.log('\n\n========== RESULTADO ==========\n');
  console.log('| Cenario | n | TBT mediana (min-max) | Bytes | Score mediana (min-max) | SI | FCP |');
  console.log('|---------|---|----------------------|-------|------------------------|-----|-----|');
  for (const s of plan) {
    const t = stat(s.id, 'tbt'), k = stat(s.id, 'kb'), sc = stat(s.id, 'score');
    const si = stat(s.id, 'si'), fc = stat(s.id, 'fcp');
    if (!t) { console.log(`| ${s.id} | 0 | sem execucao valida |`); continue; }
    console.log(`| ${s.id} | ${t.n} | ${t.mediana} ms (${t.min}-${t.max}) | ${k.mediana} KB | ${sc.mediana} (${sc.min}-${sc.max}) | ${(si.mediana / 1000).toFixed(1)}s | ${(fc.mediana / 1000).toFixed(1)}s |`);
  }

  const baseId = plan[0].id;
  const base = stat(baseId, 'tbt');
  if (base && plan.length > 1) {
    console.log(`\nDelta contra a linha de base ${baseId} (mediana):\n`);
    const kb0 = stat(baseId, 'kb').mediana, sc0 = stat(baseId, 'score').mediana;
    const sinal = (d) => (d >= 0 ? '+' : '') + d;
    for (const s of plan.slice(1)) {
      const t = stat(s.id, 'tbt'), k = stat(s.id, 'kb'), sc = stat(s.id, 'score');
      if (!t) continue;
      console.log(`  ${s.id} ${s.rotulo}`);
      console.log(`     TBT   ${base.mediana} -> ${t.mediana} ms  (${sinal(t.mediana - base.mediana)} ms)`);
      console.log(`     Bytes ${kb0} -> ${k.mediana} KB  (${sinal(k.mediana - kb0)} KB)`);
      console.log(`     Score ${sc0} -> ${sc.mediana}  (${sinal(sc.mediana - sc0)})\n`);
    }
  }

  // Relatorio HTML oficial da execucao mediana de cada cenario (fonte dos prints)
  const htmls = {};
  if (wantHtml) {
    console.log('\nExecucao MEDIANA de cada cenario (fonte dos prints):\n');
    for (const s of plan) {
      const rs = lhrs[s.id];
      if (!rs.length) continue;
      const mid = [...rs].sort((a, b) => a.score - b.score)[Math.floor((rs.length - 1) / 2)];
      htmls[s.id] = await writeHtmlReport(mid.lhr, path.join(OUT_DIR, `${rodada}-${s.id}-mediana.report.html`));
      console.log(`  ${s.id} ${s.rotulo}`);
      console.log(`     notas: [${rs.map((r) => r.score).join(', ')}]  ->  mediana ${mid.score}`);
      console.log(`     html:  ${htmls[s.id]}`);
    }
  }

  if (discarded.length) console.log(`\nExecucoes descartadas: ${discarded.length}`);

  const outPath = path.join(OUT_DIR, `${rodada}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ form, n, maxTtfb, cenarios: plan, results, htmls, discarded }, null, 2));
  console.log(`\nDados brutos: ${outPath}`);
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
