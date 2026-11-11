# 論文主案例：來源步驟清單與「角色 × 操作」權限表

日期：2026-11-11
分支：`docs/thesis-source-inventory`（自 `main` 的 db340e5 開出）
依據：`docs/handoff-product-and-thesis.md`（分支 `docs/handoff-product-and-thesis`）第 4.2 節 S1、第 4.3 節登入比法（U10）與 PDF 轉 CSV（U11）、第 4.5 節第 2 步
性質：轉換前凍結的比對基準。不改任何產品行為。決議編號：本文件沒有取號。

## 0. 凍結聲明

- 本文件第 2 節（來源步驟清單）與第 3 節（權限表）在 user 確認第 5 節的待決事項後凍結。凍結後不得為了讓 S1、S4、S5 通過而修改；若發現讀錯來源，只能在第 6 節「修訂紀錄」追加更正，寫明原因與發現日期，原內容保留。
- 來源：`C:\Users\gslab\Desktop\Form-analysis-server-specify-kit`，commit `362cc7cdd6253b01886e75f9ad3ab273950ad7a7`（2026-06-07）。工作樹另有一處未提交修改（`backend/app/services/validation.py`，把共用的驗證服務實例改成每次呼叫新建，並搬動一行 import），本文件沒有讀它，列出的步驟都不經過它的差異。
- 讀取範圍：只讀流程文件與程式碼。沒有讀 `.env`、`.env.*`、`uploads/`、`test-data/`、任何 CSV 或資料檔，也沒有執行來源系統。下文所有「行為」都是讀程式碼得到的推論，第 4.5 節第 3 步在來源系統上實跑時要逐項確認。
- 判讀原則：流程文件與程式碼不一致時，以程式碼為準（handoff 第 4.3 節）。不一致處列在第 4 節。
- 路徑簡寫：`be/` = `form-analysis-server/backend/app/`，`fe/` = `form-analysis-server/frontend/src/`。

## 1. 來源系統的設定前提

步驟與權限依賴以下設定。表中寫的是程式碼預設值；S4 跑基準時要用同一組設定，並把實際值記進比對報告。

| 設定 | 預設 | 影響 | 出處 |
|---|---|---|---|
| `AUTH_MODE` | `api_key` | 開啟時 `/api` 下全部要 `X-API-Key`；`off` 在 production 會被拒絕啟動 | `be/core/config.py` 第 120、345 行 |
| `AUTH_EXEMPT_PATHS` | `/healthz,/docs,/redoc,/openapi.json,/api/auth/login` | 不需登入的路徑 | `be/core/config.py` 第 141 行 |
| `ADMIN_API_KEYS` | 空 | 管理者金鑰；空時所有「需要管理者金鑰」的操作都拒絕 | `be/core/config.py` 第 152 行 |
| `MULTI_TENANT_ENABLED` | `false` | 開啟時舊版匯入端點回 410 | `be/core/config.py` 第 105 行 |
| `PDF_SERVER_URL` | 空 | 空時觸發轉檔回 503 | `be/core/config.py` 第 53 行、`be/api/routes_upload.py` 第 1186 行 |
| `USE_GENERIC_SCHEMA` | `false` | 關閉時不掛載站點管理路由 | `be/main.py` 第 645 行 |
| `VITE_ENABLE_CSV_EDIT` | `true` | 關閉時上傳頁的表格唯讀 | `fe/pages/UploadPage.tsx` 第 10 行 |

## 2. 來源步驟清單（S1 的依據）

編號規則：L 登入、U 上傳、Q 查詢、A 分析、M 管理。「入口」是使用者在畫面上做的事；「後端」是畫面發出的請求。S1 要求每一步在 AoV 畫布上都有對應節點。

### 2.1 前置（每條流程共同）

| 編號 | 步驟 | 入口 | 後端 | 出處 |
|---|---|---|---|---|
| P0 | 未登入時，除登入外的業務操作都被拒絕 | 任何頁籤 | `/api` 下除 `/api/auth/login` 外回 401 | `be/main.py` 第 280 至 441 行 |
| P1 | （不比，見 2.7）被要求改密碼的帳號，改密碼前只能做三件事 | 任何頁籤 | 除 `/api/auth/me/password`、`/api/auth/whoami`、`/api/auth/bootstrap-status` 外回 403 `Password change required` | `be/main.py` 第 419 至 439 行 |

### 2.2 登入（L）

