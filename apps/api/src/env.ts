import { defaultSettings, type Settings } from '@cuadrochico/core';
import type { Actor } from './staff';

/** Bindings y secretos del Worker. Todos los secretos son opcionales: si faltan, su función se desactiva. */
export interface Env {
  DB: D1Database;
  /** Archivos de apps/web/dist. No existe en pruebas ni si no se compiló la web. */
  ASSETS?: Fetcher;
  ADMIN_TOKEN?: string;
  /** Huellas PBKDF2 de los PINs del equipo (JSON). Ver src/staff.ts. */
  STAFF_PINS?: string;
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
  TRANSFER_BANK?: string;
  TRANSFER_BENEFICIARY?: string;
  TRANSFER_CLABE?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TURNSTILE_SECRET?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CALENDAR_ID?: string;
}

export type AppEnv = { Bindings: Env; Variables: { actor: Actor } };

/**
 * Configuración efectiva: la de core más los secretos. Los datos bancarios de settings.json son
 * marcadores ("POR CONFIGURAR"); los reales vienen de secretos. Sin ellos, el método se reporta desactivado.
 */
export function settingsFor(env: Env): Settings {
  const s = defaultSettings;
  const bank = env.TRANSFER_BANK?.trim();
  const beneficiary = env.TRANSFER_BENEFICIARY?.trim();
  const clabe = env.TRANSFER_CLABE?.trim();
  return {
    ...s,
    payments: {
      transfer: {
        enabled: s.payments.transfer.enabled && !!bank && !!beneficiary && !!clabe,
        bank: bank ?? '',
        beneficiary: beneficiary ?? '',
        clabe: clabe ?? '',
      },
      mercadopago: {
        enabled: s.payments.mercadopago.enabled && !!env.MP_ACCESS_TOKEN && !!env.MP_WEBHOOK_SECRET,
      },
    },
  };
}
