import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'report-template.html');

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [ ...values ].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function failureCategories(row) {
  if (!row.callSucceeded) return [ '调用失败' ];
  const messages = row.errors ?? [];
  const categories = [];
  const expectedNoErrors = (row.expectation?.allowedTypes?.length ?? 0) === 0
    && (row.expectation?.requiredTypes?.length ?? 0) === 0;
  if (messages.some(message => message.includes('explicitGrammarQuestion'))) {
    categories.push('显式提问判断错误');
  }
  if (messages.some(message => message.includes('缺少错误类型'))
    && messages.some(message => message.includes('出现非预期错误类型'))) {
    categories.push('错误分类');
  } else {
    if (messages.some(message => message.includes('缺少错误类型'))) categories.push('漏检');
    if (messages.some(message => message.includes('出现非预期错误类型'))) {
      categories.push(expectedNoErrors ? '非目标内容误报' : '额外错误类型');
    }
  }
  if (messages.some(message => message.includes('纠正结果未匹配'))) categories.push('纠正内容错误');
  if (messages.some(message => message.includes('original 不是'))) categories.push('原文片段幻觉');
  if (messages.some(message => message.includes('corrected 未改变'))) categories.push('无效纠正');
  if (messages.some(message => message.includes('note 应为中文'))) categories.push('说明语言错误');
  return categories.length ? [ ...new Set(categories) ] : [ '业务断言失败' ];
}

function buildCaseSummaries(payload) {
  const groups = new Map();
  for (const row of payload.results) {
    const key = `${row.variant}\u0000${row.caseId}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return [ ...groups.entries() ].map(([ key, rows ]) => {
    const [ variant, caseId ] = key.split('\u0000');
    const successful = rows.filter(row => row.callSucceeded);
    const durations = successful.map(row => row.durationMs);
    const passed = rows.filter(row => row.passed).length;
    return {
      variant,
      caseId,
      description: rows[0]?.caseDescription ?? '',
      passed,
      total: rows.length,
      passRate: rows.length ? passed / rows.length : 0,
      averageMs: average(durations),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations.length ? Math.max(...durations) : null,
    };
  });
}

function buildFailureCases(payload) {
  const groups = new Map();
  for (const row of payload.results.filter(item => !item.passed)) {
    const key = `${row.variant}\u0000${row.caseId}`;
    const rows = groups.get(key) ?? [];
    rows.push({
      run: row.run,
      durationMs: row.durationMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      callSucceeded: row.callSucceeded,
      categories: failureCategories(row),
      errors: row.errors,
      output: row.output ?? null,
    });
    groups.set(key, rows);
  }
  return [ ...groups.entries() ].map(([ key, failures ]) => {
    const [ variant, caseId ] = key.split('\u0000');
    const allRows = payload.results.filter(row => row.variant === variant && row.caseId === caseId);
    const first = allRows[0];
    const categories = [ ...new Set(failures.flatMap(item => item.categories)) ];
    return {
      variant,
      caseId,
      description: first?.caseDescription ?? '',
      input: first?.inputContent ?? '',
      failed: failures.length,
      total: allRows.length,
      failureRate: allRows.length ? failures.length / allRows.length : 0,
      categories,
      analysis: categories.join('、'),
      failures,
    };
  });
}

function buildSlowCases(payload, caseSummaries, slowRatio) {
  const overallByVariant = new Map(payload.summary.map(item => [ item.id, item ]));
  return caseSummaries.flatMap(item => {
    const overall = overallByVariant.get(item.variant);
    if (!overall || item.averageMs == null || item.p95Ms == null) return [];
    const averageRatio = overall.averageMs ? item.averageMs / overall.averageMs : 0;
    const p95Ratio = overall.p95Ms ? item.p95Ms / overall.p95Ms : 0;
    if (averageRatio < slowRatio && p95Ratio < slowRatio) return [];
    return [{ ...item, averageRatio, p95Ratio }];
  });
}

export function buildReportData(payload, slowRatio = 1.5) {
  const caseSummaries = buildCaseSummaries(payload);
  return {
    generatedAt: new Date().toISOString(),
    slowRatio,
    totals: {
      calls: payload.results.length,
      passed: payload.results.filter(row => row.passed).length,
      callSucceeded: payload.results.filter(row => row.callSucceeded).length,
    },
    caseSummaries,
    failureCases: buildFailureCases(payload),
    slowCases: buildSlowCases(payload, caseSummaries, slowRatio),
  };
}

export function defaultHtmlPath(jsonPath) {
  return extname(jsonPath).toLowerCase() === '.json'
    ? `${jsonPath.slice(0, -5)}.html`
    : `${jsonPath}.html`;
}

export async function writeBenchmarkHtml(payload, htmlPath) {
  const template = await readFile(templatePath, 'utf8');
  const serialized = JSON.stringify(payload)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  const html = template.replace('__BENCHMARK_DATA__', serialized);
  if (html === template) throw new Error('HTML 报告模板缺少 __BENCHMARK_DATA__ 占位符');
  await writeFile(htmlPath, html, 'utf8');
}
