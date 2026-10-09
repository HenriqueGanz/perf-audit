'use strict';

/**
 * parse.js — extrai metricas e diagnosticos do LHR (Lighthouse Result)
 * Compativel com Lighthouse 12/13 (usa audits + insights novos)
 */

const METRIC_KEYS = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  si: 'speed-index',
};

// Metricas de campo (CrUX) devolvidas pelo PageSpeed
const FIELD_KEYS = {
  lcp: ['LARGEST_CONTENTFUL_PAINT_MS', 'ms'],
  inp: ['INTERACTION_TO_NEXT_PAINT', 'ms'],
  cls: ['CUMULATIVE_LAYOUT_SHIFT_SCORE', 'cls'],
  fcp: ['FIRST_CONTENTFUL_PAINT_MS', 'ms'],
  ttfb: ['EXPERIMENTAL_TIME_TO_FIRST_BYTE', 'ms'],
};

/**
 * @param {object} lhr   Lighthouse Result (local ou lighthouseResult do PSI)
 * @param {string} form  mobile | desktop
 * @param {object} [extra] { motor, motivoFallback, campo, origem }
 */
function parseReport(lhr, form, extra = {}) {
  const audits = lhr.audits || {};
  const metrics = {};
  for (const [key, auditId] of Object.entries(METRIC_KEYS)) {
    const a = audits[auditId] || {};
    metrics[key] = {
      value: a.numericValue,
      display: a.displayValue || 'n/a',
      score: a.score,
    };
  }

  const rawScore = lhr.categories?.performance?.score;
  return {
    form,
    motor: extra.motor || 'local',
    motivoFallback: extra.motivoFallback || null,
    lighthouseVersion: lhr.lighthouseVersion || null,
    url: lhr.finalDisplayedUrl || lhr.requestedUrl,
    fetchTime: lhr.fetchTime,
    // Nota nula = a medicao falhou (ex.: 403 de WAF); ver runtimeError
    score: rawScore == null ? null : Math.round(rawScore * 100),
    runtimeError: lhr.runtimeError ? `${lhr.runtimeError.code}: ${lhr.runtimeError.message}` : null,
    fieldData: extractFieldData(extra.campo, extra.origem),
    metrics,
    lcpElement: extractLcpElement(audits),
    lcpAudit: parseLcpAudit(audits),
    opportunities: extractOpportunities(audits),
    diagnostics: extractDiagnostics(audits),
    thirdParty: extractThirdParty(audits),
    renderBlocking: extractRenderBlocking(audits),
  };
}

/**
 * Dados de campo do CrUX (p75 dos ultimos 28 dias). Usa a pagina; se ela
 * nao tiver trafego suficiente, usa a origem inteira. null quando nao ha
 * dados (motor local ou site com pouco trafego).
 */
function extractFieldData(campo, origem) {
  const usavel = (x) => x && x.metrics && Object.keys(x.metrics).length;
  let fonte = null;
  let escopo = null;
  if (usavel(campo) && !campo.origin_fallback) { fonte = campo; escopo = 'pagina'; }
  else if (usavel(origem)) { fonte = origem; escopo = 'origem'; }
  else if (usavel(campo)) { fonte = campo; escopo = 'origem'; }
  if (!fonte) return null;

  const metricas = {};
  for (const [key, [cruxKey, tipo]] of Object.entries(FIELD_KEYS)) {
    const m = fonte.metrics[cruxKey];
    if (!m) continue;
    const p75 = tipo === 'cls' ? m.percentile / 100 : m.percentile;
    metricas[key] = {
      p75,
      display: tipo === 'cls' ? p75.toFixed(2) : p75 >= 1000 ? `${(p75 / 1000).toFixed(1)} s` : `${p75} ms`,
      categoria: m.category, // FAST | AVERAGE | SLOW
    };
  }
  return { escopo, categoriaGeral: fonte.overall_category || null, metricas };
}

function extractLcpElement(audits) {
  // Lighthouse 13: lcp-breakdown-insight tem o node do LCP
  const insight = audits['lcp-breakdown-insight'];
  if (insight?.details?.items) {
    for (const item of insight.details.items) {
      if (item && item.selector) {
        const label = (item.nodeLabel || '').trim();
        return {
          tag: label || deriveTag(item.selector),
          snippet: (item.snippet || '').replace(/&quot;/g, '"').slice(0, 200),
          url: extractBgUrl(item.snippet) || null,
          selector: item.selector,
        };
      }
    }
  }
  // Fallback Lighthouse 12
  const a = audits['largest-contentful-paint-element'];
  if (a?.details?.items) {
    for (const item of a.details.items) {
      if (item.items && item.items[0]) {
        const el = item.items[0].node || item.items[0];
        return {
          tag: el.nodeLabel || 'desconhecido',
          snippet: (el.snippet || '').slice(0, 200),
          url: el.url || null,
          selector: el.selector || null,
        };
      }
    }
  }
  return null;
}

