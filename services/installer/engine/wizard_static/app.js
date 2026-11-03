'use strict';
// All text goes through textContent; engine output is never inserted as markup.
const base = location.pathname.replace(/[^/]*$/, '');
const $ = id => document.getElementById(id);
const state = { verified: false, licensed: false, planSha: null, rollbackSha: null, poll: null };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

async function call(name, body) {
  const response = await fetch(base + 'api/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!response.ok) return { exitCode: -1, output: [{ message: data.message || '請求失敗' }] };
  return data;
}

function box(target, ok, title, lines) {
  target.replaceChildren();
  const wrapper = el('div', undefined, 'result ' + (ok ? 'ok' : 'fail'));
  wrapper.appendChild(el('strong', title));
  if (lines && lines.length) {
    const list = el('ul');
    for (const line of lines) list.appendChild(el('li', line));
    wrapper.appendChild(list);
  }
  target.appendChild(wrapper);
  return wrapper;
}

function failure(result) {
  const last = [...result.output].reverse().find(item => item && item.message);
  const code = result.exitCode >= 0 ? '（代碼 ' + result.exitCode + '）' : '';
  return (last ? last.message : '失敗') + code;
}

function fields(map) {
  const out = {};
  for (const [key, id] of Object.entries(map)) out[key] = $(id).value.trim();
  return out;
}

function gate() {
  const verifyReady = $('c-manual').checked && ['f-archive', 'f-signature', 'f-key', 'f-prefix'].every(id => $(id).value.trim());
  $('b-verify').disabled = !verifyReady;
  const licenseReady = state.verified && ['f-subkey', 'f-cert', 'f-pass', 'f-expires'].every(id => $(id).value.trim());
  $('b-license').disabled = !licenseReady;
  $('b-plan').disabled = !state.licensed;
  $('c-plan').disabled = !state.planSha;
  $('b-apply').disabled = !(state.planSha && $('c-plan').checked);
  $('b-rollback').disabled = !state.rollbackSha;
}

async function detect() {
  const result = await call('detect');
  const item = result.output.find(o => o.result);
  if (!item) return box($('o-detect'), false, '偵測失敗', [failure(result)]);
  const data = item.result;
  const lines = [
    '作業系統：' + data.os, '可用硬體指紋來源：' + data.fingerprint.validCount + ' 項（授權至少需要 3 項）',
    ...data.fingerprint.sources.map(s => s.source + '：' + (s.valid ? '有效' : '無效或不可讀')),
    ...data.fingerprint.warnings, ...data.problems.map(p => '問題：' + p),
  ];
  box($('o-detect'), data.problems.length === 0, data.problems.length ? '環境未通過' : '環境檢查通過', lines);
}

async function verify() {
  const result = await call('verify', fields({ archive: 'f-archive', signature: 'f-signature', key: 'f-key', prefix: 'f-prefix' }));
  state.verified = result.exitCode === 0;
  const item = result.output.find(o => o.manifestSha256);
  if (state.verified && item) box($('o-verify'), true, '安裝包驗證通過', ['manifest sha256：' + item.manifestSha256, '根公鑰 SPKI 指紋：' + item.keyFingerprint]);
  else box($('o-verify'), false, '安裝包驗證失敗', [failure(result)]);
  gate();
}

async function issueLicense() {
  const body = fields({ subkey: 'f-subkey', certificate: 'f-cert', passphrase: 'f-pass' });
  body.expiresAt = $('f-expires').value + 'T23:59:59Z';
  const result = await call('issue-license', body);
  $('f-pass').value = '';
  state.licensed = result.exitCode === 0;
  box($('o-license'), state.licensed, state.licensed ? '授權已簽發' : '授權簽發失敗', state.licensed ? [] : [failure(result)]);
  gate();
}

function installInput() {
  const env = {};
  for (const name of ['POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'SECRET_KEY', 'ENTRY_PERMISSION_JWT_SECRET',
    'MOD_WEBHOOK_SECRET', 'DEFAULT_TENANT_ID', 'HTTP_PORT', 'LICENSE_BLOCK_WINDOW', 'LICENSE_TIMEZONE']) {
    const value = $('e-' + name).value.trim();
    if (value) env[name] = value;
  }
  const admin = { username: $('a-username').value.trim(), password: $('a-password').value, display_name: $('a-display_name').value.trim() };
  return { env, admin };
}

async function plan() {
  state.planSha = null;
  const result = await call('plan');
  const item = result.output.find(o => o.format === 'composer-install-plan');
  const target = $('o-plan');
  target.replaceChildren();
  if (result.exitCode !== 0 || !item) {
    box(target, false, '計畫產生失敗', [failure(result)]);
    return gate();
  }
  state.planSha = item.planSha256;
  const wrapper = box(target, true, '安裝計畫', ['計畫雜湊：' + item.planSha256]);
  const table = el('table');
  const head = el('tr');
  for (const title of ['步驟', '需要 sudo', '可還原']) head.appendChild(el('th', title));
  table.appendChild(head);
  for (const step of item.steps) {
    const row = el('tr');
    row.append(el('td', step.id), el('td', step.privileged ? '是' : '否'), el('td', step.reversible === 'yes' ? '是' : '部分'));
    table.appendChild(row);
  }
  wrapper.appendChild(table);
  wrapper.appendChild(el('strong', '本版尚未提供'));
  const list = el('ul');
  for (const line of item.notProvided) list.appendChild(el('li', line));
  wrapper.appendChild(list);
  gate();
}

async function apply() {
  $('b-apply').disabled = true;
  const result = await call('apply', { planSha256: state.planSha, input: installInput() });
  for (const id of ['a-password', 'e-POSTGRES_PASSWORD', 'e-SECRET_KEY', 'e-ENTRY_PERMISSION_JWT_SECRET', 'e-MOD_WEBHOOK_SECRET']) $(id).value = '';
  if (result.started) {
    box($('o-apply'), true, '安裝已在背景啟動，關閉瀏覽器不會中斷', []);
    startPolling();
  } else {
    box($('o-apply'), false, '無法開始安裝', [failure(result)]);
    $('b-apply').disabled = false;
  }
}

async function refresh() {
  const result = await call('status');
  const target = $('o-progress');
  const item = result.output.find(o => o.state);
  if (!item) {
    box(target, false, '尚無安裝狀態', [failure(result)]);
    return result;
  }
  const lines = ['狀態：' + item.state.status, ...(item.state.retained || []).map(r => '保留待人工處理：' + r.kind + ' ' + r.name + '（' + r.reason + '）')];
  if (result.applyExit !== null && result.applyExit !== undefined) lines.push('引擎結束代碼：' + result.applyExit);
  const wrapper = box(target, item.state.status !== 'failed', result.applying ? '安裝進行中' : '安裝狀態', lines);
  const table = el('table');
  const head = el('tr');
  for (const title of ['#', '步驟', '狀態']) head.appendChild(el('th', title));
  table.appendChild(head);
  for (const event of item.events.slice(-30)) {
    const row = el('tr');
    row.append(el('td', event.seq), el('td', event.step || ''), el('td', event.status || ''));
    table.appendChild(row);
  }
  wrapper.appendChild(table);
  if (!result.applying) stopPolling();
  return result;
}

function startPolling() {
  stopPolling();
  state.poll = setInterval(refresh, 3000);
  refresh();
}

function stopPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

async function cancel() {
  const result = await call('cancel');
  box($('o-progress'), result.exitCode === 0, result.exitCode === 0 ? '已要求在目前步驟完成後停止' : '無法取消', result.exitCode === 0 ? [] : [failure(result)]);
}

async function rollbackPlan() {
  state.rollbackSha = null;
  const result = await call('rollback-plan', {});
  const item = result.output.find(o => o.format === 'composer-rollback-plan');
  if (result.exitCode !== 0 || !item) {
    box($('o-rbplan'), false, '還原計畫產生失敗', [failure(result)]);
  } else {
    state.rollbackSha = item.planSha256;
    box($('o-rbplan'), true, '還原計畫', ['計畫雜湊：' + item.planSha256, '將還原的步驟（由後往前）：' + item.steps.join('、'), ...(item.warnings || [])]);
  }
  gate();
}

async function rollback() {
  $('b-rollback').disabled = true;
  const result = await call('rollback', { planSha256: state.rollbackSha });
  const done = result.exitCode === 0;
  box($('o-rollback'), done, done ? '已還原' : '還原未完全成功', done ? [] : [failure(result), '請檢視上方狀態中保留待人工處理的項目']);
  refresh();
}

function randomHex(bytes) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
}

