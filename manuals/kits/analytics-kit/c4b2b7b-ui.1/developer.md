---
kitId: analytics-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/analytics-kit/kit.contract.json
  - kits/analytics-kit/src/backend/app/api/routes_analytics.py
  - kits/analytics-kit/src/frontend/src/pages/AnalyticsPage.tsx
---

## 用途

契約與目前路由均提供 analytics.upload-history.list（GET /api/analytics/upload-history）、analytics.upload-history.export（GET /api/analytics/upload-history/export）、analytics.trend（GET /api/analytics/trend）。

## 前置條件

consumes.db 宣告 db.records.search、db.forms.list、db.upload.jobs.list、db.records.trend；後端透過 DB_CAPABILITIES 呼叫，使用目前租戶與 AsyncSession。

## 可設定項目

trend 參數為 code、field、date_from、date_to、granularity；粒度限 day／week／month。未指定日期時為今日往前 29 天；MAX_RANGE_DAYS=366，EXPORT_LIMIT=5000。

## 操作步驟

先取得表單定義，再查每日筆數；若有 field，驗證型別為數值後讀取最多 5000 筆資料計算 sum／avg；週與月再合併每日 buckets。AnalyticsPage 的 field 選擇尚未提供；它只畫筆數趨勢。

## 輸入輸出

trend 回傳 granularity、field、buckets（bucket_start、count、sum、avg）。歷史查詢轉交 db.upload.jobs.list；匯出為含 BOM 的 UTF-8 CSV。畫面摘要只以每表第一頁 200 筆作計算。

## 常見錯誤與復原

不合法日期、非數值欄位或過量匯出回傳 422；表單不存在回傳 404。擴充須維持 capability 介面並核對統計上限；專用測試程序尚未提供。

