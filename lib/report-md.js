'use strict';

function fmtKB(bytes) {
  if (!bytes) return '0 KB';
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const MOTOR_NOME = { psi: 'PageSpeed Insights (servidores do Google)', local: 'Lighthouse local' };
const CATEGORIA = { FAST: 'bom', AVERAGE: 'precisa melhorar', SLOW: 'ruim' };

function renderMarkdown({ url, slug, stamp, results, diff, avisoMotores }) {
  const lines = [];
  lines.push(`# Relatorio de performance — ${slug}`);
  lines.push('');
  lines.push(`- **URL:** ${url}`);
  lines.push(`- **Data:** ${stamp}`);
  for (const [form, r] of Object.entries(results)) {
    const versao = r.lighthouseVersion ? `, Lighthouse ${r.lighthouseVersion}` : '';
    const fallback = r.motivoFallback ? ` — fallback: ${r.motivoFallback}` : '';
    const n = r.execucoes && r.execucoes.length > 1
      ? ` — mediana de ${r.execucoes.length} execucoes (notas: ${r.execucoes.map((e) => e.score ?? 'erro').join(', ')})`
      : '';
    lines.push(`- **Motor (${form}):** ${MOTOR_NOME[r.motor] || r.motor}${versao}${fallback}${n}`);
    if (r.runtimeError) lines.push(`- **Erro na medicao (${form}):** ${r.runtimeError}`);
  }
  lines.push('');
  lines.push('> Notas do PageSpeed e do Lighthouse local nao sao comparaveis entre si:');
  lines.push('> o ambiente (CPU, rede, localizacao) e diferente.');
  lines.push('');

  // Scores
  lines.push('## 1. Scores');
  lines.push('');
  lines.push('| Formato | Score | FCP | LCP | TBT | CLS | SI |');
  lines.push('|---------|-------|-----|-----|-----|-----|-----|');
  for (const [form, r] of Object.entries(results)) {
    lines.push(
      `| ${form} | **${r.score ?? 'erro'}** | ${r.metrics.fcp.display} | ${r.metrics.lcp.display} | ${r.metrics.tbt.display} | ${r.metrics.cls.display} | ${r.metrics.si.display} |`
    );
  }
  lines.push('');

  // Dados de campo (CrUX) — so o PageSpeed fornece
  lines.push('## 2. Dados de campo (usuarios reais, CrUX)');
  lines.push('');
  const comCampo = Object.entries(results).filter(([, r]) => r.fieldData);
  if (comCampo.length) {
    lines.push('p75 dos ultimos 28 dias. E o que o Google usa nas Core Web Vitals.');
    lines.push('');
    lines.push('| Formato | Escopo | Geral | LCP | INP | CLS | FCP | TTFB |');
    lines.push('|---------|--------|-------|-----|-----|-----|-----|------|');
    for (const [form, r] of comCampo) {
      const f = r.fieldData;
      const cel = (k) => (f.metricas[k] ? `${f.metricas[k].display} (${CATEGORIA[f.metricas[k].categoria] || f.metricas[k].categoria})` : '-');
      lines.push(`| ${form} | ${f.escopo} | ${CATEGORIA[f.categoriaGeral] || f.categoriaGeral || '-'} | ${cel('lcp')} | ${cel('inp')} | ${cel('cls')} | ${cel('fcp')} | ${cel('ttfb')} |`);
    }
  } else if (Object.values(results).some((r) => r.motor === 'psi')) {
    lines.push('Sem dados de campo: o site nao tem trafego suficiente no CrUX.');
  } else {
    lines.push('Indisponivel no motor local (so o PageSpeed fornece dados de campo).');
  }
  lines.push('');

  if (diff) {
    lines.push('## 3. Comparacao com medicao anterior');
    lines.push('');
    if (avisoMotores && avisoMotores.length) {
      for (const m of avisoMotores) {
        lines.push(`> Atencao: em ${m.form} a medicao anterior usou ${m.antes} e esta usou ${m.depois}. O delta inclui a diferenca de ambiente.`);
      }
      lines.push('');
    }
    lines.push('| Metrica | Antes | Depois | Delta |');
    lines.push('|---------|-------|--------|-------|');
    for (const d of diff) {
      const sign = d.delta > 0 ? '+' : '';
      lines.push(`| ${d.label} | ${d.before} | ${d.after} | ${sign}${d.delta} |`);
    }
    lines.push('');
  }

  let n = diff ? 4 : 3;
  for (const [form, r] of Object.entries(results)) {
    lines.push(`## ${n}. Diagnostico ${form.toUpperCase()}`);
    lines.push('');

    // LCP element
    lines.push('### LCP element');
    lines.push('');
    if (r.lcpElement) {
      lines.push(`- Tag: \`${r.lcpElement.tag}\``);
      if (r.lcpElement.url) lines.push(`- URL: ${r.lcpElement.url}`);
      lines.push(`- Snippet: \`${r.lcpElement.snippet}\``);
    } else {
      lines.push('- Nao detectado');
    }
    lines.push('');
    lines.push('### Flags de LCP');
    lines.push('');
    lines.push(`- lazy-load no LCP: **${r.lcpAudit.flags.lazyLoaded === null ? 'n/a' : r.lcpAudit.flags.lazyLoaded ? 'SIM (ruim)' : 'nao (ok)'}**`);
    lines.push(`- fetchpriority=high no LCP: **${r.lcpAudit.flags.fetchpriorityOk === null ? 'n/a' : r.lcpAudit.flags.fetchpriorityOk ? 'sim (ok)' : 'nao (ruim)'}**`);
    lines.push(`- LCP detectavel no HTML inicial: **${r.lcpAudit.flags.discoverable === null ? 'n/a' : r.lcpAudit.flags.discoverable ? 'sim (ok)' : 'nao (ruim)'}**`);
    lines.push('');

    if (r.lcpAudit.subparts.length) {
      lines.push('### Subparts do LCP (ms)');
      lines.push('');
      for (const s of r.lcpAudit.subparts) lines.push(`- ${s.phase}: ${s.ms}ms`);
      lines.push('');
    }

    // Oportunidades
    lines.push('### Oportunidades (economia estimada)');
    lines.push('');
    if (r.opportunities.length) {
      lines.push('| Problema | Economia |');
      lines.push('|----------|----------|');
      for (const o of r.opportunities) {
        lines.push(`| ${o.title} | ${o.savingsMs ? o.savingsMs + ' ms' : o.displayValue || '-'} |`);
      }
    } else {
      lines.push('Nenhuma oportunidade critica.');
    }
    lines.push('');

    // Third party
    if (r.thirdParty.length) {
      lines.push('### Terceiros (tempo de CPU)');
      lines.push('');
      lines.push('| Entidade | Transfer | Blocking | Main thread |');
      lines.push('|----------|----------|----------|-------------|');
      for (const t of r.thirdParty) {
        lines.push(`| ${t.entity} | ${fmtKB(t.transferSize)} | ${t.blockingTime}ms | ${t.mainThreadTime}ms |`);
      }
      lines.push('');
    }

    // Render-blocking
    if (r.renderBlocking.items.length) {
      lines.push(`### Recursos que bloqueiam render (${r.renderBlocking.savingsMs} ms)`);
      lines.push('');
      lines.push('| Recurso | Tamanho | Bloqueio |');
      lines.push('|---------|---------|----------|');
      for (const i of r.renderBlocking.items.slice(0, 20)) {
        const short = i.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
        lines.push(`| ${short} | ${fmtKB(i.transferSize)} | ${i.blockingTime}ms |`);
      }
      lines.push('');
    }

    n++;
  }

  return lines.join('\n');
}

module.exports = { renderMarkdown };
