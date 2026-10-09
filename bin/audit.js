#!/usr/bin/env node
'use strict';

/**
 * audit.js — auditoria de performance com relatorio em Markdown
 *
 * Uso:
 *   node bin/audit.js <url> [opcoes]
 *
 * Opcoes:
 *   --site=<chave>               prefixo dos arquivos (padrao: dominio)
 *   --form=mobile|desktop|both   formato (padrao: both)
 *   --motor=auto|psi|local       motor de medicao (padrao: auto)
 *   --execucoes=<N>              roda N vezes e usa a execucao mediana (padrao: 1)
 *   --html                       gera tambem o relatorio HTML oficial do Lighthouse
 *   --compare=<arquivo.json>     compara com uma medicao anterior
 *   --block=<padroes>            bloqueia URLs na medicao (so motor local),
 *                                ex. '*googletagmanager.com*,*hotjar*'
 *
 * Motor auto: PageSpeed Insights se PSI_API_KEY estiver definida (.env ou
 * ambiente); se o PageSpeed falhar, cai para o Lighthouse local.
 */

const path = require('path');
const fs = require('fs');
const { loadEnv } = require('../lib/env');
const { medir } = require('../lib/engine');
const { parseReport } = require('../lib/parse');
const { renderMarkdown } = require('../lib/report-md');
const { computeDiff, motoresDiferentes } = require('../lib/compare');
const { writeHtmlReport } = require('../lib/html-report');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');

const USO = 'Uso: node bin/audit.js <url> [--site=chave] [--form=mobile|desktop|both] [--motor=auto|psi|local] [--execucoes=N] [--html] [--compare=arquivo.json] [--block=padroes]';

function parseArgs(argv) {
  const args = { _: [], form: 'both', site: null, compare: null, block: [], motor: 'auto', execucoes: 1, html: false };
  for (const a of argv) {
    if (a.startsWith('--site=')) args.site = a.slice(7);
    else if (a.startsWith('--form=')) args.form = a.slice(7);
    else if (a.startsWith('--compare=')) args.compare = a.slice(10);
    else if (a.startsWith('--motor=')) args.motor = a.slice(8);
    else if (a.startsWith('--execucoes=')) args.execucoes = Math.max(1, parseInt(a.slice(12), 10) || 1);
    else if (a === '--html') args.html = true;
    else if (a.startsWith('--block=')) {
      args.block = a.slice(8).split(',').map((p) => p.trim()).filter(Boolean);
    } else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('--')) args._.push(a);
    else throw new Error(`Opcao desconhecida: ${a}\n${USO}`);
  }
  return args;
}

function slugify(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9]/gi, '-').replace(/^-|-$/g, '');
  } catch (e) {
    return 'site';
  }
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Execucao mediana pela nota; execucoes com erro (nota nula) ficam de fora. */
function mediana(runs) {
  const validas = runs.filter((r) => r.parsed.score !== null).sort((a, b) => a.parsed.score - b.parsed.score);
  if (!validas.length) return runs[0];
  return validas[Math.floor((validas.length - 1) / 2)];
}

async function auditarFormato(url, form, args, slug, stamp) {
  const runs = [];
  // O motor da primeira execucao vale para a serie inteira: nao misturamos
  // PSI e local na mesma mediana.
  let motor = args.motor;

  for (let i = 1; i <= args.execucoes; i++) {
    const basename = args.execucoes > 1 ? `${slug}-${stamp}-${form}-r${i}` : `${slug}-${stamp}-${form}`;
    if (args.execucoes > 1) console.log(`  execucao ${i}/${args.execucoes}`);
    let r;
    try {
      r = await medir({ url, form, motor, block: args.block, outDir: REPORTS_DIR, basename });
    } catch (e) {
      if (i === 1) throw e;
      console.log(`  execucao ${i} descartada: ${e.message}`);
      continue;
    }
    if (i === 1) motor = r.motor;
    const parsed = parseReport(r.lhr, form, r);
    runs.push({ ...r, parsed });
    console.log(`  [${r.motor}] score ${parsed.score ?? 'erro'}${parsed.runtimeError ? ` — ${parsed.runtimeError}` : ''}`);
  }

  const escolhida = mediana(runs);
  const parsed = escolhida.parsed;
  parsed.execucoes = runs.map((r) => ({
    score: r.parsed.score,
    lcp: r.parsed.metrics.lcp.value,
    tbt: r.parsed.metrics.tbt.value,
    lhr: path.relative(ROOT, r.lhrPath),
  }));

  if (args.html) {
    const htmlPath = path.join(REPORTS_DIR, `${slug}-${stamp}-${form}.report.html`);
    await writeHtmlReport(escolhida.lhr, htmlPath);
    parsed.htmlReport = path.relative(ROOT, htmlPath);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args._[0];
  if (args.help || !url) {
    console.error(USO);
    process.exit(args.help ? 0 : 1);
  }
  loadEnv();

  const slug = args.site || slugify(url);
  const stamp = timestamp();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const forms = args.form === 'both' ? ['mobile', 'desktop'] : [args.form];
  const results = {};

  for (const form of forms) {
    console.log(`\n▶ Auditoria ${form.toUpperCase()} — ${url}`);
    const parsed = await auditarFormato(url, form, args, slug, stamp);
    results[form] = parsed;

    const m = parsed.metrics;
    console.log(`  Score: ${parsed.score ?? 'erro'}  (motor: ${parsed.motor})`);
    console.log(`  FCP: ${m.fcp.display}  LCP: ${m.lcp.display}  TBT: ${m.tbt.display}  CLS: ${m.cls.display}  SI: ${m.si.display}`);
    if (parsed.lcpElement) console.log(`  LCP element: ${parsed.lcpElement.tag} — ${parsed.lcpElement.snippet}`);
    if (parsed.fieldData) {
      const f = parsed.fieldData.metricas;
      console.log(`  Campo (${parsed.fieldData.escopo}): LCP ${f.lcp?.display || '-'}  INP ${f.inp?.display || '-'}  CLS ${f.cls?.display || '-'}`);
    }
  }

  // Comparacao opcional
  let diff = null;
  let avisoMotores = null;
  if (args.compare) {
    if (!fs.existsSync(args.compare)) {
      console.log(`\nAviso: --compare ignorado, arquivo nao encontrado: ${args.compare}`);
    } else {
      const prev = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
      diff = computeDiff(prev, results);
      avisoMotores = motoresDiferentes(prev, results);
      for (const a of avisoMotores) {
        console.log(`\nAtencao: ${a.form} comparado entre motores diferentes (${a.antes} -> ${a.depois}).`);
      }
    }
  }

  const consolidatedPath = path.join(REPORTS_DIR, `${slug}-${stamp}.json`);
  fs.writeFileSync(consolidatedPath, JSON.stringify({ url, slug, stamp, results, diff }, null, 2));

  const mdPath = path.join(REPORTS_DIR, `${slug}-${stamp}.md`);
  fs.writeFileSync(mdPath, renderMarkdown({ url, slug, stamp, results, diff, avisoMotores }));

  console.log('\n✅ Relatorios gerados:');
  console.log(`   JSON: ${consolidatedPath}`);
  console.log(`   MD:   ${mdPath}`);
  for (const r of Object.values(results)) if (r.htmlReport) console.log(`   HTML: ${path.join(ROOT, r.htmlReport)}`);
  console.log(`\nDica: para comparar na proxima vez, use --compare=${consolidatedPath}`);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
