---
id: "20261104-kit-standalone-verification"
title: "Kit 獨立執行性驗證：必要 Kit 加任一選配 Kit，組出系統包並在 VM 安裝與操作"
status: "done"
owner: "claude"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-11-04"
updated_at: "2026-11-04"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "services/package/e2e/kit-matrix/"
    type: "directory"
---

# 目的

user 要求：Kit 手冊要一個個實測後再寫，並順便驗證 Kit 的可獨立執行性。「獨立執行」的定義（user 2026-11-04）：必要 Kit 加任一選配 Kit，要能組出系統包，並在 VM 上可安裝、可操作。本文件是第一輪的測試結果，手冊內容尚未撰寫。

# 方法

- 組合：必要 Kit（platform-core、entry-permission、station-data-link、upload-validation，加必選流程 data-import 帶入的 import-pipeline）加一個選配 Kit。選配共 9 個，station-admin-kit 被組裝器排除（無正式來源），另 8 個各一組。
- 每組：本機真實組裝（真實 Python 檢查，非 Node 替身）、前端建置、在 Ubuntu 22.04 VM（Docker 29.1.3、Compose 5.6.0）建離線映像、以測試根金鑰簽章、安裝引擎 `verify`、`issue-license`（綁這台機器的硬體）、`plan`、`apply`（11 步與健康檢查）、操作驗證、還原與清理。
- 操作驗證：通用冒煙（healthz、前端首頁、授權有效且硬體相符、無憑證 401、強制改密碼、登入、後端容器內列出的所有不帶路徑參數的 GET 路由皆不得 5xx）加功能操作（建使用者與角色權限、表單與欄位、CSV 預覽與匯入、編輯加原因、刪除、資料流連結，以及各選配 Kit 自己的路由）。factory-core 另跑既有 `factory_e2e.py`（寫入、重啟、驗證）。
- 工具：`services/package/e2e/kit-matrix/`。授權與金鑰皆為測試用，非正式根金鑰。

# 結果

| 組合 | 組裝 | 前端 | 映像 | 安裝 | 通用冒煙 | 功能操作 | 後端 5xx |
|---|---|---|---|---|---|---|---|
| 只選必要 Kit | 失敗 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |
| 必要 + generic-forms + audit-edit（基底） | 通過 | 通過 | 通過 | 33 秒 | 24/24 | 31/32 | 0 |
| 基底 + query-traceability | 通過 | 通過 | 通過 | 103 秒 | 24/24 | 36/37 | 0 |
| 基底 + analytics | 通過 | 通過 | 通過 | 32 秒 | 27/27 | 38/39 | 0 |
| 基底 + logs-ops | 通過 | 通過 | 通過 | 130 秒 | 26/26 | 35/36 | 0 |
| 基底 + mod-subscription | 通過 | 通過 | 通過 | 36 秒 | 24/24 | 36/37 | 0 |
| 基底 + factory-core | 通過 | 通過 | 通過 | 169 秒 | 23/23 | 31/32，另 e2e 49/49 與重啟後 8/8 | 0 |
| 基底 + station-admin | 依設計排除 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |
| 基底 + analytical-four（main） | 失敗 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |
| 基底 + analytical-four（`feature/analytical-four-verification` 519aff0） | 通過 | 通過 | 通過 | 約 1 分鐘（映像建置 1098 秒） | 32/32 | 31/32 | 0 |

功能操作每組唯一的失敗都是發現 3（稽核事件權限），其餘全過。

# 發現

