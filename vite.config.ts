import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'apps/composer-gui',
  server: { proxy: {
    '/preview-api': {
      target: `http://127.0.0.1:${process.env.PREVIEW_API_PORT ?? 18000}`,
      rewrite: path => path.replace(/^\/preview-api/, ''),
    },
    // D180: the case store service stays loopback-only; the screen reaches it same-origin through this path.
    '/case-store-api': {
      target: `http://127.0.0.1:${process.env.CASE_STORE_PORT ?? 18788}`,
      rewrite: path => path.replace(/^\/case-store-api/, ''),
    },
  } },
  test: { setupFiles: ['./src/testCanvas.ts'] },
  build: { outDir: '../../dist', emptyOutDir: true },
});
