import type { GanttResult } from './ganttEstimate';

// Static SVG of an estimate. Text is escaped, never HTML; colours follow DESIGN.md tokens.
// State is also carried by text and shape (dashed outline, "缺資料"), not by colour alone.
const C = { text: '#172b3a', muted: '#40576a', primary: '#075e54', border: '#718096', warnBg: '#fdf4e3', warnText: '#7a4b00', panel: '#ffffff' };
const LABEL_W = 220, CHART_W = 640, ROW_H = 30, TOP = 24, PAD = 16, REASON_W = 260;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function renderGanttSvg(estimate: Extract<GanttResult, { ok: true }>): string {
  const { rows, total, lowerBound } = estimate;
  const header = [estimate.disclaimer, ...estimate.conditions, total === null ? `總時長未知（已知部分至少 ${fmt(lowerBound)} 分鐘）` : `總時長 ${fmt(total)} 分鐘`];
  const headerH = header.length * 20 + PAD;
  // A row can start after the latest known end (a transfer follows it), so the axis must reach the latest known start too.
  const horizon = Math.max(lowerBound, total ?? 0, ...rows.map(row => row.start ?? 0)) || 1;
  // A row with a known start and no end writes its reason to the right of its marker; reserve room for it.
  const reasonRoom = rows.some(row => row.start !== undefined && row.end === undefined) ? REASON_W : 0;
  const width = PAD * 2 + LABEL_W + CHART_W + reasonRoom;
  const height = headerH + TOP + rows.length * ROW_H + PAD;
  const scale = CHART_W / horizon;
  const x = (minutes: number) => PAD + LABEL_W + minutes * scale;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc('流程甘特圖（估算）')}" font-family="system-ui, 'Microsoft JhengHei', sans-serif" font-size="13">`,
    `<title>${esc('流程甘特圖（估算）')}</title>`,
    `<rect width="${width}" height="${height}" fill="${C.panel}"/>`,
    `<rect x="${PAD}" y="${PAD / 2}" width="${width - PAD * 2}" height="${headerH - PAD / 2}" fill="${C.warnBg}"/>`,
    ...header.map((line, i) => `<text x="${PAD + 8}" y="${PAD / 2 + 18 + i * 20}" fill="${i === 0 ? C.warnText : C.text}"${i === 0 ? ' font-weight="600"' : ''}>${esc(line)}</text>`),
  ];
  rows.forEach((row, i) => {
    const y = headerH + TOP + i * ROW_H;
    const mid = y + ROW_H / 2;
    out.push(`<text x="${PAD}" y="${mid + 4}" fill="${C.text}">${esc(row.name)}</text>`);
    if (row.start === undefined) {
      out.push(`<text x="${x(0)}" y="${mid + 4}" fill="${C.warnText}">${esc('缺資料：' + row.reasons.join('；'))}</text>`);
    } else if (row.end === undefined) {
      out.push(`<rect x="${x(row.start)}" y="${y + 6}" width="${ROW_H - 12}" height="${ROW_H - 12}" fill="none" stroke="${C.border}" stroke-dasharray="4 3"/>`,
        `<text x="${x(row.start) + ROW_H - 6}" y="${mid + 4}" fill="${C.warnText}">${esc('缺資料：' + row.reasons.join('；'))}</text>`);
    } else if (row.milestone) {
      const cx = x(row.start), r = 7;
      out.push(`<polygon points="${cx},${mid - r} ${cx + r},${mid} ${cx},${mid + r} ${cx - r},${mid}" fill="${C.muted}"><title>${esc(`${row.name}：${fmt(row.start)} 分鐘（里程碑）`)}</title></polygon>`);
    } else {
      out.push(`<rect x="${x(row.start)}" y="${y + 6}" width="${Math.max(2, (row.end - row.start) * scale)}" height="${ROW_H - 12}" fill="${C.primary}"><title>${esc(`${row.name}：${fmt(row.start)} 至 ${fmt(row.end)} 分鐘`)}</title></rect>`);
    }
  });
  out.push('</svg>');
  return out.join('\n');
}
