# 論文案例：Analytical-Four 使用 AoV 前後

契約：`docs/thesis-aov-case.md`。決議：D200、D201。分支：`feature/thesis-aov-case`。

## 批一：Kit 量測腳本

### Claude Handoff

做契約第 4 節。只新增 `kits/analytical-four-kit/tools/measure_kit.py` 與 `kits/analytical-four-kit/tests/test_measure_kit.py`，不改 4.1 列的禁改檔案、不新增依賴、不 git 寫入。完成後把摘要寫在下面的 Codex Notes：做了什麼、跑了哪些測試與結果、做不到的與原因。Kit 測試需要 pandas、chromadb、sentence-transformers、fastapi，你的沙箱可能跑不了，跑不了就明說，不要假裝通過；統計函式等純邏輯的測試請寫成不依賴這些重套件。

### Codex Notes

（待填）
