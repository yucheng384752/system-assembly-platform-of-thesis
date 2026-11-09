# import-pipeline-kit 變更紀錄

本檔記錄這個 Kit 的作業流程（`workflow.aov.json`）每次修改了哪些節點、為什麼改、改前改後的畫布長什麼樣。
它由 `node scripts/kit-changelog.mjs` 產生，請不要手改；改了流程描述後執行 `add` 補一筆（見 `docs/kit-authoring.md`）。
測試會檢查：紀錄從空白依序重播後必須等於目前的流程描述，且本檔文字與機器可讀資料一致。

| 修改原因分類 | 意義 |
| --- | --- |
| initial | 初版：Kit 第一次建立流程描述 |
| new-feature | 新增功能：Kit 多了能力，流程跟著補節點 |
| align-runtime | 對齊實際行為：流程描述與實際程式行為不符，已修正 |
| wording | 用語調整：節點名稱改成更精確或更貼近業務的說法 |
| dependency | 前置關係：調整哪一步必須先完成哪一步 |
| granularity | 粒度調整：節點拆分、合併或移除重複 |
| verification-finding | 實測發現：在測試機實際操作後發現需要修改 |
| other | 其他：須在修改原因寫清楚 |

## #1　2026-10-18　initial

- 修改原因分類：初版：Kit 第一次建立流程描述
- 修改原因：初版建立（提交：feat(kits): add draft workflow descriptions for nine kits (D100)）
- Kit 版本：c4b2b7b-ui.1　作者：yucheng384752　來源：git:54e4c1b

### 被修改的節點

| 節點名稱（node_name） | node_id | 動作 | 變化 |
| --- | --- | --- | --- |
| 取消匯入 | cancel-job | 新增 | 能力：import.job.cancel |
| 提交匯入並保存結果 | commit-job | 新增 | 能力：db.import.jobs、import.job.commit |
| 從上傳工作建立匯入 | create-from-upload | 新增 | 能力：import.job.from_upload |
| 建立匯入工作 | create-job | 新增 | 能力：import.job.create |
| 查詢錯誤列 | get-errors | 新增 | 能力：import.job.errors |
| 查詢匯入狀態 | get-job | 新增 | 能力：import.job.get |

### 連線變更

- 新增連線：「從上傳工作建立匯入」→「查詢匯入狀態」
- 新增連線：「建立匯入工作」→「查詢匯入狀態」

### 畫布：修改前

（尚無流程）

### 畫布：修改後

```mermaid
flowchart LR
  n_cancel_job["取消匯入"]:::add
  n_commit_job["提交匯入並保存結果"]:::add
  n_create_from_upload["從上傳工作建立匯入"]:::add
  n_create_job["建立匯入工作"]:::add
  n_get_errors["查詢錯誤列"]:::add
  n_get_job["查詢匯入狀態"]:::add
  n_create_from_upload --> n_get_job
  n_create_job --> n_get_job
  classDef add fill:#d6f5dc,stroke:#2e7d32
  classDef remove fill:#fbd9d9,stroke:#c62828
  classDef edit fill:#fff3c4,stroke:#b58900
  classDef link fill:#dbe9ff,stroke:#1f5fbf
```

<details><summary>機器可讀資料</summary>

<!-- kit-changelog-entry -->
```json
{
  "seq": 1,
  "kitVersion": "c4b2b7b-ui.1",
  "date": "2026-10-18",
  "author": "yucheng384752",
  "source": "git:54e4c1b",
  "cause": "initial",
  "reason": "初版建立（提交：feat(kits): add draft workflow descriptions for nine kits (D100)）",
  "nodes": [
    {
      "op": "add",
      "nodeId": "cancel-job",
      "nodeName": "取消匯入",
      "after": {
        "id": "cancel-job",
        "name": "取消匯入",
        "subfeatureId": "cancel-import",
        "capabilityIds": [
          "import.job.cancel"
        ]
      }
    },
    {
      "op": "add",
      "nodeId": "commit-job",
      "nodeName": "提交匯入並保存結果",
      "after": {
        "id": "commit-job",
        "name": "提交匯入並保存結果",
        "subfeatureId": "commit-production-records",
        "capabilityIds": [
          "db.import.jobs",
          "import.job.commit"
        ]
      }
    },
    {
      "op": "add",
      "nodeId": "create-from-upload",
      "nodeName": "從上傳工作建立匯入",
      "after": {
        "id": "create-from-upload",
        "name": "從上傳工作建立匯入",
        "subfeatureId": "create-import-job-from-upload-job",
        "capabilityIds": [
          "import.job.from_upload"
        ]
      }
    },
    {
      "op": "add",
      "nodeId": "create-job",
      "nodeName": "建立匯入工作",
      "after": {
        "id": "create-job",
        "name": "建立匯入工作",
        "subfeatureId": "create-import-job",
        "capabilityIds": [
          "import.job.create"
        ]
      }
    },
    {
      "op": "add",
      "nodeId": "get-errors",
      "nodeName": "查詢錯誤列",
      "after": {
        "id": "get-errors",
        "name": "查詢錯誤列",
        "subfeatureId": "import-error-query",
        "capabilityIds": [
          "import.job.errors"
        ]
      }
    },
    {
      "op": "add",
      "nodeId": "get-job",
      "nodeName": "查詢匯入狀態",
      "after": {
        "id": "get-job",
        "name": "查詢匯入狀態",
        "capabilityIds": [
          "import.job.get"
        ]
      }
    }
  ],
  "edges": [
    {
      "op": "add",
      "from": "create-from-upload",
      "to": "get-job"
    },
    {
      "op": "add",
      "from": "create-job",
      "to": "get-job"
    }
  ],
  "beforeSha": "a461bf77bc4e4d732f7afc121c70e7f70ed8bf225a082a4e01951d1eb6b5c278",
  "afterSha": "18affc46442aa90737e670dd45877868d5151d0b1cf1851e355c5f400e5f2722"
}
```

</details>
