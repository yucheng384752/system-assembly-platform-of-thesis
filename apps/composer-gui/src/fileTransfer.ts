export function downloadJson(text: string, filename: string): void {
  downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), filename);
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export async function readJsonFile(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('設定檔不可超過 2 MB。');
  if (!/\.json$/i.test(file.name)) throw new Error('請選擇 JSON 設定檔。');
  return (await file.text()).replace(/^\uFEFF/, '');
}