| 編號 | 步驟 | 入口 | 後端 | 出處 |
|---|---|---|---|---|
| L1 | 輸入場域代碼（可空）、帳號、密碼並登入 | 「登入」頁籤 | `POST /api/auth/login`；場域代碼空時用預設場域，沒有預設且場域不只一個時回 400 | `be/api/routes_auth.py` 第 1160 至 1295 行；`fe/pages/RegisterPage.tsx` 第 201 行 |
| L2 | 登入失敗限流：同一場域、帳號、來源位址 60 秒內失敗 5 次後回 429 | 同上 | 同上 | `be/api/routes_auth.py` 第 248 至 278 行 |
| L3 | 登入成功後取得權杖；同一帳號再次登入時，舊權杖失效 | 同上 | 回 `api_key`；舊的 `login:<帳號>` 權杖設為停用 | `be/api/routes_auth.py` 第 1250 至 1272 行 |
| L4 | 查看目前身分（角色、是否需改密碼） | 「登入」頁籤 | `GET /api/auth/whoami` | `be/api/routes_auth.py` 第 187 行；`fe/pages/RegisterPage.tsx` 第 96 行 |
| L5 | 自己改密碼（需舊密碼，新密碼至少 8 字元且不同於舊密碼）；成功後其他權杖失效 | 「登入」頁籤 | `POST /api/auth/me/password`；60 秒內失敗 10 次回 429 | `be/api/routes_auth.py` 第 1298 至 1390 行；`fe/pages/RegisterPage.tsx` 第 253 行 |
| L6 | 登出 | 「登入」頁籤 | 只清除瀏覽器內的權杖，不呼叫後端，權杖在後端仍有效 | `fe/pages/RegisterPage.tsx` 第 162 至 165、460 行 |
| L7 | 輸入管理者金鑰解鎖「管理者」頁籤 | 「登入」頁籤 | `GET /api/auth/bootstrap-status` 帶 `X-Admin-API-Key`；成功才在本次瀏覽器工作階段顯示管理者頁籤 | `fe/pages/RegisterPage.tsx` 第 301 行；`fe/App.tsx` 第 32、146 行 |

### 2.3 上傳（U，含 PDF 轉 CSV）

