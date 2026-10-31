---
kitId: analytical-four-kit
kitVersion: 0.1.0
role: mis
status: draft
sources:
  - kits/analytical-four-kit/kit.contract.json
  - kits/analytical-four-kit/src/backend/app/api/routes_analytical_four.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/settings.py
  - kits/analytical-four-kit/src/backend/app/analytical_four/runs.py
---

## 用途

提供製造數據分析的後端介面：分析設定、就緒檢查、示範資料載入、背景執行分析與取得結果。分析引擎來自 Analytical-Four 專案（來源版本記錄在 Kit 的 SOURCE.md）。

## 前置條件

需選用「入口與使用權限」與「平台核心」。部署時依賴安裝包含 PyTorch 等大型套件，映像檔會明顯變大。資料目錄由環境變數 ANALYTICAL_FOUR_DATA_DIR 指定，未設定時為 /system/data/analytical-four，該路徑在系統包中屬於持久化資料卷。設定的所有路徑都限制在資料目錄內。

## 可設定項目

settings.json 位於資料目錄：layers（a、b、c）、mode（daily 或 complain）、analysisConfig（資料目錄內的相對路徑）、llm.endpoint、llm.timeoutSeconds、llm.apiKeyEnv。金鑰只存在環境變數，settings.json 與執行紀錄都不保存金鑰值。分析設定檔沿用 Analytical-Four 格式，路徑欄位一律相對於資料目錄。入口權限預設：檢視開放管理員、經理、操作員與稽核；啟動分析開放管理員、經理與操作員；調整設定與載入示範資料只開放管理員。

## 操作步驟

首次使用可由管理員載入示範資料，或以 python -m app.analytical_four.seed_demo 複製。接著檢查狀態、啟動分析、查詢執行狀態、取得結果。向量模型設為 intfloat/multilingual-e5-large-instruct 時，首次執行需能連到模型來源下載約數 GB 的檔案；封閉網路請改用 builtin-hash 或預先備妥模型快取。

## 輸入輸出

每次分析建立 runs/<執行編號>/，內含 status.json、settings.snapshot.json、衍生的分析設定與 results/ 結果檔。每日模式會覆寫分析設定中指定的不良特徵分布庫。向量庫寫在設定指定的資料夾。客訴模式會把事件資料送到 AI 語言模型服務位址。

## 常見錯誤與復原

409 表示尚有項目未就緒或另一次分析仍在執行；422 表示設定檔無法使用或內容不合法；404 表示找不到該次分析或結果檔。分析失敗不會自動重試。服務重新啟動時，未完成的分析會被標為失敗。這個 Kit 沒有資料庫表格，備份資料目錄即可。授權效果的測試目前標為未涵蓋。
