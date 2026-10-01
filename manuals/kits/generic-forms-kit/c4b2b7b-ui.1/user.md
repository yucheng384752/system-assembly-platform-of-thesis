---
kitId: generic-forms-kit
kitVersion: c4b2b7b-ui.1
role: user
status: draft
sources:
  - kits/generic-forms-kit/src/frontend/src/pages/FormsPage.tsx
  - kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py
---

## 用途

選擇表單、上傳資料並瀏覽紀錄；畫面也提供欄位定義。

## 前置條件

上傳前須已有表單與欄位定義。欄位定義儲存需要至少一個識別鍵及編輯原因。

## 可設定項目

可檢視欄位型別、必填與識別鍵標記。上傳預設不允許重複識別鍵；可切換「允許重複匯入」。

## 操作步驟

1. 從左側選擇表單。
2. 在「上傳資料」確認必填欄位與對應名稱。
3. 選擇或拖入 CSV 檔，確認是否允許重複匯入，再按「開始上傳」。
4. 查看匯入、跳過及錯誤筆數；切換「紀錄查詢」並按「重新整理」查看結果。

## 輸入輸出

輸入 CSV 檔。上傳結果列出匯入與跳過數量，錯誤按列顯示。紀錄清單顯示識別鍵、各欄位值與建立時間，每頁 50 筆。

## 常見錯誤與復原

缺少欄位定義時先完成定義；必填值缺漏時依錯誤列修正檔案。允許重複匯入可能新增相同識別鍵紀錄。刪除表單會刪除其紀錄；回復刪除的程序尚未提供。

