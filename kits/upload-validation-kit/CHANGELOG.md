# upload-validation-kit 變更紀錄

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
- 修改原因：初版建立（提交：feat(output): add kit workflow descriptions and selected-kit summary table (D100)）
- Kit 版本：c4b2b7b-ui.1　作者：yucheng384752　來源：git:d1b6d63

### 被修改的節點

| 節點名稱（node_name） | node_id | 動作 | 變化 |
| --- | --- | --- | --- |
| 查詢上傳狀態 | status | 新增 | 能力：upload.status.get |
| 上傳檔案 | upload | 新增 | 能力：upload.file.create |

### 連線變更

- 新增連線：「上傳檔案」→「查詢上傳狀態」

### 畫布：修改前

（尚無流程）

### 畫布：修改後

```mermaid
flowchart LR
  n_status["查詢上傳狀態"]:::add
  n_upload["上傳檔案"]:::add
  n_upload --> n_status
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
  "source": "git:d1b6d63",
  "cause": "initial",
  "reason": "初版建立（提交：feat(output): add kit workflow descriptions and selected-kit summary table (D100)）",
  "nodes": [
    {
      "op": "add",
      "nodeId": "status",
      "nodeName": "查詢上傳狀態",
      "after": {
        "id": "status",
        "name": "查詢上傳狀態",
        "subfeatureId": "csv-excel-upload-validation",
        "capabilityIds": [
          "upload.status.get"
        ]
      }
    },
    {
      "op": "add",
      "nodeId": "upload",
      "nodeName": "上傳檔案",
      "after": {
        "id": "upload",
        "name": "上傳檔案",
        "subfeatureId": "csv-excel-upload-validation",
        "capabilityIds": [
          "upload.file.create"
        ]
      }
    }
  ],
  "edges": [
    {
      "op": "add",
      "from": "upload",
      "to": "status"
    }
  ],
  "beforeSha": "a461bf77bc4e4d732f7afc121c70e7f70ed8bf225a082a4e01951d1eb6b5c278",
  "afterSha": "00ed7abada61b5301ba1ae48f1cd8e22e6893effa70501f02087493f05c45e07"
}
```

</details>
