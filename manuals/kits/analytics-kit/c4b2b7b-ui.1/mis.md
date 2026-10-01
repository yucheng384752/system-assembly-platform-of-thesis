---
kitId: analytics-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/analytics-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/analytics-kit/src/backend/app/api/routes_analytics.py
  - kits/analytics-kit/src/frontend/src/pages/AnalyticsPage.tsx
---

## 用途

提供上傳紀錄查詢、匯出及表單趨勢；畫面摘要與後端趨勢使用不同資料範圍。

## 前置條件

基線相依為系統基本功能、舊入口權限功能、站點資料串聯與檔案上傳驗證。

### 進階
manifest 要求 python，安裝順序為 70。

## 可設定項目

未宣告環境設定；趨勢日差上限 366 天、匯出上限 5000 筆為程式內固定值。修改上限的維護介面尚未提供。

## 操作步驟

核對表單、日期及統計範圍。畫面摘要每表只載入第一頁 200 筆；後端數值趨勢最多查詢 5000 筆，不能把摘要當成無上限的全量分析。

## 輸入輸出

上傳紀錄每頁 50 筆；匯出檔案含工作時間、識別、檔名、狀態及筆數。後端數值趨勢支援指定數值欄位，畫面未提供此選擇。

## 常見錯誤與復原

日期格式或範圍不符、指定非數值欄位會遭拒絕；表單不存在則查無對應。縮小匯出範圍可避開筆數上限；日誌位置與資料復原程序尚未提供。

