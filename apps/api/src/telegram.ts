import type { Env } from './env';

/** Manda un aviso al chat del equipo. Si falta configuración o Telegram falla, no rompe nada. */
export async function notifyTeam(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('telegram', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('telegram', err);
    return false;
  }
}
