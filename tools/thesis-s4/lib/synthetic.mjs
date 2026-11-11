// S4 的合成輸入檔（docs/handoff-product-and-thesis.md 第 4.4 節）。
//
// - 欄位名稱只取自來源「程式碼」：be/services/csv_field_mapper.py、be/services/import_v2.py、
//   be/api/routes_query_v2.py、be/api/traceability.py。沒有讀任何來源的資料檔。
// - 所有批號、日期、機台、模具、規格與數值都是編造的：批號年份用 99（西元 2099 年），
//   機台 P9x、模具 M-70x、規格 SYN-*，不對應任何實際生產資料。
// - 內容完全由本檔決定，沒有亂數與時間，重跑會得到相同位元組。

export const LOT_A = '9901011_01';
export const LOT_B = '9902022_02';
export const LOT_C = '9903033_03'; // 只出現在「部分列有錯」的檔案
export const LOT_D = '9904044_04'; // 檔名帶收卷機編號、內容沒有收卷機欄
export const LOT_E = '9905055_05'; // 只經由 PDF 轉檔進入
export const LOT_F = '9906066_06'; // 一個檔案兩個批號（匯入應失敗）用
export const LOT_G = '9907077_07';

export const P3_MACHINE = 'P91';
export const P3_MOLD = 'M-701';
export const P3_DATE = '2099-01-03';
export const P3_DATE_COMPACT = '20990103';

export const HEADERS = {
  P1: [
    'LOT NO.',
    'Production Date',
    'Material',
    'Specification',
    'Machine NO',
    'Line Speed(M/min)',
    'Extruder Speed(rpm)',
    'Actual Temp_C1(℃)',
    'Set Temp_C1(℃)',
  ],
  P2: [
    'Semi-finished productsLOT NO',
    'Winder number',
    'Slitting date',
    'Striped Results',
    'format',
    'Material',
    'Slitting machine',
    'Sheet Width(mm)',
    'Thicknessss1(μm)',
    'Appearance',
    'sheet_width',
    'thickness1',
  ],
  P3: [
    'LOT NO',
    'year-month-day',
    'Machine NO',
    'Mold NO',
    'lot',
    'Source Winder',
    'Specification',
    'Bottom Tape',
    'Product ID',
    'E Value',
    'Burr',
    'Finish',
  ],
};

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvText(headers, rows) {
  return `${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\n')}\n`;
}

function p1Row(lot, { material = 'H2', spec = 'SYN-A 10', speed = '12.5' } = {}) {
  return [lot, '2099-01-01', material, spec, 'E91', speed, '45', '201', '200'];
}

function p2Row(lot, winder, result, { withWinder = true, spec = 'SYN-A 10' } = {}) {
  const row = [lot, winder, '20990102', result, spec, 'H2', '3', '120.5', '31', '1', '120.5', '0.31'];
  if (!withWinder) row.splice(1, 1);
  return row;
}

export function p3ProductId(lotSeq) {
  return `${P3_DATE_COMPACT}_${P3_MACHINE}_${P3_MOLD}_${lotSeq}`;
}

function p3Row(lot, lotSeq, sourceWinder, finish, spec = 'SYN-P 20') {
  return [lot, P3_DATE, P3_MACHINE, P3_MOLD, lotSeq, sourceWinder, spec, 'BT-901', p3ProductId(lotSeq), '0.5', '0', finish];
}

const withoutWinder = HEADERS.P2.filter((header) => header !== 'Winder number');
const withoutDate = HEADERS.P3.filter((header) => header !== 'year-month-day');

// 最小的合成 PDF：只需要通過「以 %PDF- 開頭」的檢查，內容不代表任何文件。
const PDF_BYTES = Buffer.from('%PDF-1.4\n% synthetic placeholder for S4, no real content\n%%EOF\n', 'latin1');

/**
 * 每個檔案：name 檔名、table 表單種類（PDF 與拒收檔為 null）、data 內容、purpose 用途。
 * 檔名會影響行為（依檔名判定種類、收卷機、機台），所以是輸入的一部分。
 */
