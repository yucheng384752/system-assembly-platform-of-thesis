// 比對兩份執行結果，輸出 JSON 與 Markdown 報告。
// 用法：node tools/thesis-s4/compare.mjs --baseline a.json --candidate b.json --out report
//         [--exclusions exclusions.json]
// 有任何不相同、缺少或執行錯誤時結束碼為 1。
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compareRuns, renderMarkdown } from './lib/compare.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    exclusions: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.baseline || !values.candidate || !values.out) {
  console.error('用法：node tools/thesis-s4/compare.mjs --baseline <檔> --candidate <檔> --out <輸出檔名前綴> [--exclusions <檔>]');
  process.exit(2);
}

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const baseline = read(values.baseline);
const candidate = read(values.candidate);
if (baseline.meta?.partial || candidate.meta?.partial) {
  console.error('其中一份結果是用 --only 產生的部分結果，不能拿來比對。');
  process.exit(2);
}
const exclusions = values.exclusions ? read(values.exclusions) : [];
const report = compareRuns(baseline, candidate, exclusions);

writeFileSync(`${values.out}.json`, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  `${values.out}.md`,
  renderMarkdown(report, { baselineLabel: baseline.meta?.label ?? values.baseline, candidateLabel: candidate.meta?.label ?? values.candidate }),
);
const { summary } = report;
console.log(`相同 ${summary.same}、不同 ${summary.different}、缺少 ${summary.missing}、多出 ${summary.extra}、執行錯誤 ${summary.error}`);
process.exit(summary.same === summary.total ? 0 : 1);
