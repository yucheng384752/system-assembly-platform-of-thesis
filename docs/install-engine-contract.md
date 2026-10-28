---
title: 客機安裝引擎與精靈的介面契約
date: 2026-10-20
status: D126 為正式決議；2026-10-25 依 D129 至 D133、D136、D137 修訂，修訂部分待 user 審閱；實作中，未實機驗證
---

# 客機安裝引擎與精靈的介面契約

對應 `TODO.md` 第 8 項。目的：讓命令列與精靈共用同一個引擎，兩者行為一致，且契約可獨立測試。

## 1. 已確認的前提

- 客機為 Ubuntu 22.04 LTS，預設為品牌實體機，不一定有 TPM；安裝時可連網；現場由 MIS 與工程師操作（2026-10-20）。
- 以壓縮安裝包交付，放在工程師的 USB；引擎本體為 Python，入口與前置檢查為 POSIX sh（2026-10-20，D131）。
- 部署為 Docker Compose：後端、PostgreSQL 16、反向代理、guard 以容器執行；Docker 使用 Ubuntu 套件庫的 `docker.io` 與 `docker-compose-v2`，客機不加第三方 apt 來源（D126、D133）。
- 工程師啟動前必須手動以客機的 `sha256sum` 核對 `install.sh` 與根公鑰，與操作手冊比對，一致才執行（D131）。這兩個值是檔案位元組的 sha256（`sha256sum install.sh root-public.pem` 的輸出），不是公鑰的 SPKI 指紋；精靈另要求輸入 SPKI DER sha256 的前 8 碼確認（D140）。引擎不代做這一步。
- 啟動方式：在終端機執行一次啟動指令（例如 `bash install.sh --wizard`），之後的操作都在網頁。
- 精靈不能做命令列做不到的事；精靈是引擎之上的一層，以子程序呼叫引擎，不 import 引擎。
- 精靈的網頁伺服器以一般使用者執行，只開在 127.0.0.1；需要權限時才索取 sudo 密碼。
- 安裝開始後，關閉瀏覽器或斷線不中斷安裝；重新開啟精靈可接回進度。
- 使用者可以還原安裝進度（見第 5 節）。

## 2. 子命令

| 子命令 | 權限 | 作用 | 輸出 |
|---|---|---|---|
| `detect` | 一般使用者 | 環境偵測、連網檢查，並計算硬體指紋與各來源的有效性（D129），唯讀 | 事件流，結果檔 `detect.json` |
| `verify` | 一般使用者 | 驗證安裝包：根公鑰指紋、`tar.gz` 簽章與 sha256、manifest 各檔 sha256；已有授權時一併驗授權鏈與 manifest 雜湊（D130、D132），唯讀 | 事件流 |
| `issue-license` | 一般使用者 | 以 USB 的加密子金鑰與憑證，在記憶體中簽出綁定該機器指紋與已驗證 manifest 雜湊的授權（D130）；用完即清 | 事件流，授權檔 |
| `plan` | 一般使用者 | 產生 `plan.json` 並算出 `planSha256` | `plan.json` |
| `apply` | 特權步驟用 sudo | 依計畫執行 | 事件流，更新 `state.json` |
| `status` | 一般使用者 | 讀取目前狀態與事件 | JSON |
| `cancel` | 一般使用者 | 要求在目前步驟結束後停止（不在步驟中途強制中斷） | JSON |
| `rollback` | 特權步驟用 sudo | 還原到指定完成點或全部 | 事件流 |

共通規則：
- 所有命令加 `--json` 時，標準輸出每行一個 JSON（JSON Lines）；不加時輸出人類可讀文字，內容相同。
- 同一時間只允許一個會改變系統的命令（`apply`、`rollback`），以鎖檔保證；第二個直接拒絕並指出誰持有。
- 秘密值（資料庫密碼、初始管理員密碼、sudo 密碼、子金鑰密碼）不放在參數、事件、log 或 `plan.json`。計畫只記 `secretRef` 名稱；實際值由輸入通道提供（第 4 節）。
- 流程順序為 `detect`、`verify`（安裝包）、`issue-license`、`verify`（含授權）、`plan`、確認、`apply`。授權在現場簽發，所以不能先有授權再驗證。

