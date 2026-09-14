// QA probe: calls bento-qa /ask directly with the same payload the worker uses.
// Never prints secrets. Usage: node scripts/qa/probe-bento.mjs "question"
import 'node:process';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

const url = process.env.BENTO_QA_URL || `http://${process.env.BENTO_HOST || '100.93.182.83'}:8791`;
const token = process.env.BENTO_QA_TOKEN;
const question = process.argv[2] || 'ping de QA';

if (!token) {
  console.log(JSON.stringify({ ok: false, error: 'BENTO_QA_TOKEN ausente no .env' }));
  process.exit(1);
}

const t0 = performance.now();
try {
  const res = await fetch(`${url}/ask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, channel: 'clickup' }),
    signal: AbortSignal.timeout(100_000),
  });
  const ms = Math.round(performance.now() - t0);
  const body = await res.json().catch(() => null);
  console.log(JSON.stringify({
    ok: res.ok,
    http: res.status,
    ms,
    status: body?.status,
    answer_len: body?.answer?.length ?? null,
    citations: body?.citations?.length ?? null,
    answer_preview: body?.answer ? String(body.answer).slice(0, 600) : null,
    error: body?.error ?? null,
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, ms: Math.round(performance.now() - t0), error: String(err?.message || err) }));
}
