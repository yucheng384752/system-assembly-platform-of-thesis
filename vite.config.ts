import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'apps/composer-gui',
  test: { setupFiles: ['./src/testCanvas.ts'] },
  build: { outDir: '../../dist', emptyOutDir: true },
});