function generate() {
  $('e-POSTGRES_PASSWORD').value = randomHex(24);
  $('e-SECRET_KEY').value = randomHex(32);
  $('e-ENTRY_PERMISSION_JWT_SECRET').value = randomHex(32);
  if (!$('e-MOD_WEBHOOK_SECRET').value) $('e-MOD_WEBHOOK_SECRET').value = randomHex(32);
  $('e-DEFAULT_TENANT_ID').value = crypto.randomUUID();
}

for (const id of ['c-manual', 'f-archive', 'f-signature', 'f-key', 'f-prefix', 'f-subkey', 'f-cert', 'f-pass', 'f-expires', 'c-plan']) {
  $(id).addEventListener('input', gate);
  $(id).addEventListener('change', gate);
}
$('b-detect').addEventListener('click', detect);
$('b-verify').addEventListener('click', verify);
$('b-license').addEventListener('click', issueLicense);
$('b-generate').addEventListener('click', generate);
$('b-plan').addEventListener('click', plan);
$('b-apply').addEventListener('click', apply);
$('b-status').addEventListener('click', refresh);
$('b-cancel').addEventListener('click', cancel);
$('b-rbplan').addEventListener('click', rollbackPlan);
$('b-rollback').addEventListener('click', rollback);

call('config').then(config => {
  $('meta').textContent = '系統：' + config.systemId + '；暫存目錄：' + config.workdir;
  state.licensed = !!config.licenseIssued;
  if (config.applying) startPolling();
  gate();
});
gate();