1. **只選必要 Kit 組不出系統包。** `upload-validation-kit`（必要）的上傳頁需要 `generic-forms-kit`（D152），`generic-forms-kit` 的通用表格頁又需要 `audit-edit-kit` 的編輯視窗。兩條相依沒有宣告在 Kit 目錄的 `dependencies`，只在前端組裝時報錯（訊息：「前端無法在沒有 generic-forms-kit 時納入」）。使用者在 Composer 只選必要流程，到產出系統包才會被擋。待 user 決定：把這兩條相依宣告進 Kit 目錄（建議），或把必要集合改成包含它們。
2. **安裝引擎解壓的檔案權限取決於呼叫者的 umask。** `package.py` 以 `open(target, 'xb')` 建檔，不指定權限。在 `umask 077` 下 apply，`system-manifest.json` 變成 0600 root，以 uid 10001 執行的後端讀不到，授權閘門報 `manifest-missing`，`health-check` 步驟逾時失敗並自動還原該步驟。預設 umask 022 下 11 步全過。建議引擎明確設定解壓檔案權限，或在手冊註明；本輪未修改引擎。
3. **稽核角色可見的入口與端點實作不一致。** `permissions/entry_points.json` 的 `audit.events_read` 宣告 admin、manager、audit 可讀，但 `routes_audit_events.py` 內部寫死 `system-admin only`（基線版 2026-08-21 的使用者決定），audit 與 manager 角色一律 403。兩層權限取交集，所以實際只有管理員可讀。需決定以哪一邊為準。
4. **`analytical-four-kit` 在 main 上組裝失敗。** `check_tree.py` 不認得套件重新匯出的名稱（例如 `app.analytical_four.engine.data_manager.CSVDataManager`）。`feature/analytical-four-verification`（尚未合併）已修，我用該提交在獨立的 detached worktree 組裝與建前端皆通過。
5. **analytical-four-kit 無法在目前的 VM 驗證安裝。** 該分支回報映像 2.5 GB；VM 根目錄只剩約 5.3 GB（其中 snap 4.4 GB、系統日誌 1.7 GB 非本測試產生），建置、存檔、打包、安裝時載入與解壓的峰值超過可用空間，不冒險執行。需要擴充 VM 磁碟，或 user 同意清理上述項目。
6. **查詢頁面對不存在的批號回 200 與空結果，不是 404。** query-traceability 的 `/lot` 與 `/trace` 皆如此；非錯誤，但畫面需要自行顯示「查無資料」。
7. **匯入預覽遇到只有標頭或無法解析成列的檔案，回 `total 0` 且沒有訊息。** 真正的二進位檔會回 422。
8. **既有 `factory_e2e.py` 讀 `DATABASE_URL` 環境變數，正式系統已改為秘密檔。** 不帶變數執行時有 6 項資料庫守衛檢查因 KeyError 而失敗（腳本問題，非 Kit 缺陷）；驅動腳本改為從容器內 `/run/secrets/database_url` 讀出後傳入，6 項隨即全過。

# 已驗證的修正（本輪順帶）

- 通用表單的匯入預覽只列可匯入的新列（先前連重複列一起列），型別錯誤訊息改用「整數、數值、是否、日期」。系統中實測：3 筆含 1 筆錯誤的 CSV 預覽為 2 筆可匯入 1 筆錯誤，訊息含「整數」不含 integer；與既有資料重複的列只計入重複數、不出現在預覽表。

# 未涵蓋

- 瀏覽器介面：前端 bundle 已建置且首頁可由代理提供，但沒有在瀏覽器逐頁操作；上一輪（D152）只走過登入、上傳頁、查詢頁。
- 非管理員角色的完整授權矩陣：只驗了操作員、稽核對表單、分析、日誌、編輯的拒絕與放行。
- 多個選配 Kit 同時選取的組合，與 `merge-delivery` 併入手冊後的整包。
- 長時間運作、備份還原、升級。
- analytical-four-kit 的安裝與操作（見發現 5）。station-admin-kit 沒有正式來源，無法驗證。
- `wizard` 網頁精靈。

# 第二輪（user 決定後）

user 2026-11-04 的決定：相依補進 Kit 目錄；稽核事件待說明後決定；清理 VM；引擎權限待說明後決定；開始撰寫手冊；修完缺陷後補測未涵蓋項目。

## 已做

