---
kitId: audit-edit-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/audit-edit-kit/kit.contract.json
  - kits/audit-edit-kit/src/backend/app/api/routes_edit.py
  - kits/audit-edit-kit/src/backend/app/api/routes_audit_events.py
  - kits/audit-edit-kit/src/backend/app/models/audit.py
  - kits/audit-edit-kit/src/backend/app/models/core/edit_reason.py
  - kits/audit-edit-kit/src/backend/app/services/audit_events.py
---

## 用途

契約宣告 audit.events.list：GET /api/audit/events；records.edit：PATCH /api/edit/records/{table_code}/{record_id}；edit-reasons.list／create／update：GET、POST /api/edit/reasons 及 PATCH /api/edit/reasons/{reason_id}。現有來源含對應處理函式。

另宣告 db.audit.events、db.edit-reasons.validate，consumes 為 db.records.search；本 Kit 尚未提供可核對的 capability adapter。

## 前置條件

edit_record 直接引用 Station、StationSchema、GenericRecord，並從 app.api.routes_generic_forms 匯入 _coerce。缺少該模組會回傳 501；這是實作上的跨 Kit 相依，不能只依 consumes 判斷已解耦。

## 可設定項目

RecordEditIn 要求 reason_id 與非空 changes。ReasonCreateIn 包含 code、label；ReasonUpdateIn 只允許 label、is_active。EditReason 在每租戶內限制 code 唯一。

## 操作步驟

edit_record 驗證有效 schema、欄位型別及啟用中的原因，更新 GenericRecord.data，加入 RowEdit 的 before_json／after_json 後 commit。稽核事件查詢直接讀 AuditEvent；這與 RowEdit 修正紀錄是不同模型。

## 輸入輸出

修正回傳 id、table_code、changes、data。稽核查詢回傳 total、offset、limit、items；limit 預設 50、上限 500。write_audit_event_best_effort 另開工作階段保存事件，捕捉所有例外。

## 常見錯誤與復原

無效欄位、型別、必填值或原因回傳 422；表單／紀錄不存在回傳 404。原因寫入非管理者回傳 403；一般租戶管理者不能讀系統稽核事件。直接跨 Kit 匯入與 capability 宣告待整理；專用測試與復原程序尚未提供。

