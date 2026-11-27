import { app, expireOverdue } from './app';
import type { Env } from './env';

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(expireOverdue(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