- **發現 1 已修**：`config/kits/overlay.json` 新增 `extraDependencies`（upload-validation 相依 generic-forms，generic-forms 相依 audit-edit），`catalog.ts` 與 `services/preview/assemble.mjs` 同步套用，基線 manifest 不動。`catalog.test.ts` 新增測試（必要功能展開後包含兩者）；全套 648 通過。必要集合現在可組裝，且就是已安裝驗證過的「基底」組合。
- **VM 清理**：移除 8 個已停用的 snap 舊版本、日誌縮到 100 MB、清 snap 下載快取與 apt 快取。可用空間 5.3 GB 增為 7.7 GB。沒有動使用中的 snap 與 Docker 基底映像。
- **多選配同時安裝（原未涵蓋）**：基底加 query-traceability、analytics、logs-ops、mod-subscription、factory-core 同時選取，安裝 153 秒，冒煙 31/31，功能 52/53（唯一失敗仍是稽核事件權限），後端 5xx 0。
- **瀏覽器逐頁操作（原未涵蓋）**：以 SSH 通道從 Chrome 操作上述系統：登入、首次強制改密碼（過短密碼被拒並有明確訊息）、登出、建立表單、欄位定義與儲存、「檔案上傳」預覽與匯入、重複列、通用表格直接上傳、紀錄查詢、編輯（含原因，顯示「紀錄已更新」）、資料查詢（命中、查無資料、追溯路徑）、資料分析、日誌、資料流連結、操作員權限。資料庫核對：編輯後 `row_edits` 保存修改前後值（`{"qty":10}` 至 `{"qty":12}`）、原因與操作者；`audit_events` 仍 0 筆。

## 新發現（皆未修改）

9. **操作員按「建立」表單時，伺服器回 403，畫面沒有任何提示**（靜默失敗）；操作員仍看得到所有分頁與建立、刪除按鈕。
10. **`audit_events` 在編輯、匯入後仍是 0 筆**：稽核事件清單實際上不會有資料，編輯差異存在 `row_edits`，且畫面沒有檢視入口。
11. **日誌頁全英文且不隨語言切換**；通用表格、檔案上傳、編輯都不寫入日誌（只有程式明確回報的使用者動作與警告以上系統事件），正常系統的日誌是 0 筆。
12. **「資料查詢」頁沒有套用其他頁的樣式**（預設按鈕與輸入框）。
13. 欄位定義儲存按鈕文字為「儲存 Schema」，驗證訊息含 `is_key`，型別下拉為英文代碼；與「只顯示業務語言」的原則不一致。儲存成功與資料流新增成功都沒有提示。
14. 通用表格與檔案上傳的匯入不列入「資料分析」的上傳紀錄。
15. 表單用的 `form_input` 式程式填值不會觸發前端狀態（核取方塊要真實點擊）；僅影響自動化測試，不是產品缺陷。

## 手冊（D52）進度

依實測改寫使用者手冊：upload-validation、station-data-link、generic-forms、audit-edit、query-traceability（補段）、analytics（補段）、logs-ops、platform-core、entry-permission；管理者手冊：platform-core（安裝流程）、entry-permission、upload-validation、station-data-link。其餘 Kit（import-pipeline、mod-subscription、factory-core、station-admin、analytical-four 與各 Kit 的開發者版）未動：它們沒有操作畫面，或沒有正式來源可驗證。狀態維持 draft，待 user 審閱。`sources` 受 schema 限制只能是 `kits/` 下的檔案，但「檔案上傳」、登入與日誌頁等前端在 `services/frontend/base`，無法列為來源，需 user 決定是否放寬 schema。

## 待 user 決定

- 發現 3（稽核事件權限）：建議維持端點的限制，把入口宣告改為只有系統管理員，畫面才不誤導；若要讓稽核角色可讀則要改端點並限縮在自己的租戶。
- 發現 2（引擎解壓權限）：建議由引擎明確設定檔案權限。
- 發現 9 至 14 是否要修，以及手冊 sources 範圍。

## analytical-four-kit 安裝驗證（發現 4、5 的後續）

