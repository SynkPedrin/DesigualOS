// QA helper: obtains a Supabase access token for the master QA account and
// caches it in /tmp/desigual-qa-token (mode 600). Never prints the token.
// Usage: node scripts/qa/login.mjs
import { writeFileSync, chmodSync } from 'node:fs';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const email = process.env.QA_USER_EMAIL || 'super@institutoalmada.org';
const password = process.env.QA_USER_PASSWORD || 'Elefante#123';

if (!url || !anonKey) {
  console.log(JSON.stringify({ ok: false, error: 'SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY ausentes no .env' }));
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const body = await res.json();
if (!res.ok) {
  console.log(JSON.stringify({ ok: false, status: res.status, error: body.error_description || body.msg || body.error }));
  process.exit(1);
}
const file = '/tmp/desigual-qa-token';
writeFileSync(file, body.access_token, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(JSON.stringify({ ok: true, expires_at: body.expires_at, token_file: file }));
