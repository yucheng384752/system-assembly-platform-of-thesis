# Codex-Claude Mailbox Index

| ID | Title | Status | Owner | Reviewer | Updated |
| --- | --- | --- | --- | --- | --- |
| [20260927-kit-tab-ui-flow](threads/20260927-kit-tab-ui-flow.md) | Kit 分頁、動態預覽與可修改項目流程 | completed | user | claude | 2026-09-30 |
| [20260930-frontend-pages](threads/20260930-frontend-pages.md) | 依基線四步驟重做 Composer 前端頁面（真實 Kit、無障礙） | completed | user | claude | 2026-09-30 |
| [20260930-ui-design](threads/20260930-ui-design.md) | 汽車選配式介面改版與 G01–G08 處理 | waiting_for_user | user | claude | 2026-09-30 |
| [20260930-install-package](threads/20260930-install-package.md) | 設定交付包壓縮檔（D31–D36） | completed | user | user | 2026-09-30 |
| [20261001-security-hardening](threads/20261001-security-hardening.md) | 安全強化：防篡改、單機授權與通訊（D37–D45） | completed | user | user | 2026-10-01 |
| [20261001-node-typecheck-ci](threads/20261001-node-typecheck-ci.md) | Node 腳本納入 typecheck（D47；CI 跳過） | completed | user | user | 2026-10-01 |
| [20261001-kit-manuals](threads/20261001-kit-manuals.md) | Kit 動態操作手冊（D48–D53） | completed | user | user | 2026-10-01 |
| [20261001-site-profile](threads/20261001-site-profile.md) | Site Profile：匯入、解析層、硬性限制與設定交付包（D54–D60） | completed | user | user | 2026-10-01 |
| [20261002-workflow-graph](threads/20261002-workflow-graph.md) | 畫布式 AoV Workflow：圖形文件模型（功能 1）與畫布編輯器（功能 2） | in_progress | claude | user | 2026-10-02 |

本目錄為本專案專用的非同步交接區。threads 保存完整討論；inbox、outbox、archive 分別保留收件、寄件與封存位置。Claude 審閱已完成，user 已核准開發；Codex 依 thread 的「Claude Handoff」工作包 WP0–WP6 實作；git 操作改由 Claude 執行。

2026-09-27 Codex 續作：WP0 骨架完成，依賴安裝、build、typecheck、test（1 test）通過；初次測試設定載入失敗已以 native loader 修正。WP1 前依「新增表外依賴」停止條件等待 user 核准 Ajv／jsdom，WP1–WP6 未開始；完整檔案清單、失敗／略過紀錄與建議提交訊息見 thread。

2026-09-27 Codex：WP0 受阻；git init 成功，但 git add 因 .git/index.lock 寫入權限被拒絕。待 user 調整 .git 權限或完成必要 Git 前置作業；WP1–WP6 未開始，詳見 thread Codex Notes 與 Open Questions。

2026-09-27 Claude：WP0 的 Git 阻礙已解決（重新 init、.gitignore、基準 commit、feature/kit-tab-ui 分支由 Claude 完成）；git 寫入操作改由 Claude 執行，Codex 從 WP0 剩餘的 Vite 骨架接續。

2026-09-27 Claude：WP0 已驗證並提交（f952801）；user 核准 ajv、jsdom，Codex 從 WP1 繼續。

2026-09-27 Codex：已確認 feature/kit-tab-ui 與 HEAD f952801；ajv／jsdom 核准仍有效。本次環境可寫範圍僅 mailbox，專案根目錄不可寫，依 Handoff 停止 WP1；未安裝依賴、未實作 WP1–WP6。待專案根目錄納入可寫工作區，詳見 thread 最新 Codex Notes 與 Open Questions。

2026-09-27 Claude：前次 Codex 啟動時工作目錄誤設為 mailbox，導致只能寫入 mailbox；已改由專案根目錄重新啟動。

2026-09-27 Codex 最新續作：工作區可寫範圍已修正；npm.cmd 安裝 ajv@8.17.1 的 registry 請求失敗（EACCES，exit 1），另有 cache 日誌不可寫訊息。依 Handoff 停止 WP1，jsdom 未安裝、WP1–WP6 未完成；package.json／package-lock.json 無差異。待可存取 registry 的環境或本機安裝完成後續作，詳見 thread 最新 Codex Notes 與 Open Questions。

2026-09-29 Claude：依賴改由 Claude 安裝（ajv、jsdom，並修補 vite／vitest 漏洞版本）；Codex 從 WP1 繼續。


2026-09-29 Codex：WP1 完成，typecheck 與 schema 3 tests 通過；進行 WP2。

2026-09-29 Codex 最新狀態：WP1–WP3 完成；WP4 已實作且自動化檢查通過，但 Vite localhost 監聽回報 EACCES、無可用瀏覽器，無法達成 Network 驗證條件，依 Handoff 停止。WP5–WP6 未開始；status=in_progress、owner=user，完整結果及建議提交訊息見 thread。

2026-09-29 Claude：WP1–WP4 審閱並提交，WP4 瀏覽器驗證通過；Codex 從 WP5 繼續。

