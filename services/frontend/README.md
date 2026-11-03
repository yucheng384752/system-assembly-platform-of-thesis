# System frontend base

Files the Kits do not carry, copied from the baseline `dist/generated-system/frontend` (read-only source):
build configuration, the entry point, upload page and helpers, shared services and locale files.

Changed from the baseline (the rest is byte-identical):

- `src/services/auth.ts`, `tenant.ts`, `fetchWrapper.ts`: entry-permission Bearer token in `sessionStorage`,
  no tenant selection, no admin key, 401 returns to the login page.
- `src/services/api.ts`: same-origin base URL; XHR uploads no longer require a browser-selected tenant.
- `src/pages/LoginPage.tsx`, `src/styles/login.css`, the `login` and extra `tabs` locale keys: new.
- `src/locales/en/common.json`: the English label `Password` is `Account password` so the release scanner's
  default-secret rule has no false match.
- Removed: `adminAuth.ts`, `tenantMap.ts`, Register, Manager and Admin pages and `components/admin/`.

`App.tsx` is generated per Recipe by `services/package/frontend.mjs`. The bundle is built at release by
`services/package/bundle-frontend.mjs`; see `services/package/README.md`.
