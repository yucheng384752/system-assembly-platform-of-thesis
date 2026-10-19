# 基線版參考檔（唯讀）

自基線版 `form-system-kit-composer` 原樣複製，只供閱讀與對照，不得修改，也不是預覽的執行來源。

| 檔案 | 基線來源 | 用途 |
|---|---|---|
| `requirements.baseline.txt` | `dist/generated-system/backend/requirements.txt` | 後端 Python 依賴的原始版本 |
| `baseline-main.py` | `dist/generated-system/backend/app/main.py` | 基線組裝後的 FastAPI 入口，用來了解路由註冊、啟動與資料表建立方式 |
| `backend_router_registry.py` | `assembly/backend-registry/backend_router_registry.py` | Kit 與路由模組的對應表 |
