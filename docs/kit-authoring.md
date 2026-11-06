# 添加新 Kit 規範

本文件說明新增一個 Kit 要做什麼、做到什麼程度才算完成。規則有兩種來源：已被自動檢查強制的（發布閘門、現場自檢、單元測試），以及人工審閱的。下面標明每一條屬於哪一種。決策記錄是 D182；Kit 的歷史與基線來源見 `kits/BASELINE.md`。

## 1. 開始之前

- 新 Kit 屬於新功能：開專屬分支（`feature/<name>`），不在 `main` 上開發；在 `docs/decision-log.md` 記下為什麼需要這個 Kit，以及它相對於既有 Kit 的邊界。
- Kit 的識別字是小寫英數字與連字號、以 `-kit` 結尾（例如 `inspection-kit`）。發布閘門只接受這個格式。
- 先確認是否真的需要新 Kit：能放進既有 Kit 的功能不要另開。

## 2. 目錄結構

```text
kits/<kit-id>/
  kit.contract.json        契約：提供與需要的能力、入口權限、管理員專用路由
  manifest.json            安裝腳本與安裝順序
  workflow.aov.json        這個 Kit 的作業流程（給畫布與預覽用）
  install.sh / install.ps1
  src/backend/app/...      後端程式（與其他 Kit 合併成同一個 `app` 套件）
  src/frontend/src/...     前端頁面與樣式（有畫面的 Kit）
  tests/                   測試（必備，見第 6 節）
config/registry/<kit-id>.json   能力登錄（Kit 宣告的 API 與資料能力）
config/kits/overlay.json        顯示名稱、業務說明、額外相依
manuals/kits/<kit-id>/<版本>/{user,mis,developer}.md   手冊片段
```

後端檔案路徑決定它合併後的位置：`src/backend/app/api/routes_x.py` 會成為 `app.api.routes_x`。兩個 Kit 不可提供同名檔案。

## 3. 契約 `kit.contract.json`

| 欄位 | 內容 | 強制方式 |
|---|---|---|
| `kit` | 與資料夾同名 | 現場自檢：契約宣告的 Kit 與安裝的 Kit 不符即失敗 |
| `provides.api` / `provides.db` | 提供的 API 能力（含 `method`、`path`）與資料能力名稱 | 現場自檢：別的 Kit 需要的能力必須有人提供 |
| `consumes.api` / `consumes.db` | 需要的能力 | 同上，缺少時錯誤訊息指名需要它的 Kit |
| `entryPoints` | 入口權限：每個入口有 `key`、`label`、`access`（read 或 write）、`defaultRoles`、`routes` | 現場自檢：宣告的路由必須存在；權限目錄必須與契約一致 |
| `adminRoutes` | 刻意只給內建管理員的路由（`method` 與 `path`） | 現場自檢：沒有被任何入口或這個清單涵蓋的路由會讓系統不啟動 |

規則：

1. **每一條對外路由都必須屬於某個入口，或明列在 `adminRoutes`。** 沒有宣告的路由只有內建管理員能呼叫，現場自檢會把它當成錯誤並指名定義它的 Kit，避免作者忘了宣告而不自知。
2. 預設角色要照實寫：入口宣告與端點內的檢查是取交集，兩邊不一致時，較嚴的那邊生效。稽核事件曾因此出現入口開放、端點卻只准管理員的矛盾（D165）。
3. 路徑參數用 `{名稱}`，名稱可以和程式裡不同，比對時不看名稱。
4. 需要的能力若由必要 Kit 提供（例如平台的 `db.tenants.read`），也要在提供者的契約裡列出，否則現場自檢會報缺少相依。
5. 被依賴的 Kit 要放進相依：`config/kits/overlay.json` 的 `extraDependencies` 補契約沒寫出的相依（D163）；組裝與 Composer 目錄都讀這份。

## 4. 登錄

1. `config/kits/overlay.json` 的 `add`（新 Kit）：`id`、`version`、`displayName`、`category`、`required`、`businessCapability`、`dependencies`、`subfeatures`。顯示名稱與說明只寫業務語言，不出現程式或資料表名稱。
2. `config/registry/<kit-id>.json`：列出 Kit 的能力，路徑與契約一致（analytical-four 有測試比對兩者）。
3. 若 Kit 有畫面，確認頁面只在登入後呈現，並依 `DESIGN.md`。
4. 重新組裝一個含新 Kit 的系統包，確認能組出（`node services/package/assemble-system.mjs <目錄> --recipe <recipe>`）。

## 5. 後端與畫面的約定

- **資料先於邏輯**：先定資料表與 API，再寫邏輯。資料表由安裝的初始化步驟建立，後端啟動時不建立資料表（缺資料表時現場自檢會失敗並指名宣告它的 Kit）。
- **不靜默失敗**：外部輸入先驗證；失敗要有意義的訊息與適當的狀態碼（輸入錯誤是 4xx，不是 500）。轉型失敗拋出的例外要在端點接住轉成 422（audit-edit 曾漏接，編輯時填入非數字變成 500）。
- **操作要留下紀錄**：會改變資料的操作寫入稽核事件（`write_audit_event_best_effort`）與使用者操作日誌（`report_user_action`，要帶租戶代號，否則租戶查詢看不到）。稽核寫入失敗不可讓原操作失敗。
- **秘密不落地**：連線字串、密碼、token 只經由外部來源引用，不寫進程式、設定、手冊或測試資料。
- **畫面語言**：使用者看到的文字是業務語言；伺服器拒絕時顯示「您的角色沒有這項操作的權限，請洽管理者」這類提示，不顯示 HTTP 碼或內部名稱；成功要有提示。
- **範例資料一律是合成資料**，不放真實製造資料。