| 編號 | 步驟 | 入口 | 後端 | 出處 |
|---|---|---|---|---|
| U1 | 選擇檔案（可多檔），只接受 `.csv` 與 `.pdf`；超過大小上限擋下；同名、同大小、同修改時間的檔案先詢問是否仍加入 | 「檔案上傳」頁籤 | 無（瀏覽器內檢查） | `fe/pages/UploadPage.tsx` 第 290 至 360 行 |
| U2 | 依檔名判定表單種類（P1、P2、P3、PDF） | 同上 | 無 | `fe/pages/UploadPage.tsx` 第 325 行 |
| U3 | CSV 驗證：建立匯入工作 | 「驗證」或「全部驗證」 | `POST /api/v2/import/jobs`（`table_code`、`files`、`allow_duplicate=false`） | `fe/pages/UploadPage.tsx` 第 469 至 528、691 行；`be/api/routes_import_v2.py` 第 175 行 |
| U4 | 內容重複：同場域已有相同 SHA-256 的檔案時回錯誤碼 `DUPLICATE_FILE_CONTENT`，畫面詢問是否仍要匯入；同意則以 `allow_duplicate=true` 重建工作 | 同上 | 同上 | `be/api/routes_import_v2.py` 第 289 至 320 行；`fe/pages/UploadPage.tsx` 第 502 至 514 行 |
| U5 | 背景解析與驗證，畫面輪詢到 READY 或 FAILED | 自動 | `GET /api/v2/import/jobs/{job_id}`；狀態 UPLOADED、PARSING、VALIDATING、READY 或 FAILED | `fe/pages/UploadPage.tsx` 第 565 行起；`dev-guides/USER_FLOW_DIAGRAMS.md` 2.1 節 |
| U6 | 有錯誤時顯示錯誤列，並展開可編輯的表格 | 自動 | `GET /api/v2/import/jobs/{job_id}/errors` | `be/api/routes_import_v2.py` 第 611 行 |
| U7 | 在表格中修正內容 | 表格儲存格 | 無（瀏覽器內） | `fe/pages/UploadPage.tsx` 第 968、995、2031 行 |
| U8 | 重新驗證：用畫面上目前的內容重建檔案，建立新的匯入工作（回到 U3） | 「重新驗證」 | 同 U3 | `fe/pages/UploadPage.tsx` 第 464 至 467 行 |
| U9 | 匯入：只有 READY 的工作可以匯入（卡在 COMMITTING 的可重送），整批寫入正式資料 | 「匯入」或「批次匯入」 | `POST /api/v2/import/jobs/{job_id}/commit`；其他狀態回 400 | `be/api/routes_import_v2.py` 第 650 至 752 行；`fe/pages/UploadPage.tsx` 第 1044 行 |
| U10 | 匯入完成，工作狀態為 COMPLETED；失敗為 FAILED | 自動 | 同 U5 | `dev-guides/USER_FLOW_DIAGRAMS.md` 2.1 節 |
| U11 | 移除清單中的檔案 | 「移除」 | 無 | `fe/pages/UploadPage.tsx` 第 1325 行 |
| U12 | PDF 上傳：PDF 檔按「驗證」只做保存；檢查副檔名、非空、10MB 以內、以 `%PDF-` 開頭 | 「驗證」 | `POST /api/upload/pdf`；不解析、不轉檔、不匯入 | `fe/pages/UploadPage.tsx` 第 388 至 444 行；`be/api/routes_upload.py` 第 1004 至 1158 行 |
| U13 | 觸發轉檔；轉檔服務未設定時回 503；已有進行中或已完成的轉檔工作時直接回那一筆 | 「轉檔」或「全部轉檔」 | `POST /api/upload/pdf/{process_id}/convert` | `be/api/routes_upload.py` 第 1161 至 1271 行；`fe/pages/UploadPage.tsx` 第 732、765 至 800 行 |
| U14 | 輪詢轉檔狀態：QUEUED、UPLOADING、PROCESSING、COMPLETED 或 FAILED；FAILED 時顯示錯誤摘要 | 自動 | `GET /api/upload/pdf/{process_id}/convert/status` | `fe/pages/UploadPage.tsx` 第 813 至 864 行 |
| U15 | 轉檔完成：取回轉出的 CSV（可能多份），以新的 CSV 項目取代清單中的 PDF，狀態為「未驗證」 | 自動 | `GET /api/upload/pdf/{process_id}/convert/outputs?include_csv_text=1` | `fe/pages/UploadPage.tsx` 第 866 至 926 行；`be/api/routes_upload.py` 第 1549 行 |
| U16 | 轉出的 CSV 由使用者檢視、修正後，走 U3 至 U10 的同一條驗證與匯入流程 | 同 U3 | 同 U3 | 同上 |
| U17 | 取消匯入工作（重複取消不報錯） | 後端有，畫面沒有入口 | `POST /api/v2/import/jobs/{job_id}/cancel` | `be/api/routes_import_v2.py` 第 755 行起 |
| U18 | 轉檔結果直接建立上傳工作與匯入工作，預設會驗證（`skip_validate=false`）；同一個轉檔工作重複呼叫時回傳既有結果；轉檔未完成回 409 | 後端有，畫面沒有入口 | `POST /api/upload/pdf/{process_id}/convert/ingest` | `be/api/routes_upload.py` 第 1331 至 1546 行 |

U13 至 U15 的背景處理另有兩個會影響 S4 的行為（`be/services/pdf_conversion.py`）：

- 轉檔服務回傳的檔案中，`error_list.csv` 與空檔會被略過（第 335 至 342 行）。
- 檔名判定為 P2 的 CSV，會在每一列注入從 1 起算的收卷機編號，並寫回磁碟，所以 U15 取回的是注入後的內容（第 344 至 351 行）。

### 2.4 查詢（Q）

| 編號 | 步驟 | 入口 | 後端 | 出處 |
|---|---|---|---|---|
| Q1 | 輸入關鍵字時顯示批號建議（至少 1 字元，最多 10 筆），點選即查詢 | 「資料查詢」頁籤 | `GET /api/v2/query/lots/suggestions` | `fe/pages/QueryPage.tsx` 第 862 行 |
| Q2 | 關鍵字符合產品編號格式時，做產品追溯（P1、P2、P3 的關聯）；查無回 404 | 「查詢」 | `GET /api/traceability/product/{product_id}` | `fe/pages/QueryPage.tsx` 第 902 行；`be/api/traceability.py` 第 67 行 |
| Q3 | 否則以批號查詢紀錄，分頁顯示；空結果顯示空狀態 | 「查詢」 | `GET /api/v2/query/records` | `fe/pages/QueryPage.tsx` 第 476 行 |
| Q4 | 進階查詢：載入下拉選項（機台、模具、規格、材料），至少填一個條件才查 | 「進階查詢」面板 | `GET /api/v2/query/options/{machine_no,mold_no,specification,material}`，送出為 `POST /api/v2/query/records/dynamic` | `fe/components/AdvancedSearch.tsx` 第 73 至 76 行；`fe/pages/QueryPage.tsx` 第 501 至 510 行 |
| Q5 | 從 P2 紀錄依收卷機編號追溯 | 查詢結果 | `GET /api/traceability/winder/{lot_no}/{winder}` | `fe/pages/QueryPage.tsx` 第 758 行 |
| Q6 | 修改已匯入的紀錄：可附修改原因（選填）；不得改識別碼、場域、建立與更新時間、操作者欄位（400）；修改前後內容寫入修改紀錄 | 後端有；查詢頁載入了編輯視窗但沒有地方打開它 | `GET /api/edit/reasons`、`PATCH /api/edit/records/{table_code}/{record_id}` | `be/api/routes_edit.py` 第 35、225 至 400 行；`be/schemas/audit.py` 第 38 至 55 行；`fe/pages/QueryPage.tsx` 第 158、2284 至 2289 行 |
| Q7 | 查看某筆紀錄的修改歷史 | 後端有，畫面沒有入口 | `GET /api/edit/records/{table_code}/{record_id}/edits` | `be/api/routes_edit.py` 第 171 至 222 行 |

