// QA helper: obtains a Supabase access token for the master QA account and
// caches it in /tmp/desigual-qa-token (mode 600). Never prints the token.
// Usage: node scripts/qa/login.mjs
import { writeFileSync, chmodSync } from 'node:fs';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
// .env.local também: é onde ficam as credenciais de QA (fora do .env que
// carrega config de serviço). Ausente em máquina que não faz QA — por isso
// o try, em vez de quebrar quem só quer rodar o resto.
try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url).pathname);
} catch {
  // sem .env.local: a checagem de QA_USER_* abaixo dá a mensagem certa.
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
// Credencial SÓ por env (.env/.env.local, ambos gitignored). Antes havia
// e-mail e SENHA REAL embutidos como fallback neste arquivo versionado —
// achado na revisão do release gate (15/09/2026). Sem env, o script falha
// alto: melhor não rodar do que carregar segredo no repositório.
const email = process.env.QA_USER_EMAIL;
const password = process.env.QA_USER_PASSWORD;

if (!url || !anonKey) {
  console.log(JSON.stringify({ ok: false, error: 'SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY ausentes no .env' }));
  process.exit(1);
}

if (!email || !password) {
  console.log(JSON.stringify({ ok: false, error: 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes no .env.local' }));
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
