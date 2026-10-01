---
kitId: import-pipeline-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/import-pipeline-kit/kit.contract.json
  - kits/import-pipeline-kit/src/backend/app/models/flow_trace.py
  - kits/import-pipeline-kit/src/backend/app/services/dataflow_orchestrator.py
---

## 用途

目前實作為 DataflowOrchestrator 維護 FlowRun、FlowKeyAlias、TraceChain、TraceChainStep。

### 契約宣告
import.job.create：POST /api/v2/import/jobs；import.job.from_upload：POST /api/v2/import/jobs/from-upload-job；import.job.get：GET /api/v2/import/jobs/{job_id}；import.job.errors：GET /api/v2/import/jobs/{job_id}/errors；import.job.commit：POST /api/v2/import/jobs/{job_id}/commit；另宣告 db.import.jobs。上述匯入 API 尚未提供可核對實作。

## 前置條件

consumes.db 宣告 db.tables.resolve、db.records.search。現有服務需要 AsyncSession，並引用租戶、匯入工作與匯入檔案模型。

## 可設定項目

FlowStepDef 包含 step_name、step_order、business_key、is_anchor、key_match_strategy、required。步驟表目前內嵌；外部設定介面尚未提供。

## 操作步驟

已提交步驟呼叫 record_step：先比對流程鍵，再查別名；起始步驟可建立流程，其餘無對應者回傳 waiting_for_mapping。成功後更新追溯步驟、重算摘要與狀態並 flush；服務本身未呼叫 commit。

## 輸入輸出

輸入 tenant_id、upload_batch_id、step、flow_key、row_hashes，可選 source_file_id 與 process_date；回傳 StepResult(status, flow_run_id, trace_uuid)。模型以 flow_run_id／trace_uuid 識別，雜湊用於比較，並非外鍵。

## 常見錯誤與復原

非起始步驟無對應時回傳 waiting_for_mapping；未知步驟名稱查詢回傳 None。擴充步驟需同步內嵌定義；自動補對應、交易復原及專用測試程序尚未提供。

