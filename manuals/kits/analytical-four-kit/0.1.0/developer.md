---
kitId: analytical-four-kit
kitVersion: 0.1.0
role: developer
status: draft
sources:
  - kits/analytical-four-kit/kit.contract.json
  - kits/analytical-four-kit/src/backend/app/api/routes_analytical_four.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/settings.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/runs.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/feedback.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/data_checks.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/templates_catalog.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/format_checks.py
---

## 用途

app/analytical_four/ 內含：engine（自 Analytical-Four 複製的分析程式，匯入路徑改為本 Kit 套件）、pipeline.py（原 main.py 的方法本體，加上階段方法）、settings.py（設定與就緒檢查）、runs.py（背景執行與執行紀錄）、offline_vectors.py（不需下載模型的向量建構器）、feedback.py（回饋、核可、案例庫版本）、data_checks.py（啟動前的資料檢查與欄位對照，不寫任何檔案）、format_checks.py（設定、不良代碼、拓樸、SOP、案例檔的格式檢查；案例紀錄驗證與回饋匯入共用）、templates_catalog.py 與 templates/（可下載的範本；範例檔取自 demo_data）、seed_demo.py 與 demo_data/。路由在 app/api/routes_analytical_four.py。

## 前置條件

測試需要 Python 3.10 以上，以及 pandas、scikit-learn、scipy、chromadb、sentence-transformers、fastapi、pytest。pandas 與 numpy 的版本由系統包既有的固定版本決定。引擎以 app.analytical_four.engine 為匯入根，從 kits/analytical-four-kit/src/backend 執行。

## 可設定項目

與原專案的差異集中在 pipeline.py 與 SOURCE.md 列出的幾處：資料管理器失敗時丟出 PipelineError、輸出檔寫入失敗時丟出例外、LLM 呼叫加逾時與狀態檢查、每日模式把分布庫寫到設定的路徑而不是工作目錄。引擎其餘部分未改，其中部分錯誤仍由引擎自己記錄後略過（例如序列化器把單一事件的失敗寫進事件內，已由 diagnostic_stage 檢查並升為錯誤）。

## 操作步驟

階段順序與 AoV 一致：read-data、descriptive、diagnostic、ng-code、topology、rag、compile、search-key、similarity、llm。新增階段時同步更新 runs.py 的 STAGES、workflow.aov.json 與 config/registry 的函式鏈。重新產生示範資料：python kits/analytical-four-kit/demo/generate_demo.py，之後以每日模式跑一次並把 known_base.json 複製回 demo_data。

## 輸入輸出

所有路由回傳 JSON，身分取自入口權限中介層設定的 request.state，沒有則回 401。執行紀錄結構見 docs/analytical-four-kit.md。回饋與核可只追加；案例紀錄格式取自相似案例搜尋實際讀取的欄位，格式與規則見 docs/analytical-four-kit.md 第 8 節。結果檔名稱只能取自 results/ 內實際存在的清單，不接受路徑。

## 常見錯誤與復原

引擎的 UT 序列化器與不良診斷以欄位名稱讀取資料（例如 P3.NG_code、Slitting machine），分析設定要沿用這些名稱。原引擎只用知識筆數判斷向量庫要不要重建，且以固定編號加入；變更知識檔後，請刪除向量庫資料夾再執行，才能確保內容更新。引擎的不良診斷會輸出大量 print，不影響結果。