## 3. 計畫檔 `plan.json`

```json
{
  "format": "composer-install-plan",
  "version": 1,
  "package": { "manifestSha256": "…", "systemVersion": "2.0.0" },
  "target": { "os": "ubuntu-22.04", "installDir": "/opt/<system-id>-2.0.0" },
  "steps": [
    {
      "id": "docker-ensure",
      "title": "安裝缺少的 Docker 元件",
      "privileged": true,
      "reversible": "partial",
      "params": { "packages": [
        { "name": "docker.io", "version": "（實際解析出的版本）" },
        { "name": "docker-compose-v2", "version": "（實際解析出的版本）" }
      ] },
      "undo": "只在本次安裝了 Docker 且主機上沒有其他容器、映像、卷時才移除；否則保留並列出"
    }
  ],
  "migration": { "planSha256": "（docs/migration-example.md 的計畫書）" },
  "planSha256": "（以上內容去除本欄位後的正規化 JSON 的 SHA-256）"
}
```

`steps` 的標準順序（`id`）：`docker-ensure`、`trust-store`（首次安裝寫入根公鑰到 `/etc/<system-id>/trust/`）、`images-load`、`network-volumes`、`env-secrets`、`db-init`、`migration`、`compose-up`、`license-install`、`guard-up`、`health-check`。各步驟的內容見 `TODO.md` 第 8 項的引擎步驟。

- `reversible`：`yes`（可完整還原）、`partial`（部分還原，說明限制）、`no`（不可逆，必須在計畫畫面明確標示，並要求額外確認）。
- 確認動作綁定 `planSha256`。`apply --plan plan.json --plan-sha256 <值>` 在檔案內容與雜湊不符時拒絕執行。

## 4. 輸入通道

計畫之外的輸入（連線帳密、初始管理員帳號、連接埠、子金鑰密碼、授權到期日等）以 JSON 經標準輸入傳入，或由權限 0600 的暫存檔提供，用完立即刪除。不得出現在指令列。sudo 密碼沿用基線版做法：只經標準輸入傳給 `sudo -S`，不寫 log 或磁碟，用完立即清除。命令列模式直接使用 sudo 的密碼提示。

子金鑰檔與憑證檔從工程師插在客機的 USB 讀入，路徑不是秘密，以 `--subkey`、`--certificate` 傳入命令列（D140）；密碼由工程師在精靈輸入，只經標準輸入傳給 `issue-license`，不寫磁碟、事件或日誌。資料庫與後端的秘密值由引擎寫入安裝目錄的 `.env`（權限 0600，不進命令列、事件、log、`plan.json`），供 Compose 讀取；目前 WP3a 的部署檔與正式入口以容器環境變數接收，所以 `docker inspect` 對 root 與 docker 群組仍看得到，這是 WP3e 完成前的已知限制（D138 的改讀檔在 WP3e）。

## 5. 事件、狀態與還原

事件（`events.jsonl`，一行一筆）：

```json
{ "seq": 12, "ts": "（執行時間）", "step": "images-load", "status": "progress",
  "message": "正在載入映像", "undoable": true }
```

`status`：`started`、`progress`、`ok`、`warn`、`failed`、`cancelled`、`rolled-back`。事件寫入前先遮蔽秘密值。

狀態（`state.json`）記錄每一步的狀態、開始與結束、`undo` 所需的資訊（例如本次建立了哪些容器、網路、具名卷與映像、備份檔位置）。精靈重新連線時讀取 `state.json` 與 `events.jsonl` 即可還原畫面。狀態目錄預設為 `/var/lib/<system-id>/install/`，不含秘密值，使用者可讀。

