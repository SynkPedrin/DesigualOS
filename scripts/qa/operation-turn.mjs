import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const [agent, prompt, conversationId] = process.argv.slice(2);
if (!['bento', 'otto', 'jarbas', 'suzy'].includes(agent) || !prompt) throw new Error('agent and prompt required');
const token = readFileSync('/tmp/desigual-qa-token', 'utf8').trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const base = process.env.QA_API_BASE ?? 'http://127.0.0.1:3001';
const started = Date.now();
const response = await fetch(`${base}/chat`, { method: 'POST', headers, body: JSON.stringify({
  agent_hint: agent.toUpperCase(), message: prompt,
  client_id: '3f1849a0-8682-45df-8ea2-b74be305f98b',
  ...(conversationId ? { conversation_id: conversationId } : {}),
}), signal: AbortSignal.timeout(60000) });
const ack = await response.json();
if (!response.ok) throw new Error(JSON.stringify(ack));
console.log(JSON.stringify({ stage: 'accepted', ...ack }));
let execution;
while (Date.now() - started < 300000) {
  await new Promise(r => setTimeout(r, 1500));
  const r = await fetch(`${base}/executions/${ack.execution_id}`, { headers, signal: AbortSignal.timeout(10000) });
  execution = await r.json();
  if (['completed', 'failed', 'cancelled'].includes(execution.status)) break;
}
const messages = await (await fetch(`${base}/conversations/${ack.conversation_id}/messages`, { headers })).json();
const trace = { requestId: response.headers.get('x-request-id'), agent, userPrompt: prompt, ack, execution, messages, durationMs: Date.now() - started };
const dir = new URL('../../artifacts/operation-release/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`${ack.execution_id}.json`, dir), JSON.stringify(trace, null, 2), { mode: 0o600 });
console.log(JSON.stringify(trace, null, 2));
