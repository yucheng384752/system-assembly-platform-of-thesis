// 極薄的 HTTP 包裝：一律回傳 { status, body }，不因非 2xx 丟錯，
// 因為「被拒絕」本身就是要記錄的可觀察結果。連線失敗才丟錯。

export function createHttp(baseUrl, { timeoutMs = 30_000 } = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(root)) {
    throw new Error(`baseUrl 必須以 http:// 或 https:// 開頭，收到：${baseUrl}`);
  }

  async function request(method, path, { headers = {}, json, form, query } = {}) {
    const url = new URL(root + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    } else if (form !== undefined) {
      init.body = form; // FormData：由 fetch 自行產生 multipart 邊界
    }

    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error(`${method} ${path} 連線失敗：${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let body = text;
    if ((response.headers.get('content-type') || '').includes('json')) {
      try {
        body = JSON.parse(text);
      } catch {
        // 宣稱是 JSON 卻解析不了：保留原文，讓情境照實記錄
      }
    }
    return { status: response.status, body };
  }

  return {
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    put: (path, options) => request('PUT', path, options),
    patch: (path, options) => request('PATCH', path, options),
    delete: (path, options) => request('DELETE', path, options),
  };
}

/** 把一個或多個檔案包成 multipart 表單。 */
export function buildForm(fields, files) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields ?? {})) form.set(key, String(value));
  for (const file of files ?? []) {
    form.append(file.field, new Blob([file.data], { type: file.type ?? 'application/octet-stream' }), file.name);
  }
  return form;
}
