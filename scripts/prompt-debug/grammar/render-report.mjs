import { readFile } from 'node:fs/promises';

import { buildReportData, defaultHtmlPath, writeBenchmarkHtml } from './report.mjs';

const args = process.argv.slice(2).filter(value => value !== '--');
const jsonPath = args[0];
const htmlPath = args[1] ?? (jsonPath ? defaultHtmlPath(jsonPath) : undefined);
if (!jsonPath || !htmlPath) {
  throw new Error('用法: render-report.mjs <benchmark.json> [report.html]');
}

const payload = JSON.parse(await readFile(jsonPath, 'utf8'));
if (!Array.isArray(payload.results) || !Array.isArray(payload.summary)) {
  throw new Error('benchmark JSON 必须包含 results 和 summary 数组');
}
payload.report = buildReportData(payload);
await writeBenchmarkHtml(payload, htmlPath);
console.log(`HTML 报告已写入 ${htmlPath}`);
