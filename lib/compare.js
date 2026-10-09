'use strict';

/**
 * compare.js — diff entre duas medicoes consolidadas
 * prev: objeto { results: { mobile: {...}, desktop: {...} } }
 * next: mesmo formato
 */
function computeDiff(prev, next) {
  const rows = [];
  const metrics = [
    ['score', 'Score'],
    ['metrics.fcp.value', 'FCP (ms)'],
    ['metrics.lcp.value', 'LCP (ms)'],
    ['metrics.tbt.value', 'TBT (ms)'],
    ['metrics.cls.value', 'CLS'],
    ['metrics.si.value', 'SI (ms)'],
  ];

  for (const form of Object.keys(next)) {
    const a = prev.results?.[form];
    const b = next[form];
    if (!a || !b) continue;
    for (const [path, label] of metrics) {
      const before = get(a, path);
      const after = get(b, path);
      if (typeof before !== 'number' || typeof after !== 'number') continue;
      const delta = round(after - before);
      rows.push({ form, label: `${form.toUpperCase()} ${label}`, before: round(before), after: round(after), delta });
    }
  }
  return rows;
}

/**
 * Lista os formatos em que as duas medicoes usaram motores diferentes
 * (PSI x local). Nesses casos o delta mistura a diferenca de ambiente.
 */
function motoresDiferentes(prev, next) {
  const out = [];
  for (const form of Object.keys(next)) {
    const a = prev.results?.[form]?.motor || 'local';
    const b = next[form]?.motor || 'local';
    if (prev.results?.[form] && a !== b) out.push({ form, antes: a, depois: b });
  }
  return out;
}

function get(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function round(v) {
  if (typeof v !== 'number') return v;
  // Tempos em ms viram inteiros; CLS mantem 3 casas
  return Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 1000) / 1000;
}

module.exports = { computeDiff, motoresDiferentes };
