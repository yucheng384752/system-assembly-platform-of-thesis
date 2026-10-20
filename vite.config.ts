import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'apps/composer-gui',
  server: { proxy: { '/preview-api': {
    target: `http://127.0.0.1:${process.env.PREVIEW_API_PORT ?? 18000}`,
    rewrite: path => path.replace(/^\/preview-api/, ''),
  } } },
  test: { setupFiles: ['./src/testCanvas.ts'] },
  build: { outDir: '../../dist', emptyOutDir: true },
});
