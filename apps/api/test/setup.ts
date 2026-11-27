import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM order_events'),
    env.DB.prepare('DELETE FROM order_items'),
    env.DB.prepare('DELETE FROM orders'),
  ]);
});
