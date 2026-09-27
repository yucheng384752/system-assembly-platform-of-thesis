import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/composer-gui',
  build: { outDir: '../../dist', emptyOutDir: true },
});