### 2.5 分析（A）

| 編號 | 步驟 | 入口 | 後端 | 出處 |
|---|---|---|---|---|
| A1 | 選擇日期範圍與站別（P2、P3 或全部），或輸入產品編號清單；未選站別時擋下 | 「資料分析」頁籤 | 無 | `fe/pages/AnalyticsPage.tsx` 第 779 至 808 行 |
| A2 | 執行分析：有產品編號時以產品編號分析，否則以日期範圍分析 | 「執行」 | `POST /api/v2/analytics/analyze` | `fe/pages/AnalyticsPage.tsx` 第 811 至 838 行 |
| A3 | NG 明細：依日期與站別列出 NG 紀錄（P2 以分條結果為 0、P3 以 Finish 為 0 判定），P2 可再依收卷機編號篩選 | 「NG」模式 | `POST /api/v2/query/records/dynamic` | `fe/pages/AnalyticsPage.tsx` 第 1000 至 1115、1148 行 |
| A4 | 萃取分析分數（邊界次數、SPE、T2） | 自動隨分析載入 | `POST /api/v2/analytics/extraction-analysis` | `fe/pages/AnalyticsPage.tsx` 第 1117 至 1146 行 |
| A5 | 檢視分析產出（列表、明細、快照、依產品編號解析輸入、客訴分析） | 分析結果區 | `GET /api/v2/analytics/artifacts*`、`POST /api/v2/analytics/complaint-analysis` | `fe/components/analytics/ArtifactsView.tsx`；`fe/services/analyticsArtifacts.ts` 第 124 至 328 行 |
| A6 | 從分析頁直接查產品追溯 | 分析結果區 | `GET /api/traceability/product/{product_id}` | `fe/pages/AnalyticsPage.tsx` 第 510 行 |

### 2.6 管理（M，單一場域之內）

| 編號 | 步驟 | 入口 | 後端 | 出處 |
|---|---|---|---|---|
| M1 | 列出本場域的使用者（可含停用者） | 「場域管理」頁籤 | `GET /api/auth/users` | `fe/pages/ManagerPage.tsx` 第 81 行；`be/api/routes_auth.py` 第 536 行 |
| M2 | 新增使用者（角色 manager 或 user，密碼至少 8 字元）；同名回 409 | 同上 | `POST /api/auth/users` | `fe/pages/ManagerPage.tsx` 第 135 行；`be/api/routes_auth.py` 第 416 行 |
| M3 | 修改使用者的名稱、角色、啟用狀態；不得讓場域內最後一位Manager失去Manager身分（409） | 同上 | `PATCH /api/auth/users/{user_id}` | `fe/pages/ManagerPage.tsx` 第 172 行；`be/api/routes_auth.py` 第 625 行 |
| M4 | 刪除使用者（實為停用）；同樣不得移除最後一位Manager | 同上 | `DELETE /api/auth/users/{user_id}` | `fe/pages/ManagerPage.tsx` 第 204 行；`be/api/routes_auth.py` 第 795 行 |
| M5 | 重設他人密碼：產生或指定暫時密碼，對方權杖全部失效；不能用來重設自己的密碼（400）。重設後對方被標記為須改密碼，這部分不比（第 5 節 Q2） | 後端有，「場域管理」頁籤沒有按鈕 | `POST /api/auth/users/{user_id}/password-reset` | `be/api/routes_auth.py` 第 1393 至 1479 行 |
| M6 | 檢視、搜尋、下載系統日誌，清理舊日誌 | 「Developer Logs」頁籤 | `GET /api/logs/{files,view,stats,search,download}`、`DELETE /api/logs/cleanup` | `fe/App.tsx` 第 40、154 行；`be/api/routes_logs.py` 第 25 至 375 行 |

