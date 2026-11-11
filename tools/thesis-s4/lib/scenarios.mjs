// S4 的比對情境。依據：docs/thesis-source-inventory.md（已凍結）
//   - 第 2 節：52 個步驟（P0、L1-L7、U1-U18、Q1-Q8、A1-A6、M1-M9、X1-X3）
//   - 第 3.2 節：權限表 21 列 × 5 種身分
//   - 第 3.5 節：連續失敗情境 T1 至 T10
//
// 情境只用「與系統無關的操作名稱」呼叫轉接層，所以來源系統與產出系統跑的是同一份。
// 順序固定：功能情境 → 權限表 → 連續失敗。後面的情境依賴前面匯入的資料。
import { sleep } from './runner.mjs';
import { LOT_A, LOT_B, LOT_C, LOT_D, LOT_E, p3ProductId } from './synthetic.mjs';

export const ROLES = ['anonymous', 'user', 'manager', 'keyAndAccount', 'keyOnly'];

export const STEP_IDS = [
  'P0',
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `L${n}`),
  ...Array.from({ length: 18 }, (_, i) => `U${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `Q${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `A${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `M${i + 1}`),
  'X1',
  'X2',
  'X3',
];

// 只發生在瀏覽器內、沒有後端請求的步驟：腳本無從比對，留給 S2 逐節點實際操作。
export const UI_ONLY_STEPS = {
  U1: '選擇檔案、副檔名與大小檢查、同名檔案詢問都在瀏覽器內完成',
  U2: '依檔名判定表單種類在瀏覽器內完成（腳本直接指定種類）',
  U7: '在表格中修正內容是瀏覽器內的編輯；腳本以「修正後的檔案」代表其結果（見 U8）',
  U11: '從清單移除檔案只改瀏覽器內的狀態',
  A1: '選擇日期與站別、未選站別時擋下，都在瀏覽器內完成',
};

// 同一次執行內無法涵蓋、需要另一組設定的行為（照實列出，不算已比對）
export const NOT_COVERED = [
  'U13「轉檔服務未設定時回 503」：需要把 PDF_SERVER_URL 留空另跑一次',
  'L5「改密碼成功後其他權杖失效」：同一帳號再次登入本來就會使舊權杖失效，無法另外取得第二個權杖來觀察',
  'L1「場域代碼」相關分支：列為刻意差異（清單第 3.4 節）',
];

const DATE_FROM = '2099-01-01';
const DATE_TO = '2099-01-31';

const obs = async (driver, role, name, args) => (await driver.call(role, name, args)).obs;
const statusOf = async (driver, role, name, args) => (await obs(driver, role, name, args)).status;

async function repeatLogin(driver, account, times, password = 'wrong') {
  const statuses = [];
  for (let i = 0; i < times; i += 1) statuses.push(await statusOf(driver, 'anonymous', 'login', { account, password }));
  return statuses;
}

async function repeatChangePassword(driver, role, times) {
  const statuses = [];
  for (let i = 0; i < times; i += 1) statuses.push(await statusOf(driver, role, 'changePassword', { oldPassword: 'wrong' }));
  return statuses;
}

/** 建立匯入工作並等到驗證結束；回傳觀察結果與工作參照 */
async function validate(driver, role, table, fileKeys, options = {}) {
  const created = await driver.call(role, 'createImportJob', { table, fileKeys, ...options });
  if (created.obs.status !== 201) return { observed: { create: created.obs }, job: null };
  const ready = await obs(driver, role, 'waitImportJob', { job: created.ref, until: ['READY', 'FAILED'] });
  const errors = await obs(driver, role, 'importErrors', { job: created.ref });
  return { observed: { create: created.obs, validated: ready, errors: errors.rows }, job: created.ref };
}

async function commit(driver, role, job) {
  const requested = await statusOf(driver, role, 'commitImportJob', { job });
  const done = await obs(driver, role, 'waitImportJob', { job, until: ['COMPLETED', 'FAILED'] });
  return { requested, state: done.state };
}

const functional = [
  {
    id: 'P0-未登入被拒',
    steps: ['P0'],
    async run(d) {
      return {
        query: await statusOf(d, 'anonymous', 'queryRecords', { lot: LOT_A, type: 'P1' }),
        import: await statusOf(d, 'anonymous', 'createImportJob', { table: 'P1', fileKeys: ['p1A'] }),
        analyze: await statusOf(d, 'anonymous', 'analyze', { dateFrom: DATE_FROM, dateTo: DATE_TO, stations: ['P2'] }),
        users: await statusOf(d, 'anonymous', 'listUsers'),
      };
    },
  },
  {
    id: 'L-登入與權杖',
    steps: ['L1', 'L3', 'L4', 'L6'],
    async run(d) {
      await d.provision('s4_login', 'user');
      const firstToken = d.currentToken('s4_login');
      const whoami = await obs(d, { account: 's4_login' }, 'whoami');
      const secondLogin = await statusOf(d, 'anonymous', 'login', { account: 's4_login' });
      return {
        whoami,
        secondLogin,
        // L3：同一帳號再次登入後，舊權杖是否還能用
        oldTokenAfterRelogin: await statusOf(d, 'anonymous', 'tokenWorks', { token: firstToken }),
        // L6：登出只清瀏覽器內的權杖，不呼叫後端；所以「登出後」權杖在後端仍有效
        tokenAfterLogout: await statusOf(d, 'anonymous', 'tokenWorks', { token: d.currentToken('s4_login') }),
        wrongPassword: await statusOf(d, 'anonymous', 'login', { account: 's4_login', password: 'wrong' }),
        unknownAccount: await statusOf(d, 'anonymous', 'login', { account: 's4_no_such_account', password: 'wrong' }),
      };
    },
  },
  {
    id: 'L5-自己改密碼',
    steps: ['L5', 'M9'],
    async run(d) {
      await d.provision('s4_pw', 'user');
      const role = { account: 's4_pw' };
      return {
        change: await statusOf(d, role, 'changePassword', {}),
        loginWithNewPassword: await statusOf(d, 'anonymous', 'login', { account: 's4_pw' }),
        auditRecorded: await obs(d, role, 'auditRecorded', { kind: 'passwordChange' }),
      };
    },
  },
  {
    id: 'L7-管理者解鎖',
    steps: ['L7'],
    async run(d) {
      return {
        validKey: await statusOf(d, 'anonymous', 'unlockAdmin', { key: 'valid' }),
        invalidKey: await statusOf(d, 'anonymous', 'unlockAdmin', { key: 'invalid' }),
      };
    },
  },
  {
    id: 'U-合法檔案的驗證與匯入',
    steps: ['U3', 'U5', 'U9', 'U10'],
    async run(d) {
      const out = {};
      const plan = [
        ['p1A', 'P1'],
        ['p1B', 'P1'],
        ['p2A', 'P2'],
        ['p2B', 'P2'],
        ['p2FilenameWinder', 'P2'],
        ['p3AB', 'P3'],
      ];
      for (const [key, table] of plan) {
        const { observed, job } = await validate(d, 'user', table, [key]);
        out[key] = job ? { ...observed, commit: await commit(d, 'user', job) } : observed;
      }
      return out;
    },
  },
  {
    id: 'U4-U17-內容重複與取消',
    steps: ['U4', 'U17'],
    async run(d) {
      const duplicate = await obs(d, 'user', 'createImportJob', { table: 'P1', fileKeys: ['p1A'] });
      const { observed, job } = await validate(d, 'user', 'P1', ['p1A'], { allowDuplicate: true });
      return {
        duplicate,
        allowed: observed,
        cancel: await obs(d, 'user', 'cancelImportJob', { job }),
        cancelAgain: await obs(d, 'user', 'cancelImportJob', { job }),
        commitCancelled: await statusOf(d, 'user', 'commitImportJob', { job }),
      };
    },
  },
  {
    id: 'U6-U8-錯誤列與重新驗證',
    steps: ['U6', 'U8'],
    async run(d) {
      const first = await validate(d, 'user', 'P1', ['p1Mixed']);
      const fixed = await validate(d, 'user', 'P1', ['p1MixedFixed']);
      return {
        withErrors: first.observed,
        afterFix: fixed.observed,
        commit: await commit(d, 'user', fixed.job),
        imported: await obs(d, 'user', 'queryRecords', { lot: LOT_C, type: 'P1' }),
      };
    },
  },
  {
    id: 'U9-匯入失敗與被拒',
    steps: ['U9', 'U10'],
    async run(d) {
      const twoLots = await validate(d, 'user', 'P1', ['p1TwoLots']);
      const noDate = await validate(d, 'user', 'P3', ['p3NoDate']);
      const missingLot = await validate(d, 'user', 'P3', ['p3MissingLot']);
      const done = await validate(d, 'user', 'P1', ['p1B'], { allowDuplicate: true });
      const doneCommit = await commit(d, 'user', done.job);
      return {
        twoLots: { ...twoLots.observed, commit: await commit(d, 'user', twoLots.job) },
        noDate: { ...noDate.observed, commit: await commit(d, 'user', noDate.job) },
        missingLot: { ...missingLot.observed, commit: await commit(d, 'user', missingLot.job) },
        missingLotImported: await obs(d, 'user', 'queryRecords', { lot: LOT_D, type: 'P3' }),
        unsupportedExtension: await statusOf(d, 'user', 'createImportJob', { table: 'P1', fileKeys: ['notCsv'] }),
        unknownTable: await statusOf(d, 'user', 'createImportJob', { table: 'P9', fileKeys: ['p1A'], allowDuplicate: true }),
        unknownJob: await statusOf(d, 'user', 'importJobState', { job: '00000000-0000-0000-0000-000000000000' }),
        commitCompleted: { first: doneCommit, again: await statusOf(d, 'user', 'commitImportJob', { job: done.job }) },
      };
    },
  },
  {
    id: 'U12-PDF上傳檢查',
    steps: ['U12'],
    async run(d) {
      return {
        notPdf: await statusOf(d, 'user', 'uploadPdf', { fileKey: 'pdfNotPdf' }),
        empty: await statusOf(d, 'user', 'uploadPdf', { fileKey: 'pdfEmpty' }),
        wrongExtension: await statusOf(d, 'user', 'uploadPdf', { fileKey: 'notCsv' }),
      };
    },
  },
  {
    id: 'U13-U18-PDF轉檔成功',
    steps: ['U12', 'U13', 'U14', 'U15', 'U16', 'U18'],
    async run(d) {
      const upload = await d.call('user', 'uploadPdf', { fileKey: 'pdfOk' });
      const pdf = upload.ref;
      const out = { upload: upload.obs };
      out.convert = await statusOf(d, 'user', 'convertPdf', { pdf });
      out.convertAgain = await statusOf(d, 'user', 'convertPdf', { pdf });
      out.converted = await obs(d, 'user', 'waitPdf', { pdf });
      const outputs = await d.call('user', 'pdfOutputs', { pdf });
      out.outputs = outputs.obs;
      // U16：轉出的 CSV 走與一般 CSV 相同的驗證與匯入
      out.imports = {};
      for (const file of outputs.obs.files) {
        const table = file.name.slice(0, 2).toUpperCase();
        const created = await d.call('user', 'createImportJobFromText', { table, name: file.name, text: file.csv });
        const validated = await obs(d, 'user', 'waitImportJob', { job: created.ref, until: ['READY', 'FAILED'] });
        out.imports[file.name] = { create: created.obs, validated, commit: await commit(d, 'user', created.ref) };
      }
      out.importedP1 = await obs(d, 'user', 'queryRecords', { lot: LOT_E, type: 'P1' });
      out.importedP2 = await obs(d, 'user', 'queryRecords', { lot: LOT_E, type: 'P2' });
      out.ingest = await obs(d, 'user', 'ingestPdf', { pdf });
      out.ingestAgain = await obs(d, 'user', 'ingestPdf', { pdf });
      return out;
    },
  },
  {
    id: 'U13-PDF轉檔服務回錯誤',
    steps: ['U13', 'U14', 'U18'],
    async run(d) {
      const upload = await d.call('user', 'uploadPdf', { fileKey: 'pdfFail' });
      const pdf = upload.ref;
      return {
        convert: await statusOf(d, 'user', 'convertPdf', { pdf }),
        result: await obs(d, 'user', 'waitPdf', { pdf }),
        outputs: await statusOf(d, 'user', 'pdfOutputs', { pdf }),
        ingest: await statusOf(d, 'user', 'ingestPdf', { pdf }),
        convertAgainAfterFailure: await statusOf(d, 'user', 'convertPdf', { pdf }),
      };
    },
  },
  {
    id: 'U13-PDF轉檔服務逾時',
    steps: ['U13', 'U14'],
    async run(d) {
      // 需要系統把轉檔逾時設短（來源：PDF_SERVER_TIMEOUT_SECONDS），否則這個情境會等到逾時並記為執行錯誤
      const upload = await d.call('user', 'uploadPdf', { fileKey: 'pdfHang' });
      const pdf = upload.ref;
      const convert = await statusOf(d, 'user', 'convertPdf', { pdf });
      const ingestWhileRunning = await statusOf(d, 'user', 'ingestPdf', { pdf });
      return { convert, ingestWhileRunning, result: await obs(d, 'user', 'waitPdf', { pdf, timeoutMs: 90_000 }) };
    },
  },
  {
    id: 'Q1-批號建議',
    steps: ['Q1'],
    async run(d) {
      return {
        match: await obs(d, 'user', 'suggestLots', { term: '99010' }),
        none: await obs(d, 'user', 'suggestLots', { term: 'zzzz' }),
      };
    },
  },
  {
    id: 'Q2-A6-產品追溯',
    steps: ['Q2', 'A6'],
    async run(d) {
      return {
        lotA: await obs(d, 'user', 'traceProduct', { productId: p3ProductId(2) }),
        lotB: await obs(d, 'user', 'traceProduct', { productId: p3ProductId(4) }),
        unknown: await obs(d, 'user', 'traceProduct', { productId: '20990103_P99_M-799_999' }),
      };
    },
  },
  {
    id: 'Q3-批號查詢',
    steps: ['Q3'],
    async run(d) {
      const out = {};
      for (const type of ['P1', 'P2', 'P3']) out[type] = await obs(d, 'user', 'queryRecords', { lot: LOT_A, type });
      out.p2FilenameWinder = await obs(d, 'user', 'queryRecords', { lot: LOT_D, type: 'P2' });
      out.empty = await obs(d, 'user', 'queryRecords', { lot: '9909099_09', type: 'P1' });
      return out;
    },
  },
  {
    id: 'Q4-進階查詢',
    steps: ['Q4'],
    async run(d) {
      const out = { options: {} };
      for (const field of ['machine_no', 'mold_no', 'specification', 'material']) {
        out.options[field] = await obs(d, 'user', 'queryOptions', { field });
      }
      out.byMachine = await obs(d, 'user', 'queryAdvanced', { type: 'P3', machine: 'P91' });
      out.byMold = await obs(d, 'user', 'queryAdvanced', { type: 'P3', mold: 'M-701' });
      out.bySpecification = await obs(d, 'user', 'queryAdvanced', { type: 'P2', specification: 'SYN-B 12' });
      out.byMaterial = await obs(d, 'user', 'queryAdvanced', { type: 'P2', material: 'H2', lot: LOT_B });
      out.noMatch = await obs(d, 'user', 'queryAdvanced', { type: 'P3', machine: 'P00' });
      return out;
    },
  },
  {
    id: 'Q5-收卷機追溯',
    steps: ['Q5'],
    async run(d) {
      return {
        winder3: await obs(d, 'user', 'traceWinder', { lot: LOT_A, winder: 3 }),
        noSuchWinder: await obs(d, 'user', 'traceWinder', { lot: LOT_A, winder: 9 }),
      };
    },
  },
  {
    id: 'Q6-Q8-修改紀錄與原因代碼',
    steps: ['Q6', 'Q7', 'Q8', 'M9'],
    async run(d) {
      const out = {};
      out.initReasons = await obs(d, 'user', 'initReasons');
      const created = await d.call('user', 'createReason', { code: 'S4_REASON', description: 'S4 合成原因' });
      out.createReason = created.obs;
      out.createDuplicate = await statusOf(d, 'user', 'createReason', { code: 'S4_REASON', description: 'S4 合成原因' });
      out.updateReason = await obs(d, 'user', 'updateReason', { reason: created.ref, description: 'S4 合成原因（已修改）' });
      out.listReasons = await obs(d, 'user', 'listReasons');
      out.edit = await obs(d, 'user', 'editRecord', { type: 'P1', lot: LOT_B, updates: { s4_note: 'checked' }, reasonText: 'S4_REASON' });
      out.editForbiddenField = await statusOf(d, 'user', 'editRecord', { type: 'P1', lot: LOT_B, updates: { created_at: '2099-01-01T00:00:00Z' } });
      out.history = await obs(d, 'user', 'recordEdits', { type: 'P1', lot: LOT_B, keys: ['s4_note'] });
      out.auditRecorded = await obs(d, 'user', 'auditRecorded', { kind: 'recordEdit' });
      return out;
    },
  },
  {
    id: 'A2-執行分析',
    steps: ['A2'],
    async run(d) {
      return {
        p2: await obs(d, 'user', 'analyze', { dateFrom: DATE_FROM, dateTo: DATE_TO, stations: ['P2'] }),
        all: await obs(d, 'user', 'analyze', { dateFrom: DATE_FROM, dateTo: DATE_TO, stations: ['ALL'] }),
        byProduct: await obs(d, 'user', 'analyze', { stations: ['P3'], productIds: [p3ProductId(1)] }),
      };
    },
  },
  {
    id: 'A3-NG明細',
    steps: ['A3'],
    async run(d) {
      return {
        p2: await obs(d, 'user', 'queryAdvanced', { type: 'P2', ngOnly: true, dateFrom: DATE_FROM, dateTo: DATE_TO }),
        p2Winder3: await obs(d, 'user', 'queryAdvanced', { type: 'P2', ngOnly: true, winder: 3 }),
        p3: await obs(d, 'user', 'queryAdvanced', { type: 'P3', ngOnly: true, dateFrom: DATE_FROM, dateTo: DATE_TO }),
      };
    },
  },
  {
    id: 'A4-萃取分析分數',
    steps: ['A4'],
    async run(d) {
      return { p2: await obs(d, 'user', 'extractionAnalysis', { station: 'P2', dateFrom: DATE_FROM, dateTo: DATE_TO }) };
    },
  },
  {
    id: 'A5-分析產出',
    steps: ['A5'],
    async run(d) {
      return {
        artifacts: await obs(d, 'user', 'analysisArtifacts'),
        complaint: await obs(d, 'user', 'complaintAnalysis', { productIds: [p3ProductId(2), 'S4_UNKNOWN_ID'] }),
      };
    },
  },
  {
    id: 'M1-M5-使用者管理',
    steps: ['M1', 'M2', 'M3', 'M4', 'M5'],
    async run(d) {
      const out = {};
      out.create = await statusOf(d, 'manager', 'createUser', { username: 's4_new' });
      out.createDuplicate = await statusOf(d, 'manager', 'createUser', { username: 's4_new' });
      out.reset = await statusOf(d, 'manager', 'resetPassword', { username: 's4_new' });
      out.loginAfterReset = await statusOf(d, 'anonymous', 'login', { account: 's4_new' });
      out.resetSelf = await statusOf(d, 'manager', 'resetPassword', { username: 's4_manager' });
      out.promote = await statusOf(d, 'manager', 'updateUser', { username: 's4_new', changes: { role: 'manager' } });
      out.demote = await statusOf(d, 'manager', 'updateUser', { username: 's4_new', changes: { role: 'user' } });
      // 此時 s4_manager 是唯一的 Manager
      out.demoteLastManager = await statusOf(d, 'manager', 'updateUser', { username: 's4_manager', changes: { role: 'user' } });
      out.deleteLastManager = await statusOf(d, 'manager', 'deleteUser', { username: 's4_manager' });
      out.delete = await statusOf(d, 'manager', 'deleteUser', { username: 's4_new' });
      out.list = await obs(d, 'manager', 'listUsers');
      // 管理者金鑰不受「最後一位 Manager」限制；做完立刻改回來
      out.keyDemotesLastManager = await statusOf(d, 'keyOnly', 'updateUser', { username: 's4_manager', changes: { role: 'user' } });
      out.keyRestoresManager = await statusOf(d, 'keyOnly', 'updateUser', { username: 's4_manager', changes: { role: 'manager' } });
      return out;
    },
  },
  {
    id: 'M6-系統日誌',
    steps: ['M6'],
    async run(d) {
      return obs(d, 'manager', 'systemLogs');
    },
  },
  {
    id: 'M7-M8-站點設定',
    steps: ['M7', 'M8'],
    async run(d) {
      return {
        read: await obs(d, 'user', 'readStations', { code: 'P1' }),
        write: await obs(d, 'keyAndAccount', 'writeStations', { code: 'S4F' }),
      };
    },
  },
  {
    id: 'M9-稽核事件',
    steps: ['M9'],
    async run(d) {
      return { importCommit: await obs(d, 'user', 'auditRecorded', { kind: 'importCommit' }) };
    },
  },
  {
    id: 'X-外部讀取端點',
    steps: ['X1', 'X2', 'X3'],
    async run(d) {
      const out = {};
      for (const group of ['X1', 'X2', 'X3']) out[group] = await obs(d, 'user', 'externalEndpoints', { group });
      return out;
    },
  },
];

// ---- 權限表：每一列對五種身分各做一次，記錄狀態碼 ----

/** 每一列：label 對應清單 3.2 的操作名稱；probe(driver, role, index) 回傳該身分的觀察結果 */
const PERMISSION_ROWS = [
  { key: '01-登入', steps: ['L1'], probe: (d) => statusOf(d, 'anonymous', 'login', { account: 's4_perm_login' }) },
  { key: '02-查看目前身分', steps: ['L4'], probe: (d, role) => statusOf(d, role, 'whoami') },
  { key: '03-自己改密碼', steps: ['L5'], probe: (d, role) => statusOf(d, role, 'changePassword', {}) },
  {
    key: '04-解鎖管理者頁籤',
    steps: ['L7'],
    probe: async (d) => ({
      validKey: await statusOf(d, 'anonymous', 'unlockAdmin', { key: 'valid' }),
      invalidKey: await statusOf(d, 'anonymous', 'unlockAdmin', { key: 'invalid' }),
    }),
  },
  {
    key: '05-CSV建立匯入工作與查狀態',
    steps: ['U3', 'U4', 'U5', 'U6', 'U8'],
    async probe(d, role) {
      const created = await d.call(role, 'createImportJob', { table: 'P1', fileKeys: ['p1A'], allowDuplicate: true });
      return {
        create: created.obs.status,
        state: await statusOf(d, role, 'importJobState', { job: created.ref }),
        errors: await statusOf(d, role, 'importErrors', { job: created.ref }),
      };
    },
  },
  {
    key: '06-匯入與取消',
    steps: ['U9', 'U17'],
    async probe(d, role) {
      const jobs = [];
      for (let i = 0; i < 2; i += 1) {
        const created = await d.call(role, 'createImportJob', { table: 'P1', fileKeys: ['p1A'], allowDuplicate: true });
        if (created.obs.status === 201) await d.call(role, 'waitImportJob', { job: created.ref, until: ['READY', 'FAILED'] });
        jobs.push(created.ref);
      }
      return {
        commit: await statusOf(d, role, 'commitImportJob', { job: jobs[0] }),
        cancel: await statusOf(d, role, 'cancelImportJob', { job: jobs[1] }),
      };
    },
  },
  {
    key: '07-PDF上傳轉檔與後續',
    steps: ['U12', 'U13', 'U14', 'U15', 'U18'],
    async probe(d, role) {
      const upload = await d.call(role, 'uploadPdf', { fileKey: 'pdfOk' });
      const pdf = upload.ref;
      const out = { upload: upload.obs.status, convert: await statusOf(d, role, 'convertPdf', { pdf }) };
      if (out.convert === 200) await d.call(role, 'waitPdf', { pdf });
      out.status = await statusOf(d, role, 'pdfStatus', { pdf });
      out.outputs = await statusOf(d, role, 'pdfOutputs', { pdf });
      out.ingest = await statusOf(d, role, 'ingestPdf', { pdf });
      return out;
    },
  },
  {
    key: '08-查詢與追溯',
    steps: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
    probe: async (d, role) => ({
      suggest: await statusOf(d, role, 'suggestLots', { term: '99010' }),
      records: await statusOf(d, role, 'queryRecords', { lot: LOT_A, type: 'P1' }),
      advanced: await statusOf(d, role, 'queryAdvanced', { type: 'P3', machine: 'P91' }),
      options: await statusOf(d, role, 'queryOptions', { field: 'machine_no' }),
      traceProduct: await statusOf(d, role, 'traceProduct', { productId: p3ProductId(2) }),
      traceWinder: await statusOf(d, role, 'traceWinder', { lot: LOT_A, winder: 3 }),
    }),
  },
  {
    key: '09-修改紀錄與修改歷史',
    steps: ['Q6', 'Q7'],
    probe: async (d, role, index) => ({
      edit: await statusOf(d, role, 'editRecord', { type: 'P1', lot: LOT_A, updates: { s4_perm: `r${index}` } }),
      history: await statusOf(d, role, 'recordEdits', { type: 'P1', lot: LOT_A, keys: ['s4_perm'] }),
    }),
  },
  {
    key: '10-分析',
    steps: ['A2', 'A3', 'A4', 'A5', 'A6'],
    probe: async (d, role) => ({
      analyze: await statusOf(d, role, 'analyze', { dateFrom: DATE_FROM, dateTo: DATE_TO, stations: ['P2'] }),
      ngDetail: await statusOf(d, role, 'queryAdvanced', { type: 'P2', ngOnly: true }),
      extraction: await statusOf(d, role, 'extractionAnalysis', { station: 'P2', dateFrom: DATE_FROM, dateTo: DATE_TO }),
      artifacts: await statusOf(d, role, 'analysisArtifacts'),
      complaint: await statusOf(d, role, 'complaintAnalysis', { productIds: [p3ProductId(2)] }),
    }),
  },
  { key: '11-列出使用者', steps: ['M1'], probe: (d, role) => statusOf(d, role, 'listUsers') },
  { key: '12-新增使用者', steps: ['M2'], probe: (d, role, index) => statusOf(d, role, 'createUser', { username: `s4_pc_${index}` }) },
  {
    key: '13-修改使用者',
    steps: ['M3'],
    probe: (d, role, index) => statusOf(d, role, 'updateUser', { username: `s4_pt_${index}`, changes: { role: 'manager' } }),
  },
  { key: '14-刪除使用者', steps: ['M4'], probe: (d, role, index) => statusOf(d, role, 'deleteUser', { username: `s4_pt_${index}` }) },
  { key: '15-重設他人密碼', steps: ['M5'], probe: (d, role, index) => statusOf(d, role, 'resetPassword', { username: `s4_pr_${index}` }) },
  { key: '16-系統日誌', steps: ['M6'], probe: (d, role) => obs(d, role, 'systemLogs') },
  {
    key: '17-讀取站點設定',
    steps: ['M7'],
    async probe(d, role) {
      const { codes, ...statuses } = await obs(d, role, 'readStations', { code: 'P1' });
      return statuses;
    },
  },
  { key: '18-修改站點設定', steps: ['M8'], probe: async (d, role, index) => (await obs(d, role, 'writeStations', { code: `S4P${index}` })).steps },
  { key: '19-稽核事件查詢', steps: ['M9'], probe: (d, role) => statusOf(d, role, 'auditRecorded', { kind: 'recordEdit' }) },
  {
    key: '20-修改原因代碼',
    steps: ['Q8'],
    async probe(d, role, index) {
      const created = await d.call(role, 'createReason', { code: `S4_PR_${index}`, description: 'S4 權限表探測' });
      return {
        create: created.obs.status,
        update: await statusOf(d, role, 'updateReason', { reason: created.ref, description: 'S4 權限表探測（已修改）' }),
        init: await statusOf(d, role, 'initReasons'),
      };
    },
  },
  {
    key: '21-外部讀取端點',
    steps: ['X1', 'X2', 'X3'],
    async probe(d, role) {
      const out = {};
      for (const group of ['X1', 'X2', 'X3']) out[group] = (await obs(d, role, 'externalEndpoints', { group })).statuses;
      return out;
    },
  },
];

const permissionSetup = {
  id: 'PERM-00-準備帳號',
  steps: [],
  async run(d) {
    await d.provision('s4_perm_login', 'user');
    for (let index = 0; index < ROLES.length; index += 1) {
      await d.provision(`s4_pt_${index}`, 'user', { login: false });
      await d.provision(`s4_pr_${index}`, 'user', { login: false });
    }
    return { prepared: true };
  },
};

const permissions = PERMISSION_ROWS.map((row) => ({
  id: `PERM-${row.key}`,
  steps: row.steps,
  permissionRow: row.key,
  async run(d) {
    const out = {};
    for (let index = 0; index < ROLES.length; index += 1) out[ROLES[index]] = await row.probe(d, ROLES[index], index);
    return out;
  },
}));

// ---- 連續失敗的阻擋（清單 3.5）----

const throttling = [
  {
    id: 'T1-T2-登入連續失敗與過期',
    steps: ['L2', 'T1', 'T2'],
    async run(d) {
      await d.provision('s4_t1', 'user', { login: false });
      const failures = await repeatLogin(d, 's4_t1', 5);
      const sixthWithCorrectPassword = await statusOf(d, 'anonymous', 'login', { account: 's4_t1' });
      await (d.sleep ?? sleep)(61_000); // T2：等最早一次失敗超過 60 秒（測試用的替身可換掉等待）
      return { failures, sixthWithCorrectPassword, after61Seconds: await statusOf(d, 'anonymous', 'login', { account: 's4_t1' }) };
    },
  },
  {
    id: 'T3-不存在的帳號也計數',
    steps: ['L2', 'T3'],
    async run(d) {
      return { failures: await repeatLogin(d, 's4_t3_ghost', 5), sixth: (await repeatLogin(d, 's4_t3_ghost', 1))[0] };
    },
  },
  {
    id: 'T4-換來源位址另起計數',
    steps: ['L2', 'T4'],
    async run(d) {
      if (!d.hasAltAddress) throw new Error('未執行：需要第二個來源位址（--alt-base-url）');
      await d.provision('s4_t4', 'user', { login: false });
      const failures = await repeatLogin(d, 's4_t4', 5);
      return {
        failures,
        sixthFromSameAddress: await statusOf(d, 'anonymous', 'login', { account: 's4_t4' }),
        fromOtherAddress: await statusOf(d, 'anonymous', 'login', { account: 's4_t4', via: 'alt' }),
      };
    },
  },
  {
    id: 'T5-登入成功後計數清空',
    steps: ['L2', 'T5'],
    async run(d) {
      await d.provision('s4_t5', 'user', { login: false });
      const firstFailures = await repeatLogin(d, 's4_t5', 4);
      const success = await statusOf(d, 'anonymous', 'login', { account: 's4_t5' });
      const secondFailures = await repeatLogin(d, 's4_t5', 4);
      return { firstFailures, success, secondFailures, successAgain: await statusOf(d, 'anonymous', 'login', { account: 's4_t5' }) };
    },
  },
  {
    id: 'T7-T8-改密碼連續失敗',
    steps: ['L5', 'T7', 'T8'],
    async run(d) {
      await d.provision('s4_t8', 'user');
      const role = { account: 's4_t8' };
      const failures = await repeatChangePassword(d, role, 10);
      return { failures, eleventhWithCorrectOldPassword: await statusOf(d, role, 'changePassword', {}) };
    },
  },
  {
    id: 'T9-T10-改密碼的其他拒絕',
    steps: ['L5', 'T9', 'T10'],
    async run(d) {
      await d.provision('s4_t9', 'user');
      const role = { account: 's4_t9' };
      return {
        sameAsOld: await statusOf(d, role, 'changePassword', { newPassword: 'same' }),
        tooShort: await statusOf(d, role, 'changePassword', { newPassword: 'short' }),
        // 上面兩次都不該計入失敗：之後用正確的舊密碼仍然能改
        stillAllowed: await statusOf(d, role, 'changePassword', {}),
      };
    },
  },
  {
    // 必須是主階段的最後一個情境：它留下一個「已被擋下」的計數，等服務重啟後再檢查
    id: 'T6-重啟前-鎖住計數',
    steps: ['L2', 'T6'],
    async run(d, shared) {
      const failures = await repeatLogin(d, 's4_t6_ghost', 5);
      const sixth = (await repeatLogin(d, 's4_t6_ghost', 1))[0];
      shared.t6LockedAt = Date.now();
      return { failures, sixth };
    },
  },
  {
    id: 'T6-重啟後-計數是否清空',
    steps: ['L2', 'T6'],
    phase: 'after-restart',
    async run(d, shared) {
      if (!shared.t6LockedAt) throw new Error('未執行：找不到主階段記下的鎖住時間（--previous）');
      const elapsed = Date.now() - shared.t6LockedAt;
      // 超過 60 秒時來源的計數本來就會自然過期，量不出「重啟」造成的差別
      if (elapsed > 55_000) throw new Error(`未執行：距離鎖住已 ${Math.round(elapsed / 1000)} 秒，超過 55 秒，無法區分重啟清空與自然過期`);
      return { afterRestart: (await repeatLogin(d, 's4_t6_ghost', 1))[0] };
    },
  },
];

export const SCENARIOS = [...functional, permissionSetup, ...permissions, ...throttling];
export const PERMISSION_ROW_KEYS = PERMISSION_ROWS.map((row) => row.key);
export const THROTTLE_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];