2026-09-29 Codex：WP5／WP6 完成，R01／R02 已處理，R03／R04 延後理由已寫入 Codex Notes。12 tests passed／1 authorization test skipped，build／typecheck 通過。交回 Claude 審閱、真實瀏覽器驗證、Obsidian 同步與 Git 提交；status=ready_for_claude、owner=claude。

2026-09-29 Claude：WP5–WP6 驗收通過，WP0–WP6 全部完成並提交；待 user 決定 Obsidian 同步、Vitest 升級與合併。

2026-09-30 Claude：20260927-kit-tab-ui-flow 已合併至 main，標為 completed；新增 20260930-frontend-pages，交由 Codex 實作 FP1–FP6。

2026-09-30 Claude：FP1–FP6 審閱與瀏覽器驗證通過並提交；非阻擋發現 G01–G08 待 user 決定是否處理。

2026-09-30 Claude：20260930-frontend-pages 已合併至 main，標為 completed；新增 20260930-ui-design，完成功能選配三欄改版與 G01–G06、G08，G07 經確認無須修改；待 user 決定是否合併。

2026-09-30 Claude：docs/aov-workflow-spec（含 20260930-ui-design）已合併至 main；新增 20260930-aov-workflow-forms，完成 Workflow v2、多檔上傳、表單關聯與五步驟介面（D22–D30）；待 user 審閱與決定是否合併。

2026-09-30 Claude：20260930-aov-workflow-forms 已合併至 main（3e50de4），標為 completed。

2026-09-30 Claude：新增 20260930-install-package，完成設定交付包壓縮檔（自寫 store zip、package-manifest.json、驗證報告，D31–D36）；待 user 審閱與決定是否合併。

2026-09-30 Claude：20260930-install-package 已合併至 main（ec25bd6），標為 completed。

2026-10-01 Claude：新增 20261001-security-hardening，完成簽章與授權工具、license.py 移除 TPM 改以機器識別綁定，以及資料庫通訊規格（D37–D45）；待 user 審閱與決定是否合併。

2026-10-01 Claude：20261001-security-hardening 補上 D46（預設內網、保留 HTTPS 方案比較）與 Linux 實測（192.168.200.63，Ubuntu 22.04，8 項通過）。

2026-10-01 Claude：20261001-security-hardening 補上 Linux 上 Node 工具與 Docker 唯讀掛載 machine-id 的實測；Linux 端無未測項目，待 user 審閱與決定是否合併。

2026-10-01 Claude：20261001-security-hardening 已合併至 main（8ae2972），標為 completed。

2026-10-01 Claude：新增 20261001-node-typecheck-ci，`@types/node` 與 Node 腳本 typecheck 完成（D47）；CI 平台待 user 確認。

2026-10-01 Claude：20261001-node-typecheck-ci 依 user 決定跳過 CI，只含 typecheck 部分，待 user 決定是否合併。

2026-10-01 Claude：20261001-node-typecheck-ci 已合併至 main，標為 completed。

2026-10-01 Claude：新增 20261001-kit-manuals，決策 D48–D52、`schemas/manual.schema.json` 與工作包 WP1–WP5 已寫入，交由 Codex 實作（12 個 Kit 三份手冊、組裝器、接上設定交付包）。

2026-10-01 Codex：Kit 手冊 WP1、WP2 與 WP3 第一批 9 份完成；第二批發現查詢 API 契約與來源不一致，依停止條件交回 Claude。完整測試 63 passed、5 failed、1 skipped；typecheck/build 通過；test:kits 因既有 Python 路徑失效未啟動。WP4／WP5 未完成，詳見 thread。

2026-10-01 Codex 依 D53 續作：WP3 36 份 draft 齊全、WP4 交付包與畫面整合完成；WP5 片段檢查 6 passed、0 skipped，typecheck/build 通過。完整測試 71 passed、1 skipped，另 1 項 security CLI 為已知沙箱 EPERM；待 Claude 以最新交付包做沙箱外與瀏覽器驗證、人工審閱。來源差異與各 WP 提交建議見 thread，status=ready_for_claude。

2026-10-01 Claude：20261001-kit-manuals 審閱與驗證完成（36 份 draft 手冊、組裝器、接上設定交付包）；待 user 審閱手冊並決定是否合併。

2026-10-01 Claude：20261001-kit-manuals 已合併至 main，標為 completed。

2026-10-01 Claude：新增 20261001-site-profile，決策 D54–D60、`schemas/site-profile.schema.json` 與工作包 WP1–WP6 已寫入，交由 Codex 實作。

2026-10-01 Codex：Site Profile WP1–WP5 實作及 WP6 自動化驗證完成；typecheck/build 通過；完整測試 104 passed、1 failed（已知 security CLI EPERM）、1 skipped（既有身分授權）。test:kits 因已知 Python 路徑失效未啟動。待 Claude 沙箱外安全／Kit 測試、真實瀏覽器驗證、審閱與 Git 提交；兩個 security 暫存目錄與每個 WP 的完整結果見 thread，status=ready_for_claude。

2026-10-01 Claude：20261001-site-profile 審閱與驗證完成（匯入式場域設定、Site 解析層與鎖定、限制、交付包）；待 user 審閱並決定是否合併。

2026-10-01 Claude：20261001-site-profile 人工驗證通過並合併至 main，標為 completed。
