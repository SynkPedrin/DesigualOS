// QA helper: sends a chat message and measures the full pipeline timeline.
// Usage: node scripts/qa/chat-test.mjs "message" [AGENT_HINT] [conversation_id]
// Prints JSON: ack_ms, completed_ms, status, agent, response preview.
import { readFileSync } from 'node:fs';

const BASE = process.env.QA_API_BASE || 'http://127.0.0.1:3001';
const TOKEN = readFileSync('/tmp/desigual-qa-token', 'utf8').trim();
const [, , message, hint = 'AUTO', conversationId] = process.argv;

if (!message) {
  console.error('usage: chat-test.mjs "message" [AGENT_HINT] [conversation_id]');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const t0 = performance.now();

const res = await fetch(`${BASE}/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    message,
    agent_hint: hint,
    ...(conversationId ? { conversation_id: conversationId } : {}),
  }),
});
const ackMs = Math.round(performance.now() - t0);
const ack = await res.json();
if (!res.ok) {
  console.log(JSON.stringify({ ok: false, ack_ms: ackMs, status: res.status, error: ack }));
  process.exit(1);
}

const executionId = ack.execution_id;
const convId = ack.conversation_id;
const deadline = Date.now() + Number(process.env.QA_EXEC_TIMEOUT_MS || 400000);
let last = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  const er = await fetch(`${BASE}/executions/${executionId}`, { headers });
  if (!er.ok) continue;
  last = await er.json();
  const status = last.status || last.execution?.status;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') break;
}
const totalMs = Math.round(performance.now() - t0);
const steps = last?.steps || last?.execution_steps || [];
const lastStep = steps[steps.length - 1];
const output = lastStep?.output || last?.output || {};
let responseText = typeof output === 'string' ? output : output.response || output.answer || output.text || '';

// Fallback: alguns caminhos (agentes-desigual) gravam a resposta direto em messages.
if (!responseText.trim() || responseText === '{}') {
  try {
    const mr = await fetch(`${BASE}/conversations/${convId}/messages`, { headers });
    const msgs = await mr.json();
    const list = Array.isArray(msgs) ? msgs : msgs.messages || [];
    const assistant = [...list].reverse().find((m) => m.role === 'assistant');
    if (assistant) responseText = assistant.content;
  } catch { /* mantém vazio */ }
}

console.log(JSON.stringify({
  ok: true,
  ack_ms: ackMs,
  total_ms: totalMs,
  status: last?.status || last?.execution?.status,
  agent: ack.agent || last?.agent_id || last?.agent,
  execution_id: executionId,
  conversation_id: convId,
  steps: steps.map((s) => ({ i: s.step_index ?? s.stepIndex, status: s.status, dur: s.duration_ms ?? s.durationMs })),
  response_preview: String(responseText).slice(0, 1200),
}));
