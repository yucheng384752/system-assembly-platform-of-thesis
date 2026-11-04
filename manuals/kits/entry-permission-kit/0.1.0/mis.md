---
kitId: entry-permission-kit
kitVersion: 0.1.0
role: mis
status: draft
sources:
  - kits/entry-permission-kit/src/backend/app/entry_permission/middleware.py
  - kits/entry-permission-kit/src/backend/app/entry_permission/lockout.py
  - kits/entry-permission-kit/src/backend/app/entry_permission/passwords.py
  - kits/entry-permission-kit/src/backend/app/entry_permission/create_admin.py
---

## 用途

提供帳號登入、角色與權限檢查，取代已廢除的舊入口權限功能。實測已能登入、依角色放行或拒絕，不再只是設定。

## 前置條件

相依系統基本功能。安裝輸入檔需提供 ENTRY_PERMISSION_JWT_SECRET（登入憑證的簽章金鑰）與預設租戶代號，以及第一個管理員的帳號與密碼。

## 可設定項目

預設四個內建角色：admin、manager、operator、audit。各功能開放給哪些角色，由各功能的入口宣告決定，並在權限設定中調整。密碼規則為超過 8 個字元；連續輸錯 5 次鎖定 15 分鐘（依程式設定）。

## 操作步驟

1. 安裝完成後以安裝時設定的管理員登入，系統會要求先變更密碼。
2. 目前沒有管理使用者的畫面，管理員以介面呼叫建立使用者與指派角色：建立使用者（POST /api/users）、列出角色（GET /api/roles）。新建帳號首次登入同樣須變更密碼。
3. 驗收時至少確認三件事：沒有憑證存取會得到 401；操作員建立表單會得到 403；管理員可正常操作。

## 輸入輸出

登入為 POST /api/auth/login，成功回傳存取憑證；變更密碼為 POST /api/auth/change-password。

### 進階
權限判斷分兩層：入口權限中介層與各端點自己的檢查，實際生效的是兩者的交集。因此入口宣告放行但端點限制更嚴時，仍會被拒絕。已知例子：稽核事件查詢，入口宣告管理員、經理、稽核可讀，端點只允許系統管理員，結果稽核與經理角色一律 403。這項不一致待決定以哪一邊為準。

## 常見錯誤與復原

- 登入失敗訊息不區分密碼錯誤與帳號鎖定。鎖定期間過後可再試，或由管理員處理。
- 角色被拒絕時前端沒有提示，使用者只會看到按了沒反應；請管理員從角色與入口宣告兩處檢查。
- 忘記密碼的重設程序與帳號停用後的復原程序，本次未驗證。
