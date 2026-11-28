/**
 * Alertas de errores al chat del equipo (Telegram). Sin Telegram configurado, solo quedan en los registros.
 * Para no inundar el chat, cada tipo de error avisa como máximo una vez cada 10 minutos por instancia.
 */
import type { Env } from './env';
import { notifyTeam } from './telegram';

const QUIET_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

export function resetAlerts(): void {
  lastSent.clear();
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `where`: qué falló, p. ej. "POST /api/webhooks/mercadopago" o "cron". */
export async function alertError(env: Env, where: string, err: unknown, now = Date.now()): Promise<void> {
  const prev = lastSent.get(where);
  if (prev !== undefined && now - prev < QUIET_MS) return;
  lastSent.set(where, now);
  await notifyTeam(
    env,
    `⚠️ Error en el sistema de pedidos (${where}):\n${errText(err).slice(0, 300)}\nRevisa los registros del Worker en Cloudflare.`,
  );
}