本次安裝建立的容器、網路、具名卷帶標籤 `com.composer.install-id=<id>`（由引擎產生的 Compose 覆寫檔加入，並使用以 install-id 命名的 Compose 專案），還原與升級只處理帶此標籤的物件。映像不加標籤（label 是不可變映像設定的一部分，加了會改變映像身分，與簽章 manifest 記錄的 image ID 不符）；映像所有權改由 `state.json` 記錄：載入前是否已存在、載入後的 image ID。還原只刪除本次新增、且沒有其他容器使用的映像。

還原語意：
1. 還原到某個完成點，或全部還原。還原前先產生「還原計畫」，確認動作同樣綁定其雜湊。
2. 若 `apply` 正在執行，先 `cancel`（跑完目前步驟才停），再還原。
3. 每個步驟的還原行為：

| 步驟 | 還原 |
|---|---|
| `docker-ensure`（apt 安裝 Docker 元件） | 只在本次安裝了 Docker 且主機上沒有其他容器、映像、卷時移除；否則保留並列出 |
| `trust-store` | 移除本次寫入的根公鑰；原本已存在的不動 |
| `images-load` | 只移除 `state.json` 記錄為本次新增（載入前不存在）、且沒有其他容器使用的映像 |
| `network-volumes`、`compose-up`、`guard-up` | 移除帶本次標籤的容器與網路；具名卷中，資料庫卷若已有依新版寫入的資料，不刪除，列為需人工處理並提示改用備份 |
| `env-secrets`、安裝目錄、設定檔 | 移除，且只移除本次新增的 |
| `db-init` | 只在由安裝程式建立且仍為空時刪除；否則保留並列出 |
| `migration` | 用安裝前備份還原；若已有依新版寫入的資料，拒絕腳本式還原並提示改用備份（見 `docs/migration-example.md` 第 6 節） |
| `license-install` | 移除本次寫入的授權檔；升級時改回備份的舊授權（D132） |

4. 不可逆的部分不假裝還原；還原報告逐項列出已還原、保留與需人工處理的項目。
5. 還原本身失敗時，保留現場並回報需人工處理的項目，不再自動重試。

## 6. 退出碼

| 碼 | 意義 |
|---|---|
| 0 | 成功 |
| 10 | 環境檢查未通過（版本、權限、磁碟、連網、universe 未啟用） |
| 11 | 驗證失敗（簽章、sha256、授權鏈、manifest 雜湊） |
| 12 | 計畫雜湊不符 |
| 13 | 步驟失敗，已還原到上一個完成點 |
| 14 | 步驟失敗，且還原也失敗，需人工處理 |
| 15 | 已被使用者取消 |
| 16 | 另一個命令正在執行（鎖檔） |
| 17 | 授權簽發失敗（子金鑰密碼錯誤、憑證過期或客戶識別碼不符、可用指紋來源少於 3 項） |

## 7. 精靈

- 啟動時在終端機印出網址與一次性權杖；網址含權杖，請求檢查 `Host` 標頭與權杖，防止其他網站透過 DNS rebinding 操作本機精靈。
- 每個畫面操作對應一個子命令，不另有專屬邏輯。畫面順序：環境偵測（含指紋來源有效性）→ 驗證安裝包（提示已完成手冊核對，並輸入公鑰指紋前 8 碼）→ 上傳子金鑰並輸入密碼、簽發授權 → 輸入設定 → 檢視計畫（標示不可逆項目）→ 確認 → 安裝進度 → 驗證報告；任何時候可看到還原入口。
- 文字以純文字呈現，不用 `innerHTML`（安全基準線）。

## 8. 待決與未驗證