export function inputFiles() {
  const files = [
    {
      key: 'p1A',
      name: `P1_${LOT_A}.csv`,
      table: 'P1',
      purpose: '合法的 P1，一個批號；中間夾一列空白列（應略過）',
      text: csvText(HEADERS.P1, [p1Row(LOT_A), ['', '', '', '', '', '', '', '', '']]),
    },
    {
      key: 'p1B',
      name: `P1_${LOT_B}.csv`,
      table: 'P1',
      purpose: '合法的 P1，第二個批號，材料不同',
      text: csvText(HEADERS.P1, [p1Row(LOT_B, { material: 'H5', spec: 'SYN-B 12' })]),
    },
    {
      key: 'p1Mixed',
      name: `P1_${LOT_C}.csv`,
      table: 'P1',
      purpose: '三列：合法、批號格式錯、批號空白；驗證應回報第 2、3 列有錯',
      text: csvText(HEADERS.P1, [p1Row(LOT_C), p1Row('BADLOT'), p1Row('')]),
    },
    {
      key: 'p1MixedFixed',
      name: `P1_${LOT_C}.csv`,
      table: 'P1',
      purpose: 'p1Mixed 修正後的內容（重新驗證用）',
      text: csvText(HEADERS.P1, [p1Row(LOT_C)]),
    },
    {
      key: 'p1TwoLots',
      name: `P1_${LOT_F}.csv`,
      table: 'P1',
      purpose: '同一檔兩個合法批號；驗證通過但匯入應失敗',
      text: csvText(HEADERS.P1, [p1Row(LOT_F), p1Row(LOT_G)]),
    },
    {
      key: 'p2A',
      name: `P2_${LOT_A}.csv`,
      table: 'P2',
      purpose: '合法的 P2，四個收卷機，第 3 個分條結果為 0（NG）',
      text: csvText(HEADERS.P2, [p2Row(LOT_A, 1, 1), p2Row(LOT_A, 2, 1), p2Row(LOT_A, 3, 0), p2Row(LOT_A, 4, 1)]),
    },
    {
      key: 'p2B',
      name: `P2_${LOT_B}.csv`,
      table: 'P2',
      purpose: '合法的 P2，第二個批號，兩個收卷機，規格不同',
      text: csvText(HEADERS.P2, [p2Row(LOT_B, 1, 1, { spec: 'SYN-B 12' }), p2Row(LOT_B, 2, 0, { spec: 'SYN-B 12' })]),
    },
    {
      key: 'p2FilenameWinder',
      name: `P2_${LOT_D}_07.csv`,
      table: 'P2',
      purpose: '內容沒有收卷機欄，收卷機編號 7 來自檔名',
      text: csvText(withoutWinder, [p2Row(LOT_D, null, 1, { withWinder: false })]),
    },
    {
      key: 'p3AB',
      name: 'P3_0103_P91.csv',
      table: 'P3',
      purpose: '合法的 P3，兩個批號共四列；含 Finish 為 0（NG）與來源收卷機',
      text: csvText(HEADERS.P3, [
        p3Row(LOT_A, 1, 1, 1),
        p3Row(LOT_A, 2, 3, 0),
        p3Row(LOT_A, 3, 3, 1),
        p3Row(LOT_B, 4, 2, 1, 'SYN-Q 30'),
      ]),
    },
    {
      key: 'p3NoDate',
      name: 'P3_0105_P92.csv',
      table: 'P3',
      purpose: '沒有日期欄；驗證通過但匯入應失敗（無法得知生產日期）',
      text: csvText(withoutDate, [p3Row(LOT_C, 9, 1, 1).filter((_, index) => index !== 1)]),
    },
    {
      key: 'p3MissingLot',
      name: 'P3_0106_P93.csv',
      table: 'P3',
      purpose: '兩列，其中一列沒有批號；驗證應回報該列',
      text: csvText(HEADERS.P3, [p3Row(LOT_D, 11, 7, 1), p3Row('', 12, 7, 1)]),
    },
    {
      key: 'notCsv',
      name: 'notes.txt',
      table: null,
      purpose: '不支援的副檔名；建立匯入工作時應被拒絕',
      text: 'synthetic text file\n',
    },
    { key: 'pdfOk', name: `P2_${LOT_E}.pdf`, table: null, purpose: '合成 PDF；假轉檔服務回固定內容', data: PDF_BYTES },
    { key: 'pdfFail', name: 'P2_fail_sample.pdf', table: null, purpose: '合成 PDF；假轉檔服務回錯誤', data: PDF_BYTES },
    { key: 'pdfHang', name: 'P2_hang_sample.pdf', table: null, purpose: '合成 PDF；假轉檔服務不回應（逾時）', data: PDF_BYTES },
    {
      key: 'pdfNotPdf',
      name: 'P2_not_really.pdf',
      table: null,
      purpose: '副檔名是 pdf 但內容不是 PDF；上傳應被拒絕',
      data: Buffer.from('this is not a pdf\n', 'latin1'),
    },
    { key: 'pdfEmpty', name: 'P2_empty.pdf', table: null, purpose: '空的 PDF；上傳應被拒絕', data: Buffer.alloc(0) },
  ];

  return Object.fromEntries(
    files.map((file) => [file.key, { ...file, data: file.data ?? Buffer.from(file.text, 'utf8') }]),
  );
}

/**
 * 假轉檔服務對一份 PDF 回傳的檔案：
 * - 一份 P2 CSV，刻意沒有收卷機欄（來源會依列順序注入 1 起算的收卷機編號）
 * - 一份 P1 CSV（同一份 PDF 轉出多份 CSV 的情況）
 * - 空的 error_list.csv（應被略過）
 */
export function pdfConversionOutputs() {
  return [
    {
      name: `P2_${LOT_E}.csv`,
      data: csvText(withoutWinder, [
        p2Row(LOT_E, null, 1, { withWinder: false }),
        p2Row(LOT_E, null, 0, { withWinder: false }),
        p2Row(LOT_E, null, 1, { withWinder: false }),
      ]),
    },
    { name: `P1_${LOT_E}.csv`, data: csvText(HEADERS.P1, [p1Row(LOT_E, { material: 'H8' })]) },
    { name: 'error_list.csv', data: '' },
  ];
}
