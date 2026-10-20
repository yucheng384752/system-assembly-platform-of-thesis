---
id: "20261020-preview-wiring"
title: "畫面接上預覽後端：真實預覽偵測、Recipe 推送、第一批三個畫面讀寫真實 API"
status: "in_progress"
owner: "codex"
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

（待 Codex 填寫：做了什麼、驗證結果、停止原因與缺依據的欄位。）

# Claude Notes

（待驗收：Docker 全量預覽、獨立部署、瀏覽器 Network 證據。）
