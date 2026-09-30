---
id: "20260930-install-package"
title: "設定交付包壓縮檔（D21、D28、D31–D36）"
status: "ready_for_review"
owner: "user"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-09-30"
updated_at: "2026-09-30"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "schemas/package-manifest.schema.json"
    type: "file"
  - path: "apps/composer-gui/src/zip.ts"
    type: "file"
  - path: "apps/composer-gui/src/deliveryPackage.ts"
    type: "file"
  - path: "apps/composer-gui/src/OutputPage.tsx"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
  - path: "docs/project-spec.md"
    type: "file"
---

# Goal

在 05 輸出提供單一壓縮檔「設定交付包」（D21、D28）。分支 `feature/install-package`，由 main（9ab2313）開出。名稱沿用 D28 的分支名；畫面與包內文字一律稱「設定交付包」，不寫「安裝」。

# User 已確認（2026-09-30）

user 同意 Claude 列出的十項建議，並指定第 1 項自寫 zip、可參考基線版。決議寫入 D31–D36：

1. 自寫 store（不壓縮）zip，不新增依賴；固定順序與時間戳，相同設定產出相同位元組（D31）。
2. 只放實際產物；§12 其餘目錄列入 manifest `notProvided`，不建空目錄（D32）。
3. manifest 沿用基線名稱 `package-manifest.json`，不記錄產生時間，先寫 schema（D33）。
4. 不含 Kit 原始碼與安裝腳本，Kit 只記錄 id 與版本（D32）。
5. 缺少手冊不阻擋，標為未提供（D34）。
6. 驗證報告：靜態檢查；測試環境演練與現場驗證標為「未執行」；任一靜態檢查失敗即不產生交付包（D35）。
7. 可重現：manifest 不含時間；檔名 `<Recipe name>-delivery-<manifest sha256 前 12 碼>.zip`（D36）。
8. 保留流程規格與系統設定檔的分別下載（D36）。
9. 本期只輸出，不支援匯入交付包（D36）。
10. 包內附 README.md，說明不能安裝、包含與不包含的項目（D32）。

# Claude Notes

## 基線版參考（唯讀）

- `gui/app.js` 以內嵌的 `jszip.min.js` 產生客戶部署 zip，內含 `recipe.json`、`aov/`、`deploy.ps1` 與 `phases/*.ps1`；`tools/package-system.ps1` 以 `Compress-Archive` 產生 zip，並寫入含 `generatedAt` 的 `package-manifest.json`。
- 基線版沒有自寫 zip。本功能只沿用 manifest 名稱（D02）。論文可對照的改良有：不附部署腳本（D21）、manifest 記錄各產物的 sha256、去除產生時間使結果可重現。

## 交付包內容

```text
package-manifest.json  README.md  config/system.recipe.json  aov/workflow.aov.json  validation/report.json
```

- 包內的系統設定檔與流程規格，和分別下載的檔案位元組相同。
- 包內系統設定檔的 `workflowRef.path` 維持檔名 `workflow.aov.json`（Recipe schema 不允許含 `/`），實際檔案以 manifest 的 `role: workflow` 定位，以 sha256 核對。
- 敏感鍵名掃描只檢查 JSON 鍵名，例如 password、token、connection、deploymentConfig、licensee；不檢查使用者輸入的文字值。報告中已註明此限制。

## 驗證

- typecheck、build 通過；測試 49 passed、1 skipped（身分授權「未涵蓋」，沿用）。新增 zip 4 項、交付包 4 項，並擴充 05 輸出的介面測試。
- 突變檢查，6 項皆被測試攔到：拿掉 workflowRef 比對、拿掉敏感鍵名檢查、時間改為隨當下變動、CRC 不寫入、拿掉 UTF-8 檔名旗標、拿掉路徑檢查。
- 外部工具：以 Node 產生含中文檔名的 zip。Python `zipfile.testzip()` 回報無錯誤；Windows PowerShell `Expand-Archive` 能正確解出中文檔名，時間為 1980-01-01；Windows `tar -tvf` 可列出內容。
- Chrome 實測（dev server 5173，1905 寬，以 JS 驅動原生事件，攔截下載、不寫入磁碟）：
  - 兩步驟各上傳一張模擬 CSV，確認關聯後進入 05。未填客戶代稱時交付包按鈕停用，填寫後啟用。
  - 下載 `my-system-delivery-3521001a7582.zip`（application/zip），包內 5 個檔案，4 項產物 sha256 全部相符。
  - 包內兩個檔案與分別下載者相同，`workflowRef` 相符，不含樣本值，`installable: false`。
  - 無水平溢出，console 無錯誤。
- 720×450 同源 iframe（相當於 200%）：無水平溢出，交付包按鈕高 44px。

## 未涵蓋與已知限制

- 未以實際下載到磁碟的交付包做 Expand-Archive 解壓。外部工具驗證使用同一個 `createZip` 產生的樣本檔。
- 不支援 ZIP64；超過 4 GB 或 65535 個檔案時會明確報錯。目前產物皆為小型 JSON。
- 敏感值掃描只檢查鍵名。
- 瀏覽器實測以 JS 驅動，未以實體鍵盤逐一操作。

# Open Questions

- 交付包的驗證報告（`validation/report.json`）目前只有 TypeScript 型別，沒有 JSON Schema；若日後有其他讀取端，建議補上契約。
