---
title: Kit 分頁動態預覽修改流程
date: 2026-09-27
tags: [composer, gui, mailbox, handoff]
---

# Kit 分頁動態預覽修改流程

導覽：[[18 Composer Platform 重構專案]] · [[04 GUI 與產品需求]] · [[05 待辦與交接]]

使用者已確認：一個 Kit 對應一個分頁；選取 Kit 後顯示其頁面與可修改項目。切換 Kit 分頁後，修改表格、下拉選單等設定並更新預覽。

基線版已有 Kit 分頁及 mockup 預覽程式；設定驅動的畫布、共用解析／呈現、修改與保存尚待接通。AoV 保留流程及能力描述，UI definition 描述畫面與互動。此現況來自 2026-09-24 原始碼檢視，未做本次執行驗證。

本次在重構專案建立專用 `.codex-claude-mailbox/`。完整修改流程、資料契約建議、測試情境與待決事項以任務 thread 為準，避免維護兩份完整說明：

- [修改流程與 Claude 審閱任務](file:///C:/Users/gslab/Desktop/composer-refactor/.codex-claude-mailbox/threads/20260927-kit-tab-ui-flow.md)
- [Mailbox 索引](file:///C:/Users/gslab/Desktop/composer-refactor/.codex-claude-mailbox/index.md)

修改順序：盤點契約與實作位置 → 定義 Kit UI 與可修改項目 → 沿用 Kit 分頁 → 共用解析與 renderer → 即時設定更新 → 核准事件與資料綁定 → 儲存／載入／產出 → 驗證。

狀態：ready_for_claude，僅文件交付；尚未實作、未執行功能測試、未收到 Claude 審閱。待決：取消 Kit 的草稿保留政策、基礎設施 Kit 頁面內容、正式系統是否同樣一 Kit 一分頁、後續實作位置。
