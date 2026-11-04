# AoV 管理系統：案例庫資料契約

日期：2026-11-04
決議：D163 至 D167。本文件為批一（儲存層）的唯一契約；批二、批三沿用，不得另行改欄位。

## 1. 目的與邊界

保留「已驗證、可執行流程」的歷次版本與修改原因，並能淘汰舊的 node 與 node 組合、把功能重複的 node 合併。要證明的是長久使用性與高度彈性，不是功能數量。

不做：身分驗證（作者與原因為自填文字，不宣稱可驗證）、多人同步、對外網路、改寫既有版本。

## 2. 用語

| 用語 | 定義 |
|---|---|
| node | 工具箱動作，以平台 v5 流程節點的 `actionId` 識別（`kind` 為 `node` 且 `actionId` 非 null）。start、end 不算 |
| 組合 | 同一張 graph 內，至少兩個 node 以邊直接相連的有向序列，例如 `[a, b]` 或 `[a, b, c]`。中間隔了其他 node 不算命中 |
| 案例 | 一條流程的身分，下有多個版本 |
| 版本 | 通過驗證的一次存檔，內容為整合包 JSON（`composer-aov-bundle` v1），存入後永不變更 |

## 3. 資料表

所有 `*_at` 為 ISO 8601 UTC 字串。所有 JSON 欄位存 UTF-8 文字，鍵序固定（沿用 `libs/aov-integration` 的 `canonicalJson`）。

### 3.1 schema_meta

| 欄位 | 型別 | 規則 |
|---|---|---|
| id | INTEGER PRIMARY KEY CHECK (id = 1) | 單列 |
| version | INTEGER NOT NULL | 目前資料庫版本，從 1 起 |
| migrated_at | TEXT NOT NULL | 最後一次 migration 時間 |

啟動時：無資料庫則建到最新版；版本低於程式則按序 migration（每一步在交易內，失敗整步回復）；版本高於程式則拒絕開啟並給明確錯誤，不嘗試讀取。

### 3.2 flow_case

| 欄位 | 型別 | 規則 |
|---|---|---|
| case_id | TEXT PRIMARY KEY | 由儲存層產生，不可重複 |
| name | TEXT NOT NULL | 1 至 300 字 |
| created_at | TEXT NOT NULL | |

不可 UPDATE、DELETE（觸發器）。改名以新案例處理；批三若需要改名，另開決議。

### 3.3 flow_version

| 欄位 | 型別 | 規則 |
|---|---|---|
| case_id | TEXT NOT NULL REFERENCES flow_case | |
| version | INTEGER NOT NULL | 同案例從 1 連續遞增；PRIMARY KEY (case_id, version) |
| parent_version | INTEGER NULL | 第 1 版為 NULL；其餘必須指向同案例已存在的版本 |
| content | TEXT NOT NULL | 整合包 JSON 文字，不超過 10,000,000 UTF-8 bytes |
| content_hash | TEXT NOT NULL | content 的 sha256（與 `contentSha256` 同法），讀取時重算比對，不符則回報損壞 |
| verified_report | TEXT NOT NULL | 驗證與模擬報告 JSON，其 `passed` 必須為 true |
| change_reason | TEXT NOT NULL | 第 1 版可寫「初版」；其餘必填，1 至 2000 字 |
| author | TEXT NOT NULL | 自填，1 至 100 字 |
| created_at | TEXT NOT NULL | |

觸發器拒絕 UPDATE 與 DELETE。

### 3.4 node_lifecycle

| 欄位 | 型別 | 規則 |
|---|---|---|
| seq | INTEGER PRIMARY KEY AUTOINCREMENT | |
| node_id | TEXT NOT NULL | 字串，不做外鍵到 registry |
| state | TEXT NOT NULL CHECK IN ('active','deprecated','merged') | |
| reason | TEXT NOT NULL | 1 至 2000 字 |
| replaced_by | TEXT NULL | state 為 merged 時必填且不得等於 node_id |
| at | TEXT NOT NULL | |

現況取該 node_id 最大 seq 的一筆；沒有紀錄視為 active。不可 UPDATE、DELETE。

### 3.5 node_alias

| 欄位 | 型別 | 規則 |
|---|---|---|
| old_id | TEXT PRIMARY KEY | 每個舊 id 只能被合併一次 |
| new_id | TEXT NOT NULL | 不得等於 old_id |
| merge_reason | TEXT NOT NULL | 必須寫出兩者差異，1 至 2000 字 |
| at | TEXT NOT NULL | |

不可 UPDATE、DELETE。解析別名時沿鏈走到終點；偵測到循環（含合併造成的間接循環）必須在寫入時拒絕。合併動作在同一交易內同時寫 node_alias 與一筆 `merged` 的 node_lifecycle。