- 來源：`feature/analytical-four-verification` 的 519aff0（未合併，main 上仍無法組裝，發現 4 仍成立）。清理後 VM 剩 7.7 GB 足夠。
- 結果：映像建置 1098 秒（2.54 GB），封裝為 763 MB 的系統包；安裝 11 步全過含健康檢查；冒煙 32/32（22 條 GET 路由）；功能操作 31/32（唯一失敗仍是稽核事件權限）；後端 5xx 0。
- 該 Kit 自己的流程：狀態與資料檢查在尚未載入範例時回報「找不到分析設定檔」並列出缺少項，屬預期；`POST /api/analytical-four/demo` 載入範例檔後資料檢查通過（60 列、12 個數值特徵）；`POST /api/analytical-four/runs` 回 202，輪詢到 succeeded，讀資料、描述統計、診斷、不良碼 4 階段全部完成。第三層（AI 診斷）預設關閉，未驗證。
- 驅動腳本假設系統代號為 `kv-<組合名>`，此組合的配方名稱是 `kv-a4`，所以計畫步驟報「system-id 與 manifest 不符」；改用代號替換後的腳本副本接續完成，已清理。
- 發現 5 結案：需要約 3 GB 以上的空間餘裕；可用 7.7 GB 時可裝。

# 第三輪（user 決定後的修正與最終驗證）

user 決定：稽核事件按建議（D165）、引擎解壓按建議（D166）、手冊 sources 放寬（D167）、發現 9 至 14 全部修（D168）、測試通過後合併、sudoers 測試完成後由 user 處理、a4 worktree 確認不影響後移除。決議編號 D163 至 D168（其他分支如 canvas-to-project 若也用 D163 以後須改號）。

## 修正與驗證

- 引擎解壓權限：`package.py` 解壓後明確 chmod；新增 umask 077 單元測試，在 VM 上驗證：未修正時失敗、修正後 49 項全過。
- 稽核入口：`audit.events_read` 預設角色改為 admin。
- 發現 9：通用表格、資料流、日誌、資料分析、資料查詢、檔案上傳、編輯視窗、編輯原因頁，被拒時顯示「您的角色沒有這項操作的權限，請洽管理者。」等業務語言；瀏覽器實測操作員建立表單，右下角出現紅色提示，日誌頁顯示「您的角色沒有查看日誌的權限」。
- 發現 10、11：建立與刪除表單、儲存欄位定義、上傳、匯入、刪除紀錄、編輯紀錄都寫入稽核事件與日誌；日誌必須帶租戶代號才會出現在租戶查詢（第一次修正漏帶，功能測試抓到，已補）。
- 發現 11、12、13：日誌頁中文化；資料查詢頁補上缺的 CSS（約 25 個類別原本沒有規則）；「Schema」「is_key」與英文型別改業務用語；儲存、新增、刪除成功顯示提示。
- 發現 14：資料分析的「上傳紀錄」明列只含檔案上傳工作。沒有把表單匯入寫成上傳工作，因為 upload-validation 相依 generic-forms，反向相依會成環。
- 發現 4（analytical-four 在 main 無法組裝）已隨 main 合入 519aff0 解決。

## 最終結果（基底加 5 個選配同時安裝，含上述所有修正）

- 組裝、前端建置、映像、安裝（apply 38 秒）通過；冒煙 31/31；功能操作 57/57（先前每組的唯一失敗改為預期行為並納入測試：稽核角色被拒，管理員可讀並含 forms.create、forms.schema.save、forms.import、records.edit；日誌可查到 forms.create 與 forms.import）；後端 5xx 0。
- 本機：`npm test` 649 通過 1 略過；typecheck 通過；通用表單 Python 單元測試 5 通過。

## 仍未涵蓋（誠實列出）

- 第三輪的成功提示（「表單已建立」「欄位定義已儲存」「連結已新增」等）只由程式與建置驗證，沒有在瀏覽器逐一看過；被拒提示、日誌頁、查詢頁有在瀏覽器看過。
- analytical-four-kit 前端頁（D161）我沒有在瀏覽器操作；其使用者手冊仍寫「目前只提供後端介面，沒有操作畫面」，已過時，需對照該頁後修正。
- 備份還原、升級、`rollback` 與 `status` 子命令、網頁精靈、對外反向代理與加密連線、鎖定 5 次 15 分鐘的實際觸發、忘記密碼重設。
- 手冊中 import-pipeline、mod-subscription、factory-core、station-admin（無來源）與各 Kit 的開發者版未重寫。

