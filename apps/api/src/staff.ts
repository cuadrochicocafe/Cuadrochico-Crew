/**
 * Login del equipo con PIN personal.
 * Los PINs viven solo como huella PBKDF2 en el secreto STAFF_PINS (nunca en el repo):
 *   [{ "n": "Rudy", "r": "Gerente", "s": "<sal base64>", "h": "<huella base64>", "i": 100000 }, ...]
 * La sesión es un token firmado con ADMIN_TOKEN: rotarlo cierra todas las sesiones.
 */
import type { StaffRole } from '@cuadrochico/core';
import type { Env } from './env';
import { hmacSha256Hex, safeEqual } from './security';

export interface Actor {
  name: string;
  role: StaffRole;
}

interface StaffEntry {
  n: string;
  r: string;
  s: string;
  h: string;
  i: number;
}

const SESSION_DAYS = 14;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const roleOf = (r: string): StaffRole => (r === 'Gerente' ? 'manager' : 'barista');

export function staffList(env: Env): StaffEntry[] {
  try {
    const v: unknown = JSON.parse(env.STAFF_PINS ?? '[]');
    return Array.isArray(v) ? (v as StaffEntry[]).filter((x) => x && typeof x.n === 'string') : [];
  } catch {
    console.error('STAFF_PINS no es JSON válido');
    return [];
  }
}

export const publicStaff = (env: Env) => staffList(env).map((x) => ({ name: x.n, role: roleOf(x.r) }));

const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64url = (s: string) =>
  b64(new TextEncoder().encode(s).buffer as ArrayBuffer)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
  );

async function pinHash(pin: string, saltB64: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export type LoginResult =
  | { ok: true; token: string; actor: Actor; expiresAt: string }
  | { ok: false; reason: 'bad_pin' }
  | { ok: false; reason: 'locked'; until: string };

export async function login(env: Env, name: string, pin: string, now = new Date()): Promise<LoginResult> {
  const entry = staffList(env).find((x) => x.n === name);
  const row = await env.DB.prepare('SELECT fails, locked_until FROM staff_logins WHERE name = ?')
    .bind(name)
    .first<{ fails: number; locked_until: string | null }>();
  if (row?.locked_until && row.locked_until > now.toISOString())
    return { ok: false, reason: 'locked', until: row.locked_until };

  const ok =
    !!entry &&
    !!env.ADMIN_TOKEN &&
    safeEqual(await pinHash(pin, entry.s, Math.min(entry.i, 100_000)), entry.h);
  if (!ok) {
    const fails = (row?.fails ?? 0) + 1;
    const locked = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO staff_logins (name, fails, locked_until) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until`,
    )
      .bind(name, locked ? 0 : fails, locked)
      .run();
    return locked ? { ok: false, reason: 'locked', until: locked } : { ok: false, reason: 'bad_pin' };
  }
  if (row) await env.DB.prepare('DELETE FROM staff_logins WHERE name = ?').bind(name).run();

  const actor: Actor = { name: entry.n, role: roleOf(entry.r) };
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  const payload = b64url(JSON.stringify({ ...actor, exp: expiresAt }));
  const token = `s.${payload}.${await hmacSha256Hex(env.ADMIN_TOKEN as string, payload)}`;
  return { ok: true, token, actor, expiresAt };
}

/** Quién hace la petición: sesión de empleado vigente o el ADMIN_TOKEN (gerente "admin"). */
export async function actorFor(env: Env, bearer: string, now = new Date()): Promise<Actor | null> {
  const secret = env.ADMIN_TOKEN;
  if (!secret || !bearer) return null;
  if (!bearer.startsWith('s.')) return safeEqual(bearer, secret) ? { name: 'admin', role: 'manager' } : null;
  const [, payload = '', sig = ''] = bearer.split('.');
  if (!safeEqual(sig, await hmacSha256Hex(secret, payload))) return null;
  try {
    const s = JSON.parse(fromB64url(payload)) as Actor & { exp: string };
    if (!(s.exp > now.toISOString())) return null;
    // Si quitan a alguien de STAFF_PINS, su sesión deja de servir.
    const entry = staffList(env).find((x) => x.n === s.name);
    return entry ? { name: entry.n, role: roleOf(entry.r) } : null;
  } catch {
    return null;
  }
}