- 引擎是否以 `systemd-run` 或自行 daemonize 的方式脫離終端機；兩者都要在 22.04 實測 SSH 斷線後仍會繼續。D126 說不用 systemd 執行服務，但引擎本身的脫離方式是另一件事。
- `state.json` 與 `events.jsonl` 的存放位置與權限，要在實機驗證非 root 使用者可讀、秘密值不外洩。
- 「原本就存在」的記錄邊界：Docker 元件、映像與具名卷，如何可靠地區分本次建立與原有。
- 映像來源：已決定打進安裝包（`docker save`，digest 記錄於 system-manifest 並隨簽章驗證），不線上拉取（user 於 2026-10-25 同意，D139）。實測預覽用後端映像壓縮後約 157 MB、PostgreSQL 16.6 約 152 MB，兩者共用基底層一起存約 281 MB；反向代理與 guard 未量。若某映像 digest 未變，升級時略過載入的優化留待之後。
- Docker 最低可用版本、universe 未啟用時的處理（目前為停止並說明，不自動改 apt 來源）。
- 不把工程師帳號加入 `docker` 群組（等同 root 權限），特權步驟用 sudo；客戶日常操作指令以 sudo 執行，需寫入操作手冊與威脅模型（user 於 2026-10-25 核准，D138）。
- 資料庫與後端連線的秘密值以 0600 檔案提供，不放環境變數；後端目前以環境變數接 `DATABASE_URL`，改為讀檔須修改 `kits/` 基線副本，user 已於 2026-10-25 原則核准（D138），實際改動範圍於工作包中逐項回報。
- 本契約的事件與計畫格式需有 JSON Schema（比照 `schemas/` 的做法），並以假引擎測試精靈。
- 依賴檢查：精靈只可使用 Python 標準庫，若要新增套件須先經 user 核准。
- 實機驗證：在全新客機以 sudo 實際執行 `apt install docker.io docker-compose-v2`、品牌機的指紋來源穩定性、USB 掛載。

## 9. 安裝後的執行期元件（D136、D137）

這些元件不屬於安裝引擎，但安裝引擎負責部署，並在 `plan.json` 中有對應步驟。

- **guard 容器：** root、`cap_drop ALL`、`no-new-privileges`、唯讀根檔案系統、不發布連接埠，唯讀掛載宿主 `/sys`。定期重算指紋（網卡只取有實體裝置者；空值、`0`、全零 UUID、`To Be Filled By O.E.M.` 等無效值於安裝時排除），與授權比對，結果寫入與後端共用的卷。後端為非 root，讀到不符即依下列規則處理。
- **處理分流：** guard 失聯容忍 24 小時；指紋不符先顯示橫幅，寬限 24 小時；到期若不在 Site 設定的封鎖生效時段（預設平日 09:00 至 15:00）內，順延到下一個時段開始才拒絕服務。
- **授權狀態頁：** 被擋時保留最小頁面，顯示原因（哪幾項來源符合、不符）、下載重新綁定申請檔、上傳新授權，其餘功能回 503；另有命令列 `status` 診斷。提供方式（由 guard 或後端提供、反向代理如何轉送、上傳端點的存取控制）待設計。
- **緊急臨時授權：** 72 小時，只在上班時間受理，不接受夜間申請。
- **未提供時：** guard 或狀態頁尚未實作時，manifest 的 `notProvided` 必須列出，啟動時僅檢查授權簽章、到期日與 manifest 雜湊，不得宣稱已防複製。
- 尚未驗證：實體品牌機的指紋穩定性、guard 失效行為、狀態頁與反向代理的整合。

## 10. 修訂紀錄

- 2026-10-22（D126）：改為 Docker Compose 部署；契約升為正式決議；實作分為 WP3b（引擎與命令列）與 WP3c（網頁精靈），見 `.codex-claude-mailbox/threads/20261021-p2-executable-assembly.md`。
- 2026-10-28（D140）：更正手冊核對值為檔案位元組 sha256、精靈確認碼為 SPKI 前 8 碼；子金鑰與憑證檔路徑可用命令列傳入，密碼與到期日不可。
- 2026-10-25（D129 至 D133、D136、D137）：原第 9 節的修正整併入各節。新增 `issue-license` 與授權簽發流程、信任起點的手動核對、`trust-store` 與 `license-install` 步驟、退出碼 17、第 9 節的 guard 與狀態頁；apt 套件與 systemd 的還原列改為 Docker 物件。D133 撤銷 PostgreSQL 14 鎖定，改用容器內 PostgreSQL 16。
