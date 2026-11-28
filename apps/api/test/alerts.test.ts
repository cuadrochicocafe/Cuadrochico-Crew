import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAlerts } from '../src/alerts';
import { mockOutbound, type Outbound, runCron, signedWebhook, testEnv } from './helpers';

let out: Outbound;
beforeEach(() => {
  out = mockOutbound();
  resetAlerts();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const alerts = () => out.telegram.filter((t) => t.startsWith('⚠️ Error en el sistema de pedidos'));

describe('alertas de errores', () => {
  it('un error inesperado avisa al equipo por ruta, una vez cada 10 minutos', async () => {
    // Mercado Pago no encuentra el pago: el webhook falla con 500 (y Mercado Pago lo reintentará).
    const res = await signedWebhook('999');
    expect(res.status).toBe(500);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain('POST /api/webhooks/mercadopago');
    expect(alerts()[0]).toContain('404');

    await signedWebhook('998');
    expect(alerts()).toHaveLength(1);
  });

  it('sin Telegram configurado no truena: solo queda en los registros', async () => {
    const res = await signedWebhook('999', undefined, testEnv({ TELEGRAM_BOT_TOKEN: undefined }));
    expect(res.status).toBe(500);
    expect(out.telegram).toHaveLength(0);
  });

  it('si el cron falla, avisa', async () => {
    await runCron(testEnv({ DB: undefined as unknown as D1Database }));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain('cron de pedidos vencidos');
  });
});