### 2.7 刻意不納入的步驟

| 項目 | 理由 | 來源依據 |
|---|---|---|
| 舊版上傳路徑：`POST /api/upload`、`/api/upload/{process_id}/{validate,content,edits,status}`、`GET /api/validate`、`GET /api/errors.csv`、`POST /api/import` | U7 排除。前端上傳頁不呼叫這些端點（只呼叫 `/api/upload/pdf*` 與 `/api/v2/import/jobs*`）；多租戶模式下回 410 | `be/api/routes_upload.py`、`routes_validate.py`、`routes_export.py`、`routes_import.py`；`dev-guides/USER_FLOW_DIAGRAMS.md` 第 11 至 13 行 |
| 跨租戶彙總（`dev-guides/GM_CROSS_TENANT_SUMMARY_MVP.md`）、`GET /api/admin/audit-events` 跨場域查詢 | U7 排除 | 同左 |
| PDF 轉檔品質與真實轉檔服務 | handoff 第 4.3 節：兩邊接同一個假服務，S4 不比轉檔品質 | `dev-guides/PDF_TO_V2_IMPORT_SPEC.md` |
| P1「須改密碼的帳號只能做三件事」 | user 2026-11-11 決定「須改密碼」不比；步驟與權限表的該欄一併不納入 | `be/main.py` 第 419 至 439 行 |
| 轉檔完成後背景自動建立的上傳工作（狀態 PENDING，不驗證） | 寫入舊版的上傳工作表，畫面不讀取，使用者觀察不到 | `be/services/pdf_conversion.py` 第 301 至 375、528 至 543 行 |

其餘待 user 決定是否納入的項目，見第 5 節。

## 3. 「角色 × 操作」權限表（S4 登入比法、S5 的依據）

### 3.1 角色

| 代號 | 身分 | 怎麼取得 | 出處 |
|---|---|---|---|
| 未登入 | 沒有帶權杖 | — | — |
| User | 場域內角色 `user` 的帳號，以 L1 登入 | `POST /api/auth/login` | `be/api/routes_auth.py` 第 25 行 |
| Manager | 場域內角色 `manager` 的帳號，以 L1 登入 | 同上 | 同上 |
| 金鑰+帳號 | 帶有效權杖，同時帶有效的 `X-Admin-API-Key` | L1 加 L7 | `be/main.py` 第 305 至 319 行 |
| 只有金鑰 | 只帶 `X-Admin-API-Key`，沒有權杖 | L7 | `be/main.py` 第 323 至 334 行 |
| 須改密碼 | User 或 Manager，帳號被標記為須改密碼（M5 之後） | — | `be/main.py` 第 419 至 439 行 |

舊資料中的角色 `admin` 在啟動時自動改成 `manager`（`be/main.py` 第 150 至 164 行），所以場域內實際只有兩種角色。

注：管理者金鑰不會自動附加，只在呼叫點明確加上（`fe/pages/AdminPage.tsx`、`fe/pages/RegisterPage.tsx`、`fe/services/logService.ts`、`fe/services/stationApi.ts`、`fe/services/tenant.ts`）。前端的全域請求包裝（`fe/services/fetchWrapper.ts` 第 34 至 95 行）對 `/api/auth*` 與 `/api/tenants*`，只要請求帶了管理者金鑰就不再附上一般權杖；對其他路徑則照常附上一般權杖。所以：

- L7 解鎖與「管理者」頁籤裡的使用者、場域管理，實際送出的是「只有金鑰」。
- 系統日誌（M6）與站點設定在已登入且已解鎖時，送出的是「金鑰+帳號」；未登入只解鎖時是「只有金鑰」。
- `GET /api/auth/bootstrap-status` 路由本身不檢查管理者金鑰，帶任何有效權杖都回 200；L7 能分辨金鑰對錯，是因為只帶金鑰時由 `be/main.py` 第 333 行的放行條件把關。

### 3.2 權限表

格子內容是後端的結果：「允許」或「拒絕（狀態碼）」。後端的判斷才是 S4、S5 比對的對象；畫面是否顯示該頁籤列在 3.3。依 user 2026-11-11 的決定：「金鑰+帳號」與「只有金鑰」兩欄要比；「須改密碼」一欄只留作來源紀錄，不比。

