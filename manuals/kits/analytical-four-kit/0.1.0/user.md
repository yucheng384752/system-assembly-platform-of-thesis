---
kitId: analytical-four-kit
kitVersion: 0.1.0
role: user
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

分析製造數據：比對待分析資料與正常基準，找出超出範圍的量測與影響最大的特徵（A 層），推估可能的不良類型（B 層），再對應到製程位置、查詢 SOP 與過去案例，並由 AI 語言模型綜合出原因與處置建議（C 層）。三個層級可分別開關。

## 前置條件

需同時選用「入口與使用權限」功能。分析前要先備妥資料：待分析資料與正常基準；B 層需要不良代碼定義與不良特徵分布庫；C 層需要製程拓樸與 SOP 知識，客訴分析模式還需要歷史案例檔與 AI 語言模型服務位址。系統內附合成示範資料，可由管理員一鍵載入。目前只提供後端介面，沒有操作畫面。

## 可設定項目

管理員可調整：要啟用哪些層級（B、C 需要 A；客訴分析模式的 C 還需要 B）、分析模式（每日監控或客訴分析）、使用哪一份分析設定檔，以及 AI 語言模型服務的位址、逾時秒數與存放金鑰的環境變數名稱。位址留空表示尚未設定。事件資料會送到這個位址，只能填寫信任的服務。

## 操作步驟

先確認各層級是否就緒，缺什麼會逐項列出，再做資料檢查：檢查會指出資料檔的問題（缺欄位、文字混在數字欄、ID 重複、基準有空值等），並提醒會被悄悄改動的地方，例如含空值的列會被刪掉；不良代碼定義、製程拓樸、SOP 知識與案例檔也會檢查格式：缺必要欄位的檔案不會開始分析，被略過或變弱的地方會列為警告。有問題的資料不會開始分析。欄位名稱和系統預期的不同時，由管理員在設定裡填欄位對照。第一次導入新場域時，可先下載範本：導入需求表、欄位字典、欄位對照，以及各檔案的範例。通過後啟動分析。分析在背景進行，同時間只能有一次，可隨時查看每個階段的狀態。完成後取得結果檔。客訴分析的結果經現場確認後，可對每個事件提交實際的不良代碼與原因（也可匯入已確認的案例）；經理或管理員提交即生效，操作員提交須經理或管理員核可。核可後的回饋發布成案例庫的新版本，下一次分析的相似案例搜尋會用到。確認的代碼可以是新的代碼。每日監控模式會用當天的不良樣本更新不良特徵分布庫，客訴分析模式則用它推估不良類型；彙整、相似案例與 AI 診斷只在客訴分析模式執行。

## 輸入輸出

輸入為資料目錄內的資料檔與分析設定。輸出為每次分析一個資料夾：階段狀態與一組結果檔，包含基準統計、超界結果、相關性與主成分結果、每個事件的診斷、不良類型預測、製程位置對應與 SOP 檢索，客訴模式另有 AI 診斷回應。

## 常見錯誤與復原

啟動時若有項目未就緒，會直接列出原因而不是略過；分析中途失敗，會記錄失敗的階段與原因，已完成階段的結果檔仍可查看。服務重新啟動時，尚在執行的分析會標為失敗，請重新啟動。案例庫的舊版本都會保留，沒有回復舊版本的操作。不良特徵分布庫是空的時，客訴分析會停止並要求先用每日模式累積。使用內建的離線向量模型時，SOP 檢索只比對字詞，準確度低於正式的語意模型。
