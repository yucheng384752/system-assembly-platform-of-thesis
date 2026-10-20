---
id: "20261020-preview-wiring"
title: "畫面接上預覽後端：真實預覽偵測、Recipe 推送、第一批三個畫面讀寫真實 API"
status: "completed"
owner: "claude"
reviewer: "claude"
priority: "high"
created_by: "claude"
created_at: "2026-10-20"
updated_at: "2026-10-20"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "docs/decision-log.md"
    type: "file"
  - path: "apps/composer-gui/src/KitPreview.tsx"
    type: "file"
  - path: "services/preview/README.md"
    type: "file"
---

# Goal

預覽後端（`services/preview/`，D104 至 D109、D115）已驗證，但 Composer 畫面（`KitPreview`）仍渲染內建模擬資料，標籤「模擬資料」是正確的。本功能讓畫面實際接上後端：連得上才顯示「真實預覽」，並且第一批三個畫面讀寫真實 API。標籤必須跟實際連線與實際資料來源走，不能只改文字（見記憶「標籤要符合實際」）。

# Success Criteria

1. 偵測：畫面探測後端健康檢查；回應為預期的預覽後端才算連線，其餘（無回應、非預期內容、逾時）一律為「模擬資料」。探測失敗不得拋出未處理錯誤，也不得讓畫面空白。
2. 標籤逐畫面計算：只有「後端連線、Recipe 已成功套用、該 Kit 在 capabilities 為開放、該 Kit 屬第一批」四項同時成立，該畫面才標「真實預覽」並讀寫真實 API；其餘 Kit 維持模擬資料並明講「此功能尚未接上真實資料」。
3. Recipe 推送：選配變更（Kit 或子功能）後，連線時把目前 Recipe 推給後端；422 時顯示後端回的原因（業務語言），並視為「Recipe 未套用」，不顯示真實預覽。
4. 三個畫面（通用表單、上傳驗證、追溯查詢）以真實 API 讀寫；寫入只在使用者按下明確按鈕時發生，只寫入本機預覽後端。
5. 跨網域以 Vite 開發伺服器代理解決；不改後端 CORS。
6. 單元測試涵蓋：偵測的四種結果、標籤邏輯（四項條件逐一拿掉都退回模擬資料）、Recipe 推送與 422、三個畫面的讀寫（以注入的假 fetch）。既有測試全數仍通過。

# 決議（D116 至 D119，已寫入 decision-log）

## D116 偵測與標籤
- 前端只透過同源代理路徑 `/preview-api/` 存取後端（D119），不直接寫死 `http://127.0.0.1:18000`。探測 `GET /preview-api/healthz`，回應 200 且 JSON 為 `preview === true` 且 `status === 'ok'` 才算連線。
- 探測在畫面載入時與每次使用者按下「重新偵測」時進行；不做背景輪詢。逾時 3 秒。
- 打包後的靜態版（沒有 Vite 代理）探測會失敗，結果為「模擬資料」，這是預期。

## D117 Recipe 推送與能力
- 連線後，Recipe 變更經 400 毫秒防抖，`PUT /preview-api/_preview/recipe`（標頭 `X-Admin-API-Key: preview-fake-admin-key`，這是 D106 的固定假值，不是驗證機制），成功後 `GET /preview-api/_preview/capabilities`。
- 以 capabilities 的開放清單與 `unavailable` 決定每個已選 Kit 的狀態：開放、被拒絕、預覽無後端。分頁仍可選取（顯示設計用的模擬畫面），但狀態以文字標示，不只靠顏色。
- 推送的 Recipe 為畫面目前 Recipe 本身，不另造結構。
- 「重新偵測」之後若後端換了選配（例如別的工作階段），以畫面為準重新推送。

## D118 第一批三個畫面
- `generic-forms-kit` 通用表單：列出表單、建立表單（代碼與名稱）、檢視某表單的資料列。
- `upload-validation-kit` 上傳驗證：選擇檔案、上傳、查詢處理狀態、顯示驗證結果。
- `query-traceability-kit` 追溯查詢：輸入批號、顯示批號查詢與追溯結果。
- 欄位與回應形狀必須從 `kits/<kit>/src/backend` 的實際路由與 `services/preview/smoke.mjs` 推導，不得猜測；推導不出來時停止並寫在 Codex Notes。
- 所有後端回來的文字一律以純文字呈現。畫面只顯示業務語言（「表單」「批號」「上傳檔案」），不顯示資料表、API 路徑或框架名稱；錯誤訊息要翻成業務語言並附 HTTP 狀態以便排查。
- 後端回 404（尚未建立預覽租戶）時，畫面說明「預覽資料尚未初始化」及一行指令 `docker compose ... exec -T backend python -m app.preview_seed`（指令放在輔助說明，不當作業務功能）。
- 預覽無副作用原則的適用：模擬畫面不發請求；真實預覽的寫入只在使用者按下按鈕時發生，且按鈕旁標明「寫入預覽資料庫（測試用）」。

