import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Las pruebas corren dentro de workerd (Miniflare) con una D1 local real.
// No se lee wrangler.jsonc para no depender de que exista apps/web/dist (assets).
export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        miniflare: {
          compatibilityDate: '2026-11-01',
          d1Databases: ['DB'],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
