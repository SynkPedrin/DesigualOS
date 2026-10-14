/**
 * turno.mjs — um turno de chat de ponta a ponta no ambiente isolado.
 *
 * POST /chat autenticado como a pessoa → espera a execução terminar →
 * devolve resposta, metadata e TUDO que chegou ao GPT simulado no período.
 *
 * Usado pelos cenários de ouro, pelo teste de carga e à mão:
 *   node apps/worker/scripts/isolado/turno.mjs ana "Quais são minhas tarefas atrasadas?"
 */
import { fileURLToPath } from 'node:url';

export const API = process.env.API_URL ?? 'http://127.0.0.1:4791';
export const SIM = `http://127.0.0.1:${process.env.SIM_PORT ?? 4799}`;

export const PESSOAS = {
  ana: { sub: '0a000000-0000-4000-8000-0000000001a1', email: 'ana@qa.bento31.test', name: 'Ana QA', org: '0a000000-0000-4000-8000-00000000000a' },
  bruno: { sub: '0a000000-0000-4000-8000-0000000001b2', email: 'bruno@qa.bento31.test', name: 'Bruno QA', org: '0a000000-0000-4000-8000-00000000000a' },
  carla: { sub: '0b000000-0000-4000-8000-0000000001c3', email: 'carla@qa.bento31.test', name: 'Carla QA', org: '0b000000-0000-4000-8000-00000000000b' },
};

const tokens = new Map();
export async function token(quem) {
  if (!tokens.has(quem)) {
    const r = await fetch(`${SIM}/__token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(PESSOAS[quem]) });
    tokens.set(quem, (await r.json()).token);
  }
  return tokens.get(quem);
}

export async function api(quem, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token(quem)}`,
      'x-organization-id': PESSOAS[quem].org,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    json = { _texto: texto };
  }
  return { status: r.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Um turno inteiro. `opts.conversa` continua uma conversa; `opts.cliente`
 * fixa o cliente; `opts.timeoutMs` é o teto de espera pela execução.
 */
export async function turno(quem, mensagem, opts = {}) {
  const inicio = Date.now();
  const envio = await api(quem, 'POST', '/chat', {
    message: mensagem,
    agent_hint: opts.agente ?? 'BENTO',
    ...(opts.conversa ? { conversation_id: opts.conversa } : {}),
    ...(opts.cliente ? { client_id: opts.cliente } : {}),
  });
  const ack = Date.now() - inicio;
  if (envio.status !== 202) return { ok: false, fase: 'envio', status: envio.status, corpo: envio.json, ms: ack };

  const id = envio.json.execution_id;
  const teto = Date.now() + (opts.timeoutMs ?? 180_000);
  let exec;
  while (Date.now() < teto) {
    const r = await api(quem, 'GET', `/executions/${id}`);
    exec = r.json;
    const st = exec?.status ?? exec?.execution?.status;
    if (['completed', 'failed', 'cancelled', 'timeout', 'blocked'].includes(st)) break;
    await sleep(opts.pollMs ?? 400);
  }
  const fim = Date.now();
  const llm = opts.semLog ? [] : await (await fetch(`${SIM}/__log?servico=openai&desde=${inicio}`)).json();
  return {
    ok: true,
    mensagem,
    execucao: id,
    conversa: envio.json.conversation_id,
    agente: envio.json.agent,
    status: exec?.status ?? exec?.execution?.status,
    exec,
    ms: fim - inicio,
    ackMs: ack,
    llm: llm.filter((e) => e.chamada !== 'embedding'),
  };
}

/** Texto final da resposta, onde quer que o contrato de execução o ponha. */
export function respostaDe(r) {
  const e = r.exec ?? {};
  const passos = e.steps ?? e.execution_steps ?? [];
  const doPasso = passos.map((p) => p.output?.answer ?? p.output?.text ?? '').filter(Boolean).join('\n');
  return e.answer ?? e.result?.answer ?? e.output?.answer ?? doPasso ?? '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [quem, ...resto] = process.argv.slice(2);
  const r = await turno(quem, resto.join(' '));
  console.log(JSON.stringify({ ...r, exec: r.exec, llm: (r.llm ?? []).map((e) => ({ chamada: e.chamada, model: e.model, input: e.input?.slice(0, 6000) })) }, null, 2));
}
