// FASE B.3 + B.9 (auditoria forense 25/09/2026): reprodução AO VIVO do
// invariante UPDATE≠CREATE do Bento contra o cliente QA "Cliente Teste 7"
// (3f1849a0-8682-45df-8ea2-b74be305f98b). Adaptado de
// forensic-benchmark-20260925.mjs. Não modifica produção, não toca em flags,
// não imprime secrets: o Bearer vem de /tmp/desigual-qa-token e a chave do
// ClickUp do .env (CLICKUP_API_KEY / CLICKUP_TEST_LIST_ID — este último é o
// clickup_list_id do Cliente Teste 7, confirmado via banco em 25/09/2026).
//
// Uso: node scripts/qa/fase-b-battery-20260925.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

const BASE = 'http://127.0.0.1:3001';
const CLIENT_ID = '3f1849a0-8682-45df-8ea2-b74be305f98b';
const PREFIX = '[QA FASEB 2509]';
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CLICKUP_LIST_ID = process.env.CLICKUP_TEST_LIST_ID;
const WORKER_LOG = '/tmp/desigual-worker.log';
const TOKEN_FILE = '/tmp/desigual-qa-token';
const OUT_DIR = new URL('../../artifacts/fase-b-2026-09-25/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

if (!CLICKUP_API_KEY || !CLICKUP_LIST_ID) {
  console.error('CLICKUP_API_KEY/CLICKUP_TEST_LIST_ID ausentes no .env — impossível contar tasks QA.');
  process.exit(1);
}

const TURNS = [
  ['T00', `Crie uma task chamada "${PREFIX} Carrossel Outubro" para Pedro Gabriel no Cliente Teste 7. Briefing: carrossel 5 slides, 1080x1350, CTA WhatsApp. Prazo amanhã.`],
  ['T01', 'atualiza essa task e coloca pra sexta'],
  ['T02', 'muda o prazo dela pra amanhã'],
  ['T03', 'coloca o Matheus nela'],
  ['T04', 'adiciona o Matheus também'],
  ['T05', 'troca o responsável pra Sofia'],
  ['T06', 'adiciona isso no briefing'],
  ['T07', 'nessa mesma task coloca prioridade alta'],
  ['T08', 'altera aquilo que acabamos de criar'],
  ['T09', 'na task anterior coloca terça'],
  ['T10', 'não, tira o Matheus dela'],
  ['T11', 'coloca essa observação naquela demanda'],
  ['T12', 'corrige a task que você acabou de criar'],
];

const DUP_MESSAGE = `Crie uma task chamada "${PREFIX} DUP TEST" no Cliente Teste 7`;

function token() {
  return readFileSync(TOKEN_FILE, 'utf8').trim();
}
function authHeaders() {
  return { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' };
}

async function preflightAuth() {
  const res = await fetch(`${BASE}/clients/${CLIENT_ID}`, { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
  if (res.status !== 401) return;
  // Token expirado: regenera pelo login.mjs (credenciais do .env/.env.local).
  // Saída capturada e NUNCA exibida (pode conter metadados de sessão).
  execFileSync('node', [new URL('./login.mjs', import.meta.url).pathname], { stdio: 'pipe' });
  const retry = await fetch(`${BASE}/clients/${CLIENT_ID}`, { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
  if (retry.status === 401) throw new Error('Token ainda inválido após login.mjs');
}

/** Tasks da lista QA cujo nome começa com o prefixo da bateria. */
async function listQaTasks() {
  const found = [];
  for (let page = 0; page < 10; page += 1) {
    const res = await fetch(
      `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task?include_closed=true&subtasks=true&page=${page}`,
      { headers: { Authorization: CLICKUP_API_KEY }, signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) throw new Error(`ClickUp list tasks failed (${res.status})`);
    const body = await res.json();
    const tasks = body.tasks ?? [];
    for (const t of tasks) {
      if (typeof t.name === 'string' && t.name.startsWith(PREFIX)) found.push({ id: t.id, name: t.name });
    }
    if (tasks.length < 100) break;
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Linhas do log do worker correlacionadas ao execution_id (±8 linhas de contexto). */
function workerLogSlice(executionId) {
  let raw;
  try {
    raw = readFileSync(WORKER_LOG, 'utf8');
  } catch {
    return { found: false, lines: [], note: 'worker log ilegível/ausente' };
  }
  // Remove códigos ANSI pra o artefato ficar legível.
  const lines = raw.replace(/\[\d+m/g, '').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (line.includes(executionId)) hits.push(i);
  });
  if (hits.length === 0) return { found: false, lines: [] };
  const windows = [];
  for (const i of hits) {
    const from = Math.max(0, i - 8);
    const to = Math.min(lines.length - 1, i + 8);
    const last = windows[windows.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else windows.push({ from, to });
  }
  const out = [];
  for (const w of windows) {
    out.push(...lines.slice(w.from, w.to + 1));
  }
  const joined = out.join('\n');
  return { found: true, lines: joined.length > 30000 ? `${joined.slice(0, 30000)}\n...[truncado]` : joined };
}

async function postChat(message, conversationId) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message, agent_hint: 'BENTO', client_id: CLIENT_ID, ...(conversationId ? { conversation_id: conversationId } : {}) }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, body };
}

async function pollExecution(executionId, budgetMs = 180000) {
  const start = Date.now();
  let execution = null;
  while (Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${BASE}/executions/${executionId}`, { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
    if (!res.ok) continue;
    execution = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) break;
  }
  return execution;
}

function extractAnswerAndMeta(execution) {
  const steps = execution?.steps ?? [];
  const withAnswer = [...steps].reverse().find((s) => s?.output && (s.output.answer != null || s.output.metadata != null));
  const output = withAnswer?.output ?? null;
  return {
    answer: output?.answer ?? null,
    metadata: output?.metadata ?? null,
    stepStatus: withAnswer?.status ?? null,
    stepCount: steps.length,
  };
}

function resolveTaskId(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  if (metadata.task_id) return metadata.task_id;
  const env = metadata.write_envelope;
  if (env && Array.isArray(env.resourceIds) && env.resourceIds.length > 0) return env.resourceIds[0];
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await preflightAuth();
const results = [];
let conversationId;

console.log(JSON.stringify({ fase: 'B.3', inicio: new Date().toISOString() }));

for (const [turn, prompt] of TURNS) {
  const start = Date.now();
  const record = { turn, prompt };
  try {
    const before = await listQaTasks();
    record.tasksBefore = before;

    const ack = await postChat(prompt, conversationId);
    record.httpStatus = ack.httpStatus;
    record.ack = ack.body;
    if (ack.httpStatus === 200 || ack.httpStatus === 202) {
      conversationId = ack.body.conversation_id ?? conversationId;
      const execution = await pollExecution(ack.body.execution_id);
      record.execution = execution;
      Object.assign(record, extractAnswerAndMeta(execution));
      record.resolvedTaskId = resolveTaskId(record.metadata);
    }

    await sleep(2500); // settle: webhook/sync do ClickUp não afetam a contagem, mas a escrita sim
    const after = await listQaTasks();
    record.tasksAfter = after;
    record.invariantOk = turn === 'T00' ? after.length >= before.length : after.length <= before.length;
    if (ack.body?.execution_id) record.workerLog = workerLogSlice(ack.body.execution_id);
  } catch (error) {
    record.error = String(error?.message ?? error);
  }
  record.durationMs = Date.now() - start;
  results.push(record);
  writeFileSync(new URL(`${turn}.json`, OUT_DIR), JSON.stringify(record, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    turn,
    http: record.httpStatus,
    status: record.execution?.status,
    guard: record.metadata?.guard,
    action: record.metadata?.action ?? record.metadata?.write_envelope?.operation,
    taskId: record.resolvedTaskId,
    antes: record.tasksBefore?.length,
    depois: record.tasksAfter?.length,
    invariante: record.invariantOk,
    ms: record.durationMs,
  }));
}

// ---------------------------------------------------------------- B.9
console.log(JSON.stringify({ fase: 'B.9', inicio: new Date().toISOString() }));

async function runDupPhase(label, gapMs) {
  const phase = { label, message: DUP_MESSAGE, gapMs };
  const before = await listQaTasks();
  phase.dupBefore = before.filter((t) => t.name.includes('DUP TEST'));

  const sends = [];
  const t0 = Date.now();
  if (gapMs === 0) {
    const [a, b] = await Promise.all([postChat(DUP_MESSAGE, conversationId), postChat(DUP_MESSAGE, conversationId)]);
    sends.push({ ...a, sentAt: 0 }, { ...b, sentAt: Date.now() - t0 });
  } else {
    const a = await postChat(DUP_MESSAGE, conversationId);
    sends.push({ ...a, sentAt: 0 });
    await sleep(gapMs);
    const b = await postChat(DUP_MESSAGE, conversationId);
    sends.push({ ...b, sentAt: Date.now() - t0 });
  }
  phase.sends = sends.map((s) => ({ httpStatus: s.httpStatus, body: s.body, sentAt: s.sentAt }));
  if (sends.some((s) => s.body?.conversation_id)) conversationId = sends.find((s) => s.body?.conversation_id).body.conversation_id;

  phase.executions = [];
  for (const s of sends) {
    const execId = s.body?.execution_id;
    if (!execId) continue;
    const execution = await pollExecution(execId);
    const meta = extractAnswerAndMeta(execution);
    phase.executions.push({ execution_id: execId, execution, ...meta, resolvedTaskId: resolveTaskId(meta.metadata), workerLog: workerLogSlice(execId) });
  }

  await sleep(2500);
  const after = await listQaTasks();
  phase.dupAfter = after.filter((t) => t.name.includes('DUP TEST'));
  phase.allQaAfter = after;
  writeFileSync(new URL(`${label}.json`, OUT_DIR), JSON.stringify(phase, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    fase: label,
    acks: sends.map((s) => s.httpStatus),
    dedup: sends.map((s) => Boolean(s.body?.deduplicated)),
    dupAntes: phase.dupBefore.length,
    dupDepois: phase.dupAfter.length,
  }));
  return phase;
}

const dup1 = await runDupPhase('DUP1-simultaneo', 0);
// Garante que o primeiro envio da fase 2 caia FORA da janela de 15s da fase 1.
await sleep(Math.max(0, 20000 - 0));
const dup2 = await runDupPhase('DUP2-gap20s', 20000);

// ---------------------------------------------------------------- SUMMARY
function caminho(record) {
  const g = record.metadata?.guard;
  if (g === 'bento-openai-core') return 'core (openai)';
  if (g === 'bento-action') return 'guard (bento-action)';
  if (g) return g;
  if (record.execution) return 'externo/sem-metadata';
  return 'sem execução';
}
function intencao(record) {
  const m = record.metadata ?? {};
  return m.action ?? m.intent_classification ?? m.write_envelope?.operation ?? record.execution?.intent ?? '-';
}

const linhas = ['| Turno | Frase | Caminho | Intenção detectada | task_id resolvido | Tasks antes | Tasks depois | Invariante OK? |', '|---|---|---|---|---|---|---|---|'];
for (const r of results) {
  linhas.push(`| ${r.turn} | ${r.prompt.replaceAll('|', '\\|')} | ${caminho(r)} | ${intencao(r)} | ${r.resolvedTaskId ?? '-'} | ${r.tasksBefore?.length ?? '?'} | ${r.tasksAfter?.length ?? '?'} | ${r.invariantOk === undefined ? '?' : r.invariantOk ? 'OK' : '**VIOLADO**'} |`);
}

const violacoes = results.filter((r) => r.invariantOk === false);
const summary = `# FASE B.3 + B.9 — Reprodução ao vivo do invariante UPDATE≠CREATE

Data: ${new Date().toISOString()}
Cliente QA: Cliente Teste 7 (${CLIENT_ID}) — lista ClickUp = CLICKUP_TEST_LIST_ID (match confirmado via banco)
Conversa: ${conversationId}
Prefixo de contagem: "${PREFIX}" (tasks na lista QA cujo nome começa com o prefixo)

## B.3 — Bateria T00–T12 (conversa única, sequencial)

${linhas.join('\n')}

Violações do invariante (UPDATE→CREATE): ${violacoes.length === 0 ? 'nenhuma' : violacoes.map((v) => v.turn).join(', ')}

## B.9 — Idempotência ao vivo (mensagem DUP TEST)

### DUP1 — dois envios simultâneos (Promise.all, mesma conversa)
- HTTP acks: ${dup1.sends.map((s) => s.httpStatus).join(' + ')} (esperado: 202 + 409 ou replay deduplicated)
- deduplicated: ${dup1.sends.map((s) => Boolean(s.body?.deduplicated)).join(' / ')}
- DUP TEST no ClickUp antes: ${dup1.dupBefore.length} | depois: ${dup1.dupAfter.length} (esperado: 1)

### DUP2 — dois envios com 20s de intervalo (fora da janela de 15s)
- HTTP acks: ${dup2.sends.map((s) => s.httpStatus).join(' + ')}
- DUP TEST no ClickUp antes: ${dup2.dupBefore.length} | depois: ${dup2.dupAfter.length}
- Limite real da proteção: ${dup2.dupAfter.length > dup2.dupBefore.length ? 'fora da janela de 15s a dedup HTTP NÃO segura — a segunda criação passou (ou foi barrada só por dedup de nome no executor, ver DUP2.json)' : 'mesmo fora da janela, nenhuma task nova — dedup de nome no executor segurou'}

## B.2 — Cobertura dos logs do worker
Por turno, as linhas de /tmp/desigual-worker.log contendo o execution_id estão no campo workerLog de cada TXX.json.
Turnos sem nenhuma linha correlacionada: ${results.filter((r) => r.workerLog && !r.workerLog.found).map((r) => r.turn).join(', ') || 'nenhum'}
`;

writeFileSync(new URL('SUMMARY.md', OUT_DIR), summary, { mode: 0o600 });
writeFileSync(new URL('battery.json', OUT_DIR), JSON.stringify({ results, dup1, dup2 }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ fim: new Date().toISOString(), violacoes: violacoes.map((v) => v.turn) }));
