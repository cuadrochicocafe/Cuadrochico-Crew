// Carga los PIN del equipo en Cloudflare (secreto STAFF_PINS) sin mostrarlos ni guardarlos en disco.
// Uso, desde apps/api:   node scripts/staff-pins.mjs
// Toma los nombres y roles de usuarios.js (raíz del repo). Deja un PIN vacío para que esa persona no pueda entrar.
import { spawn } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ITERATIONS = 100_000; // máximo que acepta PBKDF2 en Cloudflare Workers

const src = readFileSync(new URL('../../../usuarios.js', import.meta.url), 'utf8');
const team = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\u0003') process.exit(1); // Ctrl+C
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function hash(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  );
  return { s: Buffer.from(salt).toString('base64'), h: Buffer.from(bits).toString('base64'), i: ITERATIONS };
}

const entries = [];
for (const { n, r } of team) {
  for (;;) {
    const pin = await askHidden(`PIN de ${n} (${r}), vacío para omitir: `);
    if (!pin) {
      console.log(`  ${n} queda sin acceso.`);
      break;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      console.log('  El PIN son de 4 a 8 números. Otra vez.');
      continue;
    }
    if ((await askHidden('  Repítelo: ')) !== pin) {
      console.log('  No coinciden. Otra vez.');
      continue;
    }
    entries.push({ n, r, ...(await hash(pin)) });
    break;
  }
}

if (!entries.length) {
  console.log('No se cargó ningún PIN. No cambié nada.');
  process.exit(0);
}

console.log(`\nSubiendo ${entries.length} PIN(s) a Cloudflare…`);
const child = spawn('npx', ['wrangler', 'secret', 'put', 'STAFF_PINS'], {
  cwd: new URL('..', import.meta.url),
  shell: true,
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify(entries));
child.on('exit', (code) => process.exit(code ?? 1));
