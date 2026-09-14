// QA V2: escuta o WS real e captura os eventos agent.phase de uma execução.
// Uso: node scripts/qa/ws-phases.mjs "mensagem" [HINT]
import { readFileSync } from 'node:fs';

const TOKEN = readFileSync('/tmp/desigual-qa-token', 'utf8').trim();
const [, , message, hint = 'JARBAS'] = process.argv;

const res = await fetch('http://127.0.0.1:3001/chat', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, agent_hint: hint }),
});
const ack = await res.json();
console.log('ACK', res.status, ack.execution_id);
if (!ack.execution_id) process.exit(1);

const ws = new WebSocket(`ws://127.0.0.1:3001/ws?token=${TOKEN}`);
const events = [];
const deadline = Date.now() + 120_000;

ws.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  const payload = event.payload ?? {};
  if (payload.execution_id !== ack.execution_id) return;
  events.push({ type: event.type, phase: payload.phase, label: payload.label, status: payload.status, attempt: payload.attempt });
  console.log('EVENTO:', event.type, payload.phase ?? '', payload.label ?? payload.status ?? '');
  if (event.type === 'execution.completed' || (event.type === 'message.delta' && payload.done)) {
    console.log('FASES CAPTURADAS:', JSON.stringify(events));
    ws.close();
    process.exit(0);
  }
};
ws.onerror = (e) => console.log('WS ERROR', String(e.message ?? e));
setTimeout(() => {
  console.log('TIMEOUT. FASES CAPTURADAS:', JSON.stringify(events));
  process.exit(events.length > 0 ? 0 : 1);
}, Math.min(deadline - Date.now(), 120_000));