## 6. 測試（發布閘門強制）

**每個可選入系統的 Kit 都必須有 `tests/`，且至少一個測試通過。** 發布流程在建好後端映像後，會在映像裡逐個 Kit 執行測試；任何一個 Kit 沒有測試或測試失敗，就不產出安裝包，錯誤訊息指名該 Kit。

寫法：

1. 檔名 `test_*.py`，用 pytest 或 unittest 皆可（閘門以 pytest 執行）。
2. **從 `app.*` 匯入。** 閘門把合併後、實際出貨的後端放在 `PYTHONPATH`，所以測試驗的是出貨的程式，也能使用其他 Kit 的程式（例如需要通用表單的轉型函式）。不要在測試裡把自己 Kit 的 `src/backend` 插進 `sys.path`（舊的測試有，保持相容，新測試不要這樣寫）。
3. **不連資料庫、不連網路。** 用假的資料庫工作階段（`execute` 依序回傳準備好的資料）、FastAPI 的 `TestClient` 加 `dependency_overrides`、或直接呼叫純函式。需要時間、環境變數用 `monkeypatch`。
4. **自給自足。** 需要的資料檔放在 `tests/fixtures/`（可從 `fixtures/` 複製並註明來源）。唯讀的 `config/` 會掛在 `/config`，其他倉庫路徑不可用。
5. **寫業務理由，不只寫行為。** 檔案開頭的說明和測試名稱要讓人看出「為什麼這件事重要」（例如「未知的方案不授予任何權益」），而不是「函式回傳空清單」。規則：測試如果在業務邏輯改變時不會失敗，就是錯的。
6. 每個 Kit 在獨立的程序裡執行（所有 Kit 的後端都叫 `app`），測試之間不要依賴執行順序。
7. 不要用 `skip` 隱藏失敗；跳過的測試會被記入安裝包的測試證明。

建議做變異檢查：故意把被測程式改壞（反向條件、改常數），確認至少有一個測試失敗；改了卻沒有測試失敗的，就是沒保護到。

本機執行（需要含鎖定相依的環境，開發機通常沒有；用發布流程的映像最準）：

```sh
docker run --rm --user 10001:10001 --tmpfs /tmp --env HOME=/tmp --env PYTHONPATH=/system/backend \
  -v "$PWD/kits:/kits:ro" -v "$PWD/config:/config:ro" --entrypoint sh <後端映像> -c \
  'pip install -q --user pytest==9.1.1 && cd /kits/<kit-id> && python -m pytest -q tests'
```

## 7. 現場自檢（自動，Kit 作者要知道它檢查什麼）

系統啟動時，後端的自檢會驗證下列各項，任何一項失敗，所有請求（`/healthz` 除外）都回 503，並指出 Kit 與原因；安裝引擎的 `apply` 會在啟動失敗時把這些原因帶進錯誤訊息：

| 檢查 | 失敗代表 |
|---|---|
| 安裝包完整性 | `backend/`、`kits/` 的檔案與簽章的清單不符（被改過、少了檔案） |
| 契約 | 契約讀不到，或宣告的 Kit 與安裝的不符 |
| 相依 | 某個 Kit 需要的能力沒有被選入的 Kit 提供 |
| 入口權限 | 權限目錄與契約宣告的入口不一致 |
| 路由 | 入口宣告的路由不存在，或存在的路由沒有被入口或 `adminRoutes` 涵蓋 |
| 資料庫 | 連不上、模型宣告的資料表不存在、預設租戶不存在 |

訊息只包含檔案、路由、資料表與能力的名稱，不含任何秘密值。自檢失敗時每 30 秒重新檢查一次，暫時性的資料庫問題恢復後系統自動繼續服務。

## 8. 手冊

手冊片段放在 `manuals/kits/<kit-id>/<版本>/`，分使用者、管理者（`mis`）與開發者三份，各有固定的六個章節與前言欄位（見 `schemas/manual.schema.json`）。內容來自實測：沒有實際操作過的步驟寫「尚未驗證」，不寫成已完成。`sources` 只能指向 `kits/` 或 `services/frontend/` 下的檔案。

## 9. 完成清單

- [ ] 決議記錄與專屬分支
- [ ] `kit.contract.json`：每條路由有入口或在 `adminRoutes`；提供與需要的能力一致
- [ ] `manifest.json`、`workflow.aov.json`、安裝腳本
- [ ] `config/kits/overlay.json` 與 `config/registry/<kit-id>.json`
- [ ] `tests/` 至少一個測試，通過，並做過變異檢查
- [ ] 組出含這個 Kit 的系統包（含發布閘門與測試證明）
- [ ] 在測試機安裝並實際操作，記錄結果
- [ ] 手冊片段（只寫實測過的內容）
- [ ] 沒有秘密值、真實資料；畫面是業務語言