### 3.6 combo_lifecycle

| 欄位 | 型別 | 規則 |
|---|---|---|
| seq | INTEGER PRIMARY KEY AUTOINCREMENT | |
| combo | TEXT NOT NULL | JSON 字串陣列，長度至少 2，元素為 node_id |
| state | TEXT NOT NULL CHECK IN ('active','deprecated') | |
| reason | TEXT NOT NULL | 1 至 2000 字 |
| at | TEXT NOT NULL | |

現況取同一 combo（以 JSON 文字全等比對）最大 seq 的一筆。不可 UPDATE、DELETE。

## 4. 存版本的規則（saveVersion）

依序檢查，任一項不過就整筆不寫入並回傳可辨識的錯誤碼：

1. `verified_report.passed` 必須為 true，否則 `E-NOT-VERIFIED`。儲存層不自己跑模擬，只認報告；報告缺 `passed` 或型別不對也算失敗。
2. content 必須是 `composer-aov-bundle` v1 外殼且不超過大小上限，否則 `E-BAD-CONTENT`。完整語意驗證由 `validateAovBundle` 負責，儲存層呼叫它，不重寫一份。
3. 抽出 content.platform 各 graph 的 node（取 `actionId`）與組合。node 的現況為 deprecated 或 merged，或命中現況為 deprecated 的組合，則 `E-DEPRECATED`，錯誤要列出每一個命中的 node 或組合與所在 graph。比對前先把 node 的 actionId 以別名解析到終點。
4. parent_version 檢查與版本號遞增在同一交易內完成；並行存同一案例時，其中一方得到 `E-VERSION-CONFLICT`，不得出現重複版本號。

淘汰與合併不影響已存版本：讀取版本永遠回傳原文。

## 5. 儲存層介面（TypeScript，`libs/case-store/`）

函式回傳 `{ ok: true, value } | { ok: false, errors }`，不丟例外表達預期錯誤（資料庫損壞等非預期情況才丟）。不得使用 `any`。

- `openCaseStore(path: string): CaseStore`，`:memory:` 供測試。
- `createCase(name)`、`listCases()`。
- `saveVersion({ caseId, content, verifiedReport, changeReason, author })`。
- `getVersion(caseId, version)`：重算 content_hash，不符回報 `E-CORRUPT`。
- `listVersions(caseId)`：版本、父版本、修改原因、作者、時間，不含 content。
- `deprecateNode(nodeId, reason)`、`reactivateNode(nodeId, reason)`。
- `mergeNodes({ keep, drop, reason })`：drop 與 keep 都不能已是 merged；keep 不能 deprecated。
- `deprecateCombo(combo, reason)`、`reactivateCombo(combo, reason)`：combo 至少 2 個元素。
- `resolveNode(nodeId)`：沿別名走到終點，回傳終點與現況。
- `scanUsage(nodeIdOrCombo)`：列出所有版本中仍引用它的 (case_id, version, graph)，供淘汰前評估影響。

## 6. 長久使用性與彈性的驗收證據（批一須以測試保存）

| 性質 | 測試 |
|---|---|
| 版本史不可竄改 | 直接以 SQL 對 flow_version 做 UPDATE 與 DELETE 皆失敗（繞過儲存層也擋得住） |
| 舊檔永遠可讀 | 在測試中建立「舊版本資料庫檔」fixture（schema_meta 低版本），開啟後 migration 成功且既有版本內容逐位元組相同；未知較新版本拒絕開啟 |
| migration 原子性 | 模擬 migration 中途失敗，資料庫維持原版本且資料不變 |
| 損壞偵測 | 手動改壞 content 後 getVersion 回 `E-CORRUPT` |
| 淘汰不改寫歷史 | 淘汰 node 後，舊版本仍可 getVersion 且內容相同；含該 node 的新版本被 `E-DEPRECATED` 拒絕 |
| 合併與別名 | 合併後以舊 id 存的新版本被拒絕並指出應改用保留方；舊版本照舊可讀；循環合併被拒絕 |
| 組合只比直接相連 | `[a,b]` 被淘汰時，a 與 b 直接相連命中，a 經 c 再到 b 不命中 |
| 並行與交易 | 兩個連線對同一案例同時存版本，版本號不重複、不遺漏 |
| 彈性 | content 內嵌格式版本不同的整合包時，以其自描述的 version 判斷，未知版本拒絕而不是猜測 |

## 7. 已知限制（須如實寫在交付物）

- 作者與原因為自填，無法證明是誰改的。
- `content_hash` 只偵測損壞，不是簽章。
- `verified_report` 由呼叫端提供，儲存層只確認 `passed` 為 true；是否真的跑過驗證與模擬，由批二的服務層在伺服器端自己執行來保證，不信任瀏覽器送來的報告。
