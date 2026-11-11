// 比對兩份執行結果（來源系統的基準與產出系統）。
//
// 規則（docs/handoff-product-and-thesis.md 第 4.2 節 S4）：
// - 兩邊都只比「正規化後的可觀察結果」，不比時間戳記、內部識別碼、文字措辭。
// - 預期會不同的地方必須在比對「之前」列入排除清單並寫理由；排除清單隨報告輸出。
// - 失敗的項目照實列出，不得調整成通過。

/**
 * 排除清單的一筆：
 * { scenario: '情境編號或 *', path: '以 . 分隔的欄位路徑，* 代表任一層', reason: '理由' }
 */

function pathMatches(pattern, path) {
  const want = pattern.split('.');
  const have = path.split('.');
  if (want.length !== have.length) return false;
  return want.every((segment, index) => segment === '*' || segment === have[index]);
}

export function isExcluded(exclusions, scenarioId, path) {
  return exclusions.find(
    (rule) => (rule.scenario === '*' || rule.scenario === scenarioId) && pathMatches(rule.path, path),
  );
}

function describe(value) {
  return value === undefined ? '（沒有這個欄位）' : JSON.stringify(value);
}

function walk(baseline, candidate, path, out) {
  const bothObjects =
    baseline !== null &&
    candidate !== null &&
    typeof baseline === 'object' &&
    typeof candidate === 'object' &&
    Array.isArray(baseline) === Array.isArray(candidate);

  if (!bothObjects) {
    if (JSON.stringify(baseline) !== JSON.stringify(candidate)) {
      out.push({ path, baseline: describe(baseline), candidate: describe(candidate) });
    }
    return;
  }

  const keys = Array.isArray(baseline)
    ? Array.from({ length: Math.max(baseline.length, candidate.length) }, (_, index) => String(index))
    : [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();

  for (const key of keys) {
    walk(baseline[key], candidate[key], path ? `${path}.${key}` : key, out);
  }
}

/**
 * @param {{ scenarios: Array<{ id: string, steps: string[], observed: unknown, error?: string }> }} baseline
 * @param {{ scenarios: Array<{ id: string, steps: string[], observed: unknown, error?: string }> }} candidate
 * @param {Array<{ scenario: string, path: string, reason: string }>} exclusions
 */
export function compareRuns(baseline, candidate, exclusions = []) {
  for (const rule of exclusions) {
    if (!rule.scenario || !rule.path || !rule.reason || !String(rule.reason).trim()) {
      throw new Error(`排除清單的每一筆都要有 scenario、path 與 reason：${JSON.stringify(rule)}`);
    }
  }

  const candidateById = new Map(candidate.scenarios.map((scenario) => [scenario.id, scenario]));
  const baselineIds = new Set(baseline.scenarios.map((scenario) => scenario.id));
  const results = [];

  for (const base of baseline.scenarios) {
    const other = candidateById.get(base.id);
    if (!other) {
      results.push({ id: base.id, steps: base.steps, verdict: 'missing', differences: [], excluded: [] });
      continue;
    }
    // 基準本身沒跑成功時不能當作比對依據，也不能算通過。
    if (base.error || other.error) {
      results.push({
        id: base.id,
        steps: base.steps,
        verdict: 'error',
        differences: [],
        excluded: [],
        baselineError: base.error ?? null,
        candidateError: other.error ?? null,
      });
      continue;
    }

    const raw = [];
    walk(base.observed, other.observed, '', raw);
    const differences = [];
    const excluded = [];
    for (const difference of raw) {
      const rule = isExcluded(exclusions, base.id, difference.path);
      if (rule) excluded.push({ ...difference, reason: rule.reason });
      else differences.push(difference);
    }
    results.push({
      id: base.id,
      steps: base.steps,
      verdict: differences.length === 0 ? 'same' : 'different',
      differences,
      excluded,
    });
  }

  for (const other of candidate.scenarios) {
    if (!baselineIds.has(other.id)) {
      results.push({ id: other.id, steps: other.steps, verdict: 'extra', differences: [], excluded: [] });
    }
  }

  const count = (verdict) => results.filter((result) => result.verdict === verdict).length;
  return {
    summary: {
      total: results.length,
      same: count('same'),
      different: count('different'),
      missing: count('missing'),
      extra: count('extra'),
      error: count('error'),
    },
    exclusions,
    results,
  };
}

export function renderMarkdown(report, { baselineLabel, candidateLabel }) {
  const lines = [];
  const { summary } = report;
  lines.push('# S4 行為等價比對結果', '');
  lines.push(`- 基準：${baselineLabel}`);
  lines.push(`- 比對對象：${candidateLabel}`);
  lines.push(
    `- 情境 ${summary.total} 個：相同 ${summary.same}、不同 ${summary.different}、比對對象沒有 ${summary.missing}、基準沒有 ${summary.extra}、執行錯誤 ${summary.error}`,
  );
  lines.push('', '## 排除清單（比對前定義）', '');
  if (report.exclusions.length === 0) {
    lines.push('沒有排除項目。');
  } else {
    lines.push('| 情境 | 欄位 | 理由 |', '|---|---|---|');
    for (const rule of report.exclusions) lines.push(`| ${rule.scenario} | ${rule.path} | ${rule.reason} |`);
  }
  lines.push('', '## 逐情境結果', '');
  lines.push('| 情境 | 對應步驟 | 結果 | 不同的欄位數 |', '|---|---|---|---|');
  const label = { same: '相同', different: '不同', missing: '比對對象沒有', extra: '基準沒有', error: '執行錯誤' };
  for (const result of report.results) {
    lines.push(`| ${result.id} | ${result.steps.join('、')} | ${label[result.verdict]} | ${result.differences.length} |`);
  }
  const failing = report.results.filter((result) => result.verdict !== 'same');
  if (failing.length > 0) {
    lines.push('', '## 不相同的明細', '');
    for (const result of failing) {
      lines.push(`### ${result.id}（${label[result.verdict]}）`, '');
      if (result.verdict === 'error') {
        lines.push(`- 基準的錯誤：${result.baselineError ?? '無'}`);
        lines.push(`- 比對對象的錯誤：${result.candidateError ?? '無'}`);
      }
      for (const difference of result.differences) {
        lines.push(`- \`${difference.path}\`：基準 ${difference.baseline}；比對對象 ${difference.candidate}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}