| 操作 | 對應步驟 | 未登入 | User | Manager | 金鑰+帳號 | 只有金鑰 | 須改密碼（不比） |
|---|---|---|---|---|---|---|---|
| 登入 | L1 | 允許 | 允許 | 允許 | 允許 | 允許 | 允許 |
| 查看目前身分 | L4 | 拒絕（401） | 允許 | 允許 | 允許 | 允許 | 允許 |
| 自己改密碼 | L5 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 允許 |
| 解鎖管理者頁籤 | L7 | 金鑰正確：允許；金鑰錯誤：拒絕（401）。與是否登入、角色無關，見 3.1 注 | 同左 | 同左 | 同左 | 同左 | 同左 |
| CSV 建立匯入工作、查工作狀態與錯誤 | U3 至 U6、U8 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 拒絕（403） |
| 匯入、取消匯入工作 | U9、U17 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 拒絕（403） |
| PDF 上傳、轉檔、查狀態、取回 CSV、轉檔結果直接建立工作 | U12 至 U15、U18 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 拒絕（403） |
| 批號建議、批號查詢、進階查詢、追溯 | Q1 至 Q5 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 拒絕（403） |
| 修改已匯入的紀錄、查看修改歷史 | Q6、Q7 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 拒絕（403） |
| 分析、NG 明細、萃取分數、分析產出 | A1 至 A6 | 拒絕（401） | 允許 | 允許 | 允許 | 拒絕（401） | 拒絕（403） |
| 列出使用者 | M1 | 拒絕（401） | 拒絕（403） | 允許（只限本場域） | 允許 | 允許 | 拒絕（403） |
| 新增使用者 | M2 | 拒絕（401） | 拒絕（403） | 允許（只限本場域） | 允許 | 允許 | 拒絕（403） |
| 修改使用者 | M3 | 拒絕（401） | 拒絕（403） | 允許（不得移除最後一位Manager，409） | 允許（不受最後一位Manager限制） | 允許（同左） | 拒絕（403） |
| 刪除（停用）使用者 | M4 | 拒絕（401） | 拒絕（403） | 允許（同 M3 限制） | 允許（同左） | 允許（同左） | 拒絕（403） |
| 重設他人密碼 | M5 | 拒絕（401） | 拒絕（403） | 允許（不能重設自己，400） | 允許 | 允許 | 拒絕（403） |
| 系統日誌 | M6 | 拒絕（401） | 拒絕（403） | 允許 | 允許 | 拒絕（401） | 拒絕（403） |

判讀依據：

- 未登入、只有金鑰：`be/main.py` 第 321 至 354 行。只有金鑰時，只放行 `/api/tenants`、`/api/auth/users`、`/api/auth/admin/tenant-api-keys`、`/api/auth/whoami`、`/api/auth/bootstrap-status`、`/api/auth/bootstrap/manager-status` 開頭的路徑；`/api/auth/users/{id}/password-reset` 也在 `/api/auth/users` 之下，所以放行。
- 上傳、查詢、分析：路由只掛場域依賴（`be/main.py` 第 540 至 642 行，`be/api/deps.py`），沒有角色檢查，User 與 Manager 相同。
- 管理：`be/api/routes_auth.py` 第 149 至 152 行（只有 manager 算場域內特權）、第 727 至 742、846 至 859 行（最後一位Manager）、第 1448 至 1454 行（不能重設自己）。
- 日誌：`be/api/routes_logs.py` 第 25 至 34 行。
- 須改密碼：`be/main.py` 第 419 至 439 行；解鎖頁籤用的 `bootstrap-status` 在允許清單內。

### 3.3 畫面上的頁籤（不是權限，記錄供 S2 參考）

| 頁籤 | 顯示條件 | 出處 |
|---|---|---|
| 登入、檔案上傳、資料查詢、資料分析 | 一律顯示 | `fe/App.tsx` 第 114 至 137 行 |
| 場域管理 | 目前身分的角色是 `manager` | `fe/App.tsx` 第 36 至 39、138 行 |
| 管理者 | 本次瀏覽器工作階段以 L7 解鎖過 | `fe/App.tsx` 第 32、146 行 |
| Developer Logs | 「場域管理」或「管理者」頁籤其中之一可見 | `fe/App.tsx` 第 40、154 行 |

上傳、查詢、分析頁籤對未登入者仍然顯示。未登入且瀏覽器內沒有選過場域時，請求在前端就以 400「請先選擇場域」擋下，不會送到後端（`fe/services/fetchWrapper.ts` 第 70 至 78 行）；選過場域時送到後端，回 401。

### 3.4 刻意的差異（事先列出，S4 不比）

依 handoff 第 4.3 節第 5 點與 U10：

1. 登入要填的欄位：來源有「場域代碼」，產出系統依 D03 是單一場域。
2. 權杖的形式與期限：來源是不會過期、存在資料庫的隨機金鑰，以 `X-API-Key` 傳送；同一帳號再次登入時舊金鑰失效（L3）。
3. 管理者解鎖的方式：來源用設定檔中的 `X-Admin-API-Key`。
4. 登入限流的門檻與時間窗（L2、L5 的 5 次、10 次、60 秒）：數字屬於機制，S4 只比「連續失敗後被暫時拒絕」這個結果是否存在。這一點是本文件依 U10 的推論，user 沒有逐項確認，見第 5 節 Q4。

