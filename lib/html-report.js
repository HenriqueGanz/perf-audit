'use strict';

/**
 * html-report.js — gera o relatorio HTML oficial do Lighthouse a partir de
 * um LHR. Funciona tanto para o motor local quanto para o lighthouseResult
 * do PageSpeed, entao os prints (tools/shot-report.js) podem sair com o
 * numero do PageSpeed.
 */
const fs = require('fs');

async function writeHtmlReport(lhr, outPath) {
  // Lighthouse 13 e ESM: import dinamico a partir do CommonJS
  const { ReportGenerator } = await import('lighthouse/report/generator/report-generator.js');
  fs.writeFileSync(outPath, ReportGenerator.generateReportHtml(lhr));
  return outPath;
}

module.exports = { writeHtmlReport };
