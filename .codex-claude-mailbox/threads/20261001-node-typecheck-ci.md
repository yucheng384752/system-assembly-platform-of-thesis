---
id: "20261001-node-typecheck-ci"
title: "Node 腳本納入 typecheck 與 CI 設定（D47）"
status: "completed"
owner: "user"
reviewer: "user"
priority: "medium"
created_by: "claude"
created_at: "2026-10-01"
updated_at: "2026-10-01"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "tsconfig.node.json"
    type: "file"
  - path: "package.json"
    type: "file"
---

# Goal

核准新增 `@types/node`，讓 `scripts/security` 納入 typecheck，並設定 CI。分支 `feature/node-typecheck-ci`，由 main（8ae2972 之後）開出。

# User 已確認（2026-10-01）

- 合併 `feature/security-hardening` 至 main（8ae2972）。
- 核准新增 `@types/node`；`scripts/security` 納入 typecheck；設定 CI。

# Claude Notes

## typecheck（已完成）

- `@types/node` 22.20.4 鎖定版本（`npm install -D -E`）；鎖定檔只多 `@types/node` 與 `undici-types`。
- 新增 `tsconfig.node.json`（繼承根設定，`allowJs`、`checkJs`、`types: ["node"]`），涵蓋 `scripts/**/*.mjs`、`security.test.mjs` 與 `vite-env.d.ts`；`npm run typecheck` 依序跑兩份設定；`build` 改為先跑 `npm run typecheck`。
- 納入後立即抓到 `security.test.mjs` 的參數缺少型別（上次改 `.mjs` 時移除了 TS 註記），已補 JSDoc。
- 突變檢查：腳本內改錯型別、測試檔傳錯參數，都被攔到。
- 已知限制：想以 `"types": []` 隔離前端與 Node 全域型別，但 `vite` 自己的型別宣告會引用 `@types/node`（`--explainFiles` 確認），前端程式因此仍看得到 `process` 等 Node 全域；該設定無效，已移除。若要隔離，需把 `vite.config.ts` 與測試移出前端 program，不在本次範圍。

## CI（2026-10-01 user 決定跳過）

專案沒有 git 遠端，也沒有 `.github/`，CI 平台未定；user 決定跳過，不設定 CI。日後若有遠端，再依平台設定，建議的檢查為 typecheck、vitest、build、kits Python 測試。

# Closure

2026-10-01：user 同意合併；以 `--no-ff` 合併至 main，合併後 typecheck、build 通過，vitest 55 passed、1 skipped，test:kits 14 passed、1 skipped。CI 依 user 決定跳過。

# Open Questions

- 無（CI 已跳過）。