## D119 跨網域
- `vite.config.ts` 增加 `server.proxy`：`/preview-api` 代理到 `http://127.0.0.1:${PREVIEW_API_PORT ?? 18000}`，並移除前綴。後端 CORS 不放寬、不改 `services/preview/`。
- `preview` 指令（`vite preview`）不需代理。

# 範圍與限制

- 可修改：`apps/composer-gui/src/`（新增 `previewBackend.ts`、`live/` 三個畫面與測試，修改 `KitPreview.tsx` 與必要的 `style.css`）、`vite.config.ts`。
- 不得修改：`services/preview/`、`kits/`、`schemas/`、`config/`、`libs/`、`package*.json`；不新增 npm 依賴（用內建 fetch）；不得 `any`。
- UI 必須遵守 `DESIGN.md`；回覆與介面文字用繁體中文，無 emoji 與圖示字元（沿用既有 `Icon`）。
- Codex 沙箱無網路、不能開埠、不能執行 Docker、不能寫 git：只寫程式與測試；實測由 Claude 執行。
- 驗證指令：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`；結果（含失敗與略過）如實寫入 Codex Notes。
- 需要改上述不可修改的檔案、新增依賴、或規格與後端實際行為矛盾時：停止並在 Codex Notes 寫明。
- 兩個程序同時改同一工作樹的風險：開工前 Claude 已確認 git status 乾淨。

# 計畫與預計完成時間

| 步驟 | 內容 | 負責 |
|---|---|---|
| 1 | thread、D116 至 D119、分支 `feature/preview-wiring` | Claude（完成） |
| 2 | `previewBackend.ts`（探測、推送、capabilities、標籤邏輯）與測試 | Codex |
| 3 | 三個真實畫面與 `KitPreview` 整合、Vite 代理、測試 | Codex |
| 4 | typecheck、test、build | Codex 先跑，Claude 複驗 |
| 5 | Docker 實測：全量預覽與獨立部署分開報告；瀏覽器確認 Network 有實際請求 | Claude |

**預計完成時間（Codex 實作，步驟 2 至 4）：2026-10-20 17:30。** 到期未完成、額度用完或任務失敗，由 Claude 接手，不空等。

# Handoff

交付 Codex：步驟 2 至 4。完成後 thread 的 owner 改回 claude，狀態維持 in_progress。

# Codex Notes

2026-10-20 Codex：步驟 2 至 4 **尚未完成**，因同一工作樹有並行改寫而停止整合，待確認單一寫入者。

- 已完整讀取指定 thread、D116–D119、CLAUDE.md、DESIGN.md、README、smoke 與 KitPreview。資料格式依據：
  - `routes_generic_forms.py` 的 StationCreate／StationRead、list_forms、create_form、list_records（含分頁與 records 的 id／lot_no_raw／data）。
  - `routes_upload.py` 的 upload_file、get_upload_status；schemas/upload.py；`routes_validate.py` 與 schemas/validate.py。sample_errors 的行號從 0 開始，validate 查詢的行號已加 1。
  - `routes_query_v2.py` 的 search_lot、trace_lot，顯示站別名稱、紀錄與上下游關聯。
  - `services/preview/app/preview_gate.py` 的 snapshot 與 main.py 的 recipe/capabilities 路由；config/registry 的能力識別碼。上傳畫面另讀驗證結果，須核對 `upload.validation.get`。
- 已新增 `live/GenericForms.tsx`、`UploadValidation.tsx`、`Traceability.tsx`、`shared.tsx` 與 `screens.test.tsx`；修改 KitPreview、style.css、vite.config.ts。三畫面有明確寫入按鈕、測試資料庫提示、404 初始化輔助說明、純文字呈現及回應型別檢查。模擬 Renderer 的解析邏輯未改。
- **並行寫入衝突**：Codex 新增的 `previewBackend.ts` 在 15:06:24 被另一程序改為不同介面（現存 `Fetcher/probeBackend/applyRecipe/kitMode`；Codex 的呼叫端使用 `Fetch/browserFetch/previewRequest/kitAccess/previewLabel`）。沒有覆蓋或刪除另一程序的版本。已向 user 詢問停止另一寫入者並確認由誰整合，尚未收到答覆。
- 驗證結果：
  - `npm.cmd run typecheck`：失敗，主要為以上匯出不一致與連帶型別錯誤。
  - `npm.cmd run build`：失敗，在內含 typecheck 步驟停止，未執行 Vite build。
  - `npm.cmd test`：已執行，出現 `kitAccess is not a function`，包含 output.test.tsx 的 3 項失敗；後續持續執行但未輸出完整總結，已中止（exit 1）。不報完整通過／失敗總數。因 script 使用 `&&`，後續預覽 Node 測試未執行。
  - `live/screens.test.tsx` 在上述測試啟動後才新增，**尚未執行**。
- 待接手：先統一連線模組與所有呼叫端，補 probe 四結果、四條件標籤、Recipe 成功／422、防抖與過期回應測試，再重跑三個指定指令。現存另一版 probe 只使用 AbortController，且以 response.ok 判定，應核對嚴格 200 與 3 秒期限；重新偵測及 Recipe 換版須防止舊回應標成已套用。新增畫面目前不可交付使用。
- 未修改 services/preview、kits、schemas、config、libs、package*.json；未新增依賴，未做 git 寫入、網路、Docker 或啟動伺服器。真實瀏覽器、Docker 全量與獨立部署仍由 Claude 分開驗證。沒有缺乏依據而猜測的請求／回應形狀；本次停止原因為並行修改，不是後端契約缺失。

# Claude Notes

2026-10-20 Claude 接手完成（user 通知 Codex 額度用完）。

## 接手與衝突處理（規則 7）

Codex 與我同時寫同一工作樹：Codex 的 `previewBackend.ts` 被我的版本覆蓋（Codex 回報的「另一個程序」就是我），兩套實作介面不同（Codex：`Fetch/browserFetch/kitAccess/previewLabel`，我：`Fetcher/probeBackend/applyRecipe/kitMode/usePreviewBackend`）。裁定只留一套：保留我的連線模組與 `live/LiveGenericForms.tsx`、`LiveUpload.tsx`、`LiveTrace.tsx`、`previewApi.ts`（回應形狀以執行中的後端實測），刪除 Codex 的 `live/GenericForms.tsx`、`UploadValidation.tsx`、`Traceability.tsx`、`shared.tsx`、`screens.test.tsx`（對應已不存在的介面）；Codex 的 `vite.config.ts` 代理與 `.preview-tab-status` 樣式沿用。`KitPreview.tsx` 還原後以新模組重新整合。教訓：派工後不應在 Codex 執行期間自己寫同一批檔案（我在等待時開始實作，造成衝突）。

## 驗證（自動）

- typecheck 通過；`npm.cmd test`：40 個檔案、497 通過、1 略過（既有身分授權）、0 失敗；預覽 Node 測試同在 npm test 內；build 通過。
- 新增 `previewBackend.test.tsx` 22 項：探測四種結果（正確回應、錯誤內容、錯誤狀態、網路失敗、逾時）、標籤邏輯七個退回條件、Recipe 推送標頭與 422、三個畫面以注入的假 fetch 驗證「只在按鈕時寫入」與純文字呈現、KitPreview 三種連線情境。變異測試（拿掉「Kit 未開放」與「能力未開」兩個條件）使 2 項失敗，還原後全過。
- 既有 3 處「不得送出資料」測試原為 `fetch` 完全不可呼叫；預覽畫面現在會做健康檢查探測，改為除 `/preview-api/healthz` 以外不得有任何呼叫，資料列仍不外送的意圖不變。
- 分頁無障礙名稱維持為 Kit 名稱（`aria-label`），狀態文字以 `aria-describedby` 提供，既有測試不需改。

## 驗證（瀏覽器與 Docker，localhost 的 Vite 開發伺服器，Chrome）

全量預覽（9 個 Kit 的映像、`all` 模式）：
- 畫面顯示「預覽後端：已連線」；Network 實際出現 `/preview-api/healthz`、`PUT /_preview/recipe`、`GET /_preview/capabilities`，皆 200；改選配後再次推送。
- 通用表單、檔案上傳與驗證、查詢與追溯三個分頁標「真實預覽」，其餘分頁標「模擬資料」。
- 上傳一個含合法與非法批號的 CSV：後端回「通過 1 列、有問題 1 列」與錯誤列說明；批號查詢與追溯讀回種子資料；建立表單後直接以 API 讀後端，資料已寫入。
- 停止後端容器並按「重新偵測」：全部分頁退回「模擬資料」，說明「未連上預覽後端」。

僅所選 Kit 的獨立部署（5 個 Kit 的映像，`up --recipe`）：
- 只選上傳與表單相關功能時，Recipe 套用成功，上傳分頁為「真實預覽」，實際上傳通過；其餘分頁為模擬資料。
- 再加入「查詢追溯」（未納入此映像）：後端對 Recipe 回 422「未納入此映像，請重新組裝」，畫面全部退回模擬資料並顯示該原因；取消勾選後恢復真實預覽。這符合 D108 的原子拒絕，但也表示獨立映像不含的 Kit 一旦被選，整個預覽都不會升級為真實預覽。

## 未涵蓋與已知限制

- 靜態打包版（`vite preview`／build 產物）沒有代理，一律為模擬資料，預期。
- 5173 埠另有舊的 Vite 程序，與本功能無關，測試改用 5174。
- 探測在開發模式（React StrictMode）會出現兩次，正式版一次。
- 通用表單畫面不含「設定欄位」與「匯入」（需要修正原因等前置資料，D118 只要求列表、建立、檢視）。
- 第二層以後的子功能對應（某子功能未選時對應畫面關閉）只由 `kitMode` 的能力檢查涵蓋，未在瀏覽器逐一測。
- 使用 Chrome 擴充工具以腳本設定檔案與輸入值（不是人手操作），鍵盤與螢幕閱讀器流程未實測。