## 4. 文件與程式碼不一致之處（以程式碼為準）

| 項目 | 文件的說法 | 程式碼的行為 | 本文件採用 |
|---|---|---|---|
| PDF 轉檔後是否自動驗證 | `dev-guides/VALIDATION_MECHANISMS.md` 第 64 行說轉檔後會自動匯入；`PDF_TO_V2_IMPORT_SPEC.md` 第 6 行說不自動驗證 | 背景只建立不驗證的上傳工作，而且畫面不讀它；畫面取回 CSV 後由使用者手動按驗證（U15、U16） | 不自動驗證 |
| PDF 去重的依據 | `PDF_TO_V2_IMPORT_SPEC.md` 第 25 行說以 PDF 原檔的 sha256 去重 | `POST /api/upload/pdf` 沒有雜湊檢查；去重發生在建立匯入工作時，比的是 CSV 內容的 SHA-256，而且可由使用者確認後放行（U4） | 以 CSV 內容去重，可放行 |
| 上傳的檔案種類 | `README.md`、`be/main.py` 的 API 說明寫 CSV 與 Excel | 上傳頁只接受 `.csv` 與 `.pdf`（U1） | CSV 與 PDF |
| 進階查詢的端點 | `dev-guides/USER_FLOW_DIAGRAMS.md` 3.2 節寫 `GET /api/v2/query/records/advanced` | 畫面送 `POST /api/v2/query/records/dynamic`（Q4） | `records/dynamic` |
| 分析頁的端點 | `README.md` 第 123 行寫 `GET /api/analytics`（每日 NG Pareto） | 沒有這個路由；分析頁呼叫 2.5 節列出的端點 | 2.5 節 |
| 分析頁的模式 | `dev-guides/USER_FLOW_DIAGRAMS.md` 第 4 節寫產品編號走 `complaint-analysis`、日期走 `realtime-analysis` | 主要的「執行」走 `POST /api/v2/analytics/analyze`；`complaint-analysis` 只在分析產出區使用；畫面不呼叫 `realtime-analysis` | 2.5 節 |
| 修改已匯入的紀錄 | — | 後端有 `PATCH /api/edit/records/{table}/{id}`，任何已登入者都可呼叫；查詢頁雖然載入了編輯視窗，但沒有任何地方把它打開（`fe/pages/QueryPage.tsx` 只有第 2289 行把它設回關閉） | 依後端列入（Q6、Q7） |

`handoff-product-and-thesis.md` 第 4.3 節寫「去重以 PDF 的 sha256 判斷」，引用的是上表第二列的規格文件；依程式碼應更正為 CSV 內容。本分支不改 handoff 文件，由 user 決定是否更正。

## 5. 凍結前待 user 決定的事項

以下每一項都會影響 S1 的分母或權限表的欄數。

已決定（user，2026-11-11）：

- Q1「金鑰+帳號」與「只有金鑰」兩欄都要比。
- Q2「須改密碼」不比（P1 移到 2.7；權限表該欄只留作紀錄）。
- Q3 後端有、畫面沒有入口的操作都要比。已列入 M5、U17、U18、Q6、Q7。

尚未決定：

- Q4 登入限流（L2、L5）要比「有沒有限流」這個結果，還是整項列為刻意差異？兩邊現況（讀程式碼，未執行）：

  | | 來源（362cc7c） | 本專案 main 的 `entry-permission-kit` |
  |---|---|---|
  | 登入連續失敗 | 同場域、帳號、來源位址 60 秒內失敗 5 次後回 429；存在記憶體，重啟清空、每個工作行程各自計數；60 秒後自動解除 | 同帳號連續失敗 5 次後鎖 15 分鐘，鎖定期間密碼正確也回 401「Invalid credentials」；存在資料庫；成功登入或改密碼後歸零 |
  | 改密碼舊密碼錯誤 | 同帳號 60 秒內失敗 10 次後回 429 | 沒有次數限制，一律回 400 |
  | 依來源位址的請求頻率限制 | 沒有 | 沒有（`services/` 下的 nginx 樣板沒有 `limit_req`） |

  出處：來源 `be/api/routes_auth.py` 第 219 至 278 行；本專案 `kits/entry-permission-kit/src/backend/app/entry_permission/lockout.py`、`src/backend/app/api/routes_ep_auth.py` 第 25 至 73 行（自 75b349c，D127 起就有）。基線版的組裝產出（`dist/` 與 `generated/` 下的 `routes_auth.py`）搜得到相同的限流程式片段，沒有逐行比對。`handoff-product-and-thesis.md` 第 5.2 節 L2 寫「登入沒有鎖定」，與 main 現況不符，帳號鎖定已存在；缺的是依來源位址的限流與密碼政策。
