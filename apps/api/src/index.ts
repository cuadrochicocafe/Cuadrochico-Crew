import { alertError } from './alerts';
import { app, expireOverdue } from './app';
import type { Env } from './env';

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      expireOverdue(env).then(
        () => undefined,
        async (err) => {
          console.error('cron', err);
          await alertError(env, 'cron de pedidos vencidos', err);
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
