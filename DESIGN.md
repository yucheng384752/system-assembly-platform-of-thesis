# Composer 介面約定

## Overview & mood
簡潔、易讀的四步驟介面，以原生控制項操作。
## Color tokens
背景 #f4f6f8、面板 #ffffff、文字 #172b3a、次要文字 #40576a、主色 #075e54、錯誤 #a32222、邊框 #718096、焦點 #174ea6。以 CSS 變數集中管理。
## Typography
system-ui、Microsoft JhengHei、sans-serif；正文 1rem、行高 1.65，標題 1.25–2rem。
## Spacing & layout grid
間距 0.5、1、1.5、2rem；主內容最大寬 76rem；窄螢幕單欄。
## Radius / borders / elevation
圓角 0.5rem、1px 邊框、不使用陰影。
## Components
按鈕、輸入與選單高度至少 44px；核取框標籤高度至少 44px。表格在區塊內捲動。選取、錯誤與完成狀態有文字提示。
## Motion
不使用動畫；prefers-reduced-motion 下關閉動畫與平滑捲動。
## Data-viz rules
本期使用 mock 表格，無圖表。
## Voice & copy
繁體中文、業務語言、不使用 emoji。技術識別碼收合。標示模擬資料及未提供功能。
## Do / Don't
保留可見標籤、鍵盤操作、3px 焦點框與狀態播報。勿僅以顏色表示狀態；勿外送或保存使用者資料。