function deriveTag(selector) {
  if (!selector) return 'desconhecido';
  // Pega o ultimo seletor de classe/tag da cadeia
  const parts = selector.split('>').map((s) => s.trim());
  const last = parts[parts.length - 1] || selector;
  const cls = last.match(/\.([a-zA-Z0-9_-]+)/);
  if (cls) return `.${cls[1]}`;
  const tag = last.match(/^([a-zA-Z0-9]+)/);
  return tag ? tag[1] : last;
}

function extractBgUrl(snippet) {
  if (!snippet) return null;
  const m = snippet.match(/url\(["']?([^"')]+)["']?\)/);
  return m ? m[1].replace(/&quot;/g, '') : null;
}

function parseLcpAudit(audits) {
  const flags = { lazyLoaded: null, fetchpriorityOk: null, discoverable: null };

  // Lighthouse 13: lcp-discovery-insight
  const disc = audits['lcp-discovery-insight'];
  if (disc?.details?.items) {
    for (const it of disc.details.items) {
      if (it.items && it.items.priorityHinted) {
        flags.fetchpriorityOk = it.items.priorityHinted.value === true;
        flags.discoverable = it.items.requestDiscoverable?.value === true;
        flags.lazyLoaded = it.items.eagerlyLoaded?.value === false;
      }
    }
  }

  // Fallback Lighthouse 12
  if (flags.fetchpriorityOk === null) {
    const fp = audits['prioritize-lcp-image'];
    if (fp) flags.fetchpriorityOk = fp.score === 1;
    const lazy = audits['lcp-lazy-loaded'];
    if (lazy) flags.lazyLoaded = lazy.score === 0;
  }

  // subparts
  const subparts = [];
  const breakdown = audits['lcp-breakdown-insight'] || audits['largest-contentful-paint-element'];
  if (breakdown?.details?.items) {
    for (const item of breakdown.details.items) {
      const rows = item.items || [];
      for (const row of rows) {
        if (row.label && (row.duration !== undefined || row.timing !== undefined)) {
          const v = row.duration !== undefined ? row.duration : row.timing;
          subparts.push({ phase: row.label, ms: Math.round(v) });
        }
      }
    }
  }

  return { flags, subparts };
}

function extractOpportunities(audits) {
  const out = [];
  const seen = new Set();
  for (const [id, a] of Object.entries(audits)) {
    if (!a || seen.has(a.title)) continue;
    const savings = a.details?.overallSavingsMs || a.metricSavings?.LCP || 0;
    const isInsightCritical = a.scoreDisplayMode === 'numeric' && a.score === 0;
    if (savings > 0 || isInsightCritical) {
      seen.add(a.title);
      out.push({
        id,
        title: a.title,
        score: a.score,
        savingsMs: Math.round(savings),
        displayValue: a.displayValue || '',
      });
    }
  }
  return out.sort((x, y) => y.savingsMs - x.savingsMs).slice(0, 15);
}

function extractDiagnostics(audits) {
  const ids = [
    'mainthread-work-breakdown',
    'bootup-time',
    'dom-size',
    'unused-javascript',
    'unused-css-rules',
    'font-display',
    'uses-long-cache-ttl',
    'total-byte-weight',
  ];
  const out = [];
  for (const id of ids) {
    const a = audits[id];
    if (!a) continue;
    out.push({
      id,
      title: a.title,
      displayValue: a.displayValue || '',
      score: a.score,
      items: (a.details?.items || []).slice(0, 10),
    });
  }
  return out;
}

function extractThirdParty(audits) {
  const a = audits['third-party-summary'];
  if (!a?.details?.items) return [];
  return a.details.items.map((i) => ({
    entity: i.entity?.text || i.entity || 'desconhecido',
    transferSize: i.transferSize || 0,
    blockingTime: Math.round(i.blockingTime || 0),
    mainThreadTime: Math.round(i.mainThreadTime || 0),
  })).slice(0, 15);
}

function extractRenderBlocking(audits) {
  const a = audits['render-blocking-resources'];
  if (!a?.details?.items) return { savingsMs: 0, items: [] };
  return {
    savingsMs: Math.round(a.details.overallSavingsMs || 0),
    items: a.details.items.map((i) => ({
      url: i.url,
      transferSize: i.totalBytes || 0,
      blockingTime: Math.round(i.wastedMs || 0),
    })).slice(0, 40),
  };
}

module.exports = { parseReport };
