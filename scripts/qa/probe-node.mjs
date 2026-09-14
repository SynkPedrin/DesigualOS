// QA probe: calls a node's /execute directly, exactly like the worker does.
// Usage: node scripts/qa/probe-node.mjs <url> "message" [timeout_ms]
// Example: node scripts/qa/probe-node.mjs http://100.70.73.74:4002 "teste" 60000
process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

const [url, message, timeoutMs] = [process.argv[2], process.argv[3] || 'ping de QA', Number(process.argv[4] || 60000)];
const secret = process.env.NODE_SECRET;
if (!secret) {
  console.log(JSON.stringify({ ok: false, error: 'NODE_SECRET ausente no .env' }));
  process.exit(1);
}

const t0 = performance.now();
try {
  const res = await fetch(`${url}/execute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ execution_id: `QA-${Date.now()}`, message, context_refs: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Math.round(performance.now() - t0);
  const body = await res.json().catch(() => null);
  console.log(JSON.stringify({
    ok: res.ok, http: res.status, ms,
    status: body?.status, error: body?.error ?? null,
    answer_preview: body?.answer ? String(body.answer).slice(0, 500) : null,
    meta_keys: body?.metadata ? Object.keys(body.metadata) : [],
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, ms: Math.round(performance.now() - t0), error: String(err?.message || err) }));
}
