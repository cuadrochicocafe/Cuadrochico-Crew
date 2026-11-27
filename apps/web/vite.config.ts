import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  server: {
    // El worker (`pnpm dev:api`) responde /api en local.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Celulares viejos: Safari 14 y Chrome 87 en adelante.
    target: ['es2020', 'safari14', 'chrome87'],
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