- Q5 下列後端功能還沒列入來源步驟清單。Q3 的決定（後端有的都要比）字面上也涵蓋它們，但其中幾項與 U7、D03 衝突，所以逐項列出，請 user 決定：

  | 項目 | 做什麼 | 端點 | 誰能用（後端） | 畫面入口 | 與既有決定的關係 |
  |---|---|---|---|---|---|
  | R1 場域的建立、列表、修改、停用 | 建立場域（含系統裡沒有任何場域時的第一個）、改名稱與代碼、設預設、停用 | `GET/POST /api/tenants`、`POST /api/tenants/admin`、`PATCH/DELETE /api/tenants/{id}` | 列表：任何已登入者只看到自己的場域；其餘：只有管理者金鑰 | 「管理者」頁籤；沒有場域時登入頁會提示 | 產出系統依 D03 是單一場域，沒有場域這個概念，比對結果必然是「產出系統沒有」 |
  | R2 把使用者移到別的場域 | 換使用者所屬場域，預設撤銷他的權杖 | `PATCH /api/auth/users/{id}/tenant` | 只有管理者金鑰 | 「管理者」頁籤 | 跨場域操作，接近 U7 排除的範圍 |
  | R3 發給場域的整合用金鑰 | 管理者代某場域產生金鑰，供程式或代為操作使用 | `POST /api/auth/admin/tenant-api-keys` | 只有管理者金鑰 | 「管理者」頁籤 | 屬於 U10 第 2 點「權杖的形式」的機制 |
  | R4 檢查預設 Manager 帳號的設定 | 查看啟動時自動建立的 Manager 帳號是否已設定、是否存在 | `GET /api/auth/bootstrap/manager-status` | 只有管理者金鑰 | 沒有 | 屬於安裝與初始化，不是使用者流程 |
  | R5 場域內稽核事件查詢 | 列出本場域的寫入操作紀錄，可依動作篩選 | `GET /api/audit-events` | 任何已登入者（沒有角色限制） | 沒有 | `AUDIT_EVENTS_ENABLED` 預設關閉，關閉時不寫入，查到的是空清單 |
  | R6 修改原因代碼的管理 | 新增、修改、初始化 Q6 用的修改原因選項 | `POST /api/edit/reasons`、`PATCH /api/edit/reasons/{id}`、`POST /api/edit/reasons/init` | 任何已登入者（沒有角色限制） | 沒有 | 與 Q6 同屬「修改已匯入的紀錄」 |
  | R7 站點、欄位、驗證規則、分析對應、站點關聯的設定 | 通用表單架構的設定，讀取任何已登入者可用，寫入需要管理者金鑰 | `/api/stations*` | 讀：任何已登入者；寫：管理者金鑰 | 「管理者」頁籤的四個子頁籤 | 只有 `USE_GENERIC_SCHEMA=true` 時路由才存在，預設關閉；開不開要先定，否則無從比對 |
  | R8 供外部系統讀取的資料端點 | 把 P1、P2、P3 攤平成分析用格式、UT 資料、系統常數（材料、分條機台） | `GET /api/v2/analytics/flatten`、`/flatten/monthly`、`/api/v2/ut/flatten`、`/api/constants/*`，以及兩個 `/health` | 任何已登入者 | 沒有（畫面不呼叫） | 是給其他程式呼叫的介面，不是使用者操作 |
  | R9 健康檢查 | 服務存活、就緒、詳細狀態 | `/healthz*` | 不需登入 | 沒有 | 維運用途，與產品線的自我檢查有關，不在四條使用者流程內 |

  出處：`be/api/routes_tenants.py`、`be/api/routes_auth.py` 第 323、904、1051 行、`be/api/routes_audit_events.py` 第 19 行、`be/services/audit_events.py` 第 11 行、`be/api/routes_edit.py` 第 67、119、406 行、`be/api/routes_stations.py`、`be/api/routes_analytics.py` 第 95、193、269 行、`be/api/routes_ut.py`、`be/api/constants.py`、`be/api/routes_health.py`；畫面入口依 `fe/pages/AdminPage.tsx` 第 226 至 533、559 至 584 行。

## 6. 修訂紀錄

（凍結後的更正一律追加在此，不改上文。）
