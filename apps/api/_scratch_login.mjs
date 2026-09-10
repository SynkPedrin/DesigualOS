import './src/env.js';
import { readFileSync, writeFileSync } from 'node:fs';

const SCRATCH = '/private/tmp/claude-501/-Users-pedro-Downloads-Desigual-OS/fae0190c-1ffa-4d89-8e60-5a52faa3e923/scratchpad';
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'super@institutoalmada.org', password: 'Elefante@123' }),
});
const body = await res.json();
if (!res.ok) {
  console.log(JSON.stringify({ ok: false, status: res.status, error: body.error_description || body.msg || body.error }));
  process.exit(1);
}
writeFileSync(`${SCRATCH}/.session_token`, body.access_token);
console.log(JSON.stringify({ ok: true, expires_at: body.expires_at }));
