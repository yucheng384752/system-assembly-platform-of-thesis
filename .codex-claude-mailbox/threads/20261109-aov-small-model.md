---
id: "20261109-aov-small-model"
title: "AoV 小模型：節點動作與物料型別對應、連線與資料傳輸合理性檢查與建議"
status: "in_progress"
owner: "claude"
reviewer: "user"
priority: "medium"
created_by: "claude"
created_at: "2026-11-09"
updated_at: "2026-11-09"
---

# 目的

user 2026-11-09 的要求：訓練一個小模型，用於 AoV。
1. 任務：(a) 判斷節點應對應哪個動作或物料型別；(b) 合理性檢查與建議。
2. 驗證用途：驗證各節點的連接與資料傳輸是否符合規定，並提醒有錯誤的部分。
3. 訓練資料：現有 AoV，且必須先認證為可用才可訓練。
4. 環境：本機訓練，RTX 5070 Ti 16 GB；框架不限；不得使用中國來源的模型。
5. 論文：比較 analytical-four 使用 AoV 前後。
6. 分支：從 main 開 `feature/aov-small-model`，用獨立 worktree `composer-refactor-model-wt`。

# 已查證的事實（開分支時）

- 13 份 Kit 流程 `workflow.aov.json` 全部是 `status: draft`（D185 實測：101 步只有 30 步能對應 17 個動作，匯入畫布 13 份全被拒）。依 user 的條件「認證可用才訓練」，目前合格訓練資料為 0 份。
- 既有規則版驗證在 `libs/aov-core/validate/validator.ts`（531 行，規則碼 S0-S6、R1-R8、E1-E5、G1），這就是「規則版基線」，小模型必須與它比較才有論文價值。
- 本機環境：RTX 5070 Ti 16 GB、Python 3.13.15、未安裝 torch。新增依賴須 user 核准。
- 決議 D190 已預告以 HMM 學習 CHANGELOG 的修改紀錄（隱性知識轉顯性規則）。本任務若也學流程，需與 D190 切開界線，不可混用。

# 開放問題（待 user / Codex）

1. 「認證為可用」的標準由誰定、怎麼定？
2. 資料量遠小於一般訓練需求，需決定用合成變異資料還是少量微調。
3. 小模型的「合理性檢查」與規則版的分工。
4. 非中國模型清單。

# 決議編號

main 最新 D190，aov-standalone-canvas 分支到 D189；本任務取 D191 起，取號前再看 main。

# user 回覆（2026-11-09）

1. 「認證為可用」= Claude 驗證 + user 人工覆核，兩者都過才算。
2. 資料不足時，先把現有 Kit 流程補到可用；補完仍不足才用變異資料。

# 影響與待釐清

- Kit 流程轉畫布與專案檔轉換（D185 至 D189）在 `feature/aov-standalone-canvas`，尚未合併到 main，本分支目前沒有這些程式。補 Kit 流程的驗證依賴它，需決定等它合併，或本分支在其合併後再接。
- 「Claude 驗證」的具體檢查項目待與 Codex 討論結果一起定稿。

# Codex 討論結論與 user 決定（2026-11-09）

結論與決定已整理到 `docs/aov-small-model.md`，決議 D194 至 D198。user 決定：認證單位含完整流程、局部節點、子流程；先補 Kit 再用變異資料；先做傳統基線加 encoder；非中國只看開發機構；依賴核准（torch、transformers、scikit-learn、權重）；論文凍結 analytical-four 最新版。拒答政策為 Claude 建議，待 user 確認。

# 阻塞（90 回覆）

aov-standalone-canvas 無合併日期（合併由 user 決定）。`kitWorkflowToCanvas` 在該分支 de0084b，`convertCanvas` 已在 main 的 `libs/aov-integration`，`projectToCanvas` 要等其批三。可唯讀 `git show` 該分支；cherry-pick 前須先告知 90。

# 編號

本任務 D194 至 D198；9e 被請求從 D199 起，待其確認。