## 手冊完成清單（狀態皆為 draft，待 user 審閱）

使用者版：platform-core、entry-permission、station-data-link、upload-validation、generic-forms、audit-edit、query-traceability、analytics、logs-ops。管理者版：platform-core、entry-permission、station-data-link、upload-validation。

# 環境與清理

- VM：192.168.200.63，每組測完以測試專用腳本移除容器、資料卷、`/opt`、`/etc`、`/var/lib` 下該系統的目錄與映像；`~/kv`（Node 22.23.3、測試金鑰、腳本）留著供下一輪。
- 使用者先前為實機驗證加的臨時 sudoers（`/etc/sudoers.d/wp5-test`）仍在，測試結束後應移除。
- 驗證用 worktree：`composer-refactor-kitverify-wt`（本分支 `verify/kit-standalone`）、`composer-refactor-a4-wt`（detached，僅用於組裝 analytical-four 的另一分支，不寫入）。

## 第四輪：生命週期與未涵蓋項目補測

環境：VM 192.168.200.63，基底、資料分析、analytical-four 三組依序安裝後保留測試。

| 項目 | 結果 |
|---|---|
| 基底重裝（重新組裝，非舊封裝） | 冒煙 24/24，功能 35/35，後端 5xx 0（先前 33/35 是 kv-out/base 為修正前的舊封裝，非產品缺陷） |
| 資料分析組合 | 冒煙 27/27，功能 42/42，5xx 0 |
| analytical-four 組合 | 冒煙 32/32，功能 35/35，5xx 0 |
| status | 回傳 22 個事件與各步驟狀態 |
| rollback | 兩段式（還原計畫、雜湊確認）；容器全數移除、狀態 rolled-back；資料卷、秘密檔、安裝目錄依設計保留並列出；重裝前須先清除保留項目 |
| 鎖定 | 連錯 5 次鎖定（locked_until 約 15 分鐘後）；鎖定中正確密碼也被拒且訊息相同；改 locked_until 為過去後可登入，失敗計數歸零；不影響其他帳號 |
| 重設密碼與停用 | 管理員重設成功並清除鎖定、must_change_password 為真；舊密碼被拒；停用後無法登入、重新啟用恢復；操作員重設得 403 |
| 網頁精靈 | 頁面、app.js、style.css 200；無權杖、錯誤權杖 403；錯誤主機標頭 403；錯誤來源 403；非 JSON 415；超大請求 413；CSP default-src none；detect 在 8080 被占用時回報「連接埠已占用」 |
| 綁定範圍 | 代理 127.0.0.1:8080；從 Windows 主機連 192.168.200.63:8080 被拒 |
| 瀏覽器：成功提示 | 「表單已建立」「欄位定義已儲存（版本 1）」「表單已刪除」已看到；「連結已新增/更新/刪除」「紀錄已刪除」未逐一確認 |
| 瀏覽器：資料分析拒絕訊息 | 操作員看到「上傳紀錄載入失敗：您的角色沒有查看這項資料的權限，請洽管理者。」 |
| 瀏覽器：analytical-four | 四個分頁存在；載入示範資料（11 檔）、資料檢查通過、啟動每日監控分析約 1 秒完成並產生結果檔。未做客訴分析、C 層、回饋提交核可與發布 |

產品未提供（非缺陷）：備份還原與升級遷移。
未涵蓋：反向代理與 TLS 本身、PROXY_BIND／HTTP_PORT 覆寫的實際安裝、客訴分析與 C 層、回饋與案例庫流程、其餘 Kit 手冊與開發者版。

手冊更新：analytical-four 使用者版改為實際畫面描述；platform-core 管理者版補 status／rollback／精靈／綁定範圍；entry-permission 管理者版補鎖定與重設密碼。
