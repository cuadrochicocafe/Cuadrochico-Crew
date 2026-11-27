/** Verifica un token de Cloudflare Turnstile. */
export async function verifyTurnstile(secret: string, token: string | undefined, ip: string | null) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error('turnstile', err);
    return false;
  }
}
