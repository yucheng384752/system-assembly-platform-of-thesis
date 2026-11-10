# entry-permission-kit 認證審查表

狀態：Claude 驗證完成；待 user 人工覆核。認證只代表「建模與訓練可用」，不代表執行可用（D195）。

## 認證對象

| 項目 | 內容 |
|---|---|
| 檔案 | `kits/entry-permission-kit/workflow.aov.json` |
| SHA-256 | `23074c9b72418c3fb5f17a17c4e33eb0a7116f3bd3fd0b9072a117088954b3c2` |
| 來源 commit | 本分支 `9bdaf0f` 之上的工作樹（動作目錄 55 個，D203） |
| Kit 版本 | 0.1.0 |
| 狀態欄 | draft（是否改成 reviewed 由 user 決定） |

任何對上列檔案或 `config/actions.json` 的修改，都使本認證失效，需要重新審查。

## Claude 驗證結果

| 檢查 | 結果 |
|---|---|
| 流程規格與登錄一致（schema、子功能、能力皆已登錄、無循環） | 通過 |
| 轉成畫布（`kitWorkflowToCanvas`） | 通過，16 步、2 條連線 |
| 畫布完整性（`integrityErrors`） | 0 項 |
| 畫布待補項（`graphErrors`） | 0 項 |
| 下載再匯入的節點與動作標籤 | 相同 |
| 動作對應 | 16 步有對應動作，0 步無對應 |
| 專案檔轉換（`convertCanvas`） | 不適用（需要物料設定，Kit 流程描述軟體功能），未涵蓋 |
| 執行驗證 | 未涵蓋（流程仍是草稿） |

## 步驟標籤

標籤欄的「動作」是訓練時的正確答案；「無對應動作」是拒答類別的答案。

| # | 步驟 | 名稱 | 標籤 | 依據 | 前置 | 後續 | 覆核 |
|---|---|---|---|---|---|---|---|
| 1 | `login` | 登入 | `sign-in`（登入系統） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 2 | `get-me` | 查看自己的資料 | `manage-own-account`（管理自己的帳號） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 3 | `update-me` | 修改自己的顯示名稱 | `manage-own-account`（管理自己的帳號） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 4 | `change-password` | 變更自己的密碼 | `manage-own-account`（管理自己的帳號） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 5 | `list-entry-points` | 查看全部入口 | `view-entry-points`（查看入口目錄） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 6 | `my-entry-points` | 查看自己可用的入口 | `view-entry-points`（查看入口目錄） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 7 | `list-roles` | 查詢角色 | `manage-roles`（管理角色） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 8 | `create-role` | 建立角色 | `manage-roles`（管理角色） | 已驗證的 API 能力由此動作涵蓋 | 開始 | set-role-grants | [ ] |
| 9 | `update-role` | 修改角色 | `manage-roles`（管理角色） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 10 | `delete-role` | 刪除角色 | `manage-roles`（管理角色） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 11 | `set-role-grants` | 設定角色的入口授權 | `set-role-grants`（設定角色的入口授權） | 已驗證的 API 能力由此動作涵蓋 | create-role | 結束 | [ ] |
| 12 | `list-users` | 查詢使用者 | `manage-users`（管理使用者） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 13 | `create-user` | 建立使用者 | `manage-users`（管理使用者） | 已驗證的 API 能力由此動作涵蓋 | 開始 | set-user-overrides | [ ] |
| 14 | `update-user` | 修改使用者 | `manage-users`（管理使用者） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 15 | `reset-password` | 重設使用者密碼 | `reset-user-password`（重設使用者密碼） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 16 | `set-user-overrides` | 設定使用者的入口例外 | `set-user-overrides`（設定使用者的入口例外） | 已驗證的 API 能力由此動作涵蓋 | create-user | 結束 | [ ] |

## 連線

| # | 從 | 到 | 依據 | 覆核 |
|---|---|---|---|---|
| 1 | `create-role` | `set-role-grants` | scope 文字（作者依測試或程式寫明） | [ ] |
| 2 | `create-user` | `set-user-overrides` | scope 文字（作者依測試或程式寫明） | [ ] |

## 流程 scope（原文）

描述登入、個人資料、入口目錄、角色與授權、使用者管理。連線只畫需要前一步結果的前置：設定角色授權需有角色，設定使用者入口例外需有使用者。登入取得的憑證是其餘所有路由的共同條件，不逐條畫出。既有角色與使用者可直接使用，不強制先建立。入口層只決定可見性，舊的端點權限中介層仍可拒絕請求，實際可存取範圍為兩層交集。未涵蓋身分驗證以外的授權效果測試（標為未涵蓋）。尚未完成執行驗證。

## 限制

1. 新增的動作沒有宣告參數（D92 精神，避免預設值與 mock），所以「畫布待補項」少不代表不需要輸入；實際執行時的必填值尚未建模。
2. 連線依據是作者在 scope 文字寫明的前置，我沒有逐條重讀程式。
3. 沒有條件欄位可表達模式或角色差異。

## 簽核

| 項目 | 內容 |
|---|---|
| Claude 驗證 | 完成，日期 2026-11-10 |
| user 覆核 | 待填：覆核人、日期、是否通過、適用範圍（完整流程／僅局部節點） |
