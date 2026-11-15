// 判斷 claude -p（stream-json）是否因用量上限而停止。
// 注意：上限訊息的確切文字沒有在本機實測過（無法安全觸發），所以樣式可由
// CLAUDE_LIMIT_PATTERN 覆寫；判斷不出來時一律當作「一般失敗」並停止，不自動換人。
export const DEFAULT_LIMIT_PATTERN = /usage limit|rate limit|limit reached|out of (extra )?usage|quota|resets? at/i;

export function parseStream(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 非 JSON 行略過；最終判斷以 result 事件為準
    }
  }
  return events;
}

export function classify(events, exitCode, pattern = DEFAULT_LIMIT_PATTERN) {
  const result = [...events].reverse().find((e) => e.type === 'result');
  const lastAssistant = [...events].reverse().find((e) => e.type === 'assistant');
  const text = (lastAssistant?.message?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (result && !result.is_error && exitCode === 0) return { kind: 'done', text: result.result ?? text };
  const blob = `${result?.result ?? ''} ${JSON.stringify(result?.errors ?? '')}`;
  if (pattern.test(blob)) return { kind: 'limit', text };
  return { kind: 'error', text, detail: blob.trim() || `exit ${exitCode}，沒有 result 事件` };
}
