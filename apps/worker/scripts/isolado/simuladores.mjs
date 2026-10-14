/**
 * simuladores.mjs — os serviços externos do Bento, simulados, num processo só.
 * Bento 3.1, 14/10/2026.
 *
 * Existe para rodar a API e o worker DE VERDADE (fila, Redis, Postgres,
 * orquestrador, contexto, permissão) sem gastar GPT, sem bater no ClickUp real
 * e sem tocar no Supabase de produção. O que é simulado é só o que custa
 * dinheiro ou muda dado de alguém:
 *
 *   /auth/v1/...   emissor de token no formato do Supabase (JWKS + RS256)
 *   /v1/...        OpenAI Responses e Embeddings
 *   /api/v2/...    ClickUp, com estado em memória
 *   /bento-qa/...  o serviço GPU legado, sempre fora do ar (503)
 *
 * Cada requisição fica registrada em /__log, para o teste conferir o que de
 * fato chegou ao modelo — não só o que o modelo simulado respondeu.
 *
 * Comportamento do "GPT" (latência, erro, timeout, fora do ar) muda em
 * runtime por POST /__config, sem reiniciar. Uso:
 *
 *   node apps/worker/scripts/isolado/simuladores.mjs   (porta SIM_PORT, padrão 4799)
 */
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';

const PORT = Number(process.env.SIM_PORT ?? 4799);
const INICIO = (Date.now() % 1_000_000).toString(36);
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- estado

const config = {
  llmLatencyMs: 900, // média
  llmJitterMs: 400,
  llmErrorRate: 0, // fração de 500
  llmTimeoutRate: 0, // fração que nunca responde a tempo
  llmTimeoutMs: 130_000, // maior que o REQUEST_TIMEOUT do cliente
  llmDown: false, // todo pedido devolve 503
  clickupLatencyMs: 120,
  clickupRatePerMin: 0, // 0 = sem limite
};

const log = []; // { at, service, method, path, body? }
const LOG_MAX = 20_000;
function registrar(entry) {
  log.push({ at: Date.now(), ...entry });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

const clickup = {
  teamId: 'team-qa',
  members: [], // { id, email, username }
  lists: new Map(), // id -> { id, name, folder?, space? }
  tasks: new Map(), // id -> task cru no formato da API
  comments: new Map(), // taskId -> [{ id, comment_text, user, date }]
  seq: 1000,
  reqsDoMinuto: [],
};

// ---------------------------------------------------------------- auth

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'bento31-isolado';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function emitirToken({ sub, email, name }) {
  const agora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    sub,
    email,
    aud: 'authenticated',
    iss: `${BASE}/auth/v1`,
    iat: agora,
    exp: agora + 6 * 3600,
    role: 'authenticated',
    user_metadata: name ? { name } : {},
  };
  const corpo = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const assinatura = sign('sha256', Buffer.from(corpo), privateKey);
  return `${corpo}.${b64url(assinatura)}`;
}

// ---------------------------------------------------------------- GPT

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokensDe = (texto) => Math.max(1, Math.ceil(String(texto ?? '').length / 4));

function respostaResponses(texto, body) {
  const entrada = `${body.instructions ?? ''}\n${typeof body.input === 'string' ? body.input : JSON.stringify(body.input ?? '')}`;
  const input_tokens = tokensDe(entrada);
  const output_tokens = tokensDe(texto);
  return {
    id: `resp_${randomUUID()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: body.model ?? 'gpt-simulado',
    output: [
      {
        type: 'message',
        id: `msg_${randomUUID()}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: texto, annotations: [] }],
      },
    ],
    usage: {
      input_tokens,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: input_tokens + output_tokens,
    },
  };
}

function textoDoInput(body) {
  if (typeof body.input === 'string') return body.input;
  if (Array.isArray(body.input)) {
    return body.input
      .map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join('\n')))
      .join('\n');
  }
  return '';
}

/** O pedido do usuário, como cada chamada o embute. */
function pedidoDo(input) {
  const m =
    input.match(/Pedido do usuário:\s*([\s\S]*?)$/) ??
    input.match(/PERGUNTA[^\n]*\n([\s\S]*?)(\n[A-ZÇÃ ]{6,}\n|$)/) ??
    null;
  return (m?.[1] ?? input).trim().slice(0, 600);
}

function planejar(pedido) {
  const p = pedido.toLowerCase();
  const base = { target: null, changes: null, requestedCardinality: 0, reasoning: 'simulado' };
  const idTask = pedido.match(/\b(qa[a-z0-9]{2,})\b/i)?.[1] ?? null;
  if (/\b(cria|crie|criar|lança|lance|abre uma task)\b/.test(p)) {
    const titulo = pedido.match(/["“](.+?)["”]/)?.[1] ?? 'Tarefa de teste do Bento 3.1';
    return { ...base, intent: 'create_task', changes: { title: titulo }, requestedCardinality: 1 };
  }
  if (/prioridade/.test(p) && idTask) {
    const prioridade = /urgente/.test(p) ? 'urgent' : /alta/.test(p) ? 'high' : /baixa/.test(p) ? 'low' : 'normal';
    return {
      ...base,
      intent: 'update_task',
      target: { resourceType: 'CLICKUP_TASK', resourceId: idTask },
      changes: { priority: prioridade },
      requestedCardinality: 1,
    };
  }
  return { ...base, intent: 'read_tasks' };
}

/**
 * Resposta de leitura: devolve as linhas de tarefa e de pessoa que o contexto
 * entregou, como o modelo real faria ao citar. Assim o teste confere o dado
 * que o pipeline montou, e não uma frase inventada pelo simulador.
 */
function responderLeitura(input) {
  const linhas = input.split('\n');
  const tarefas = linhas.filter((l) => /^\s*[-•*]\s.*(venc|atras|prazo|respons|status|\bQA\b)/i.test(l)).slice(0, 15);
  const quem = linhas.find((l) => /quem (está )?pergunt|você está falando com|pessoa que pergunta/i.test(l));
  const partes = [];
  if (quem) partes.push(`(contexto de identidade) ${quem.trim()}`);
  if (tarefas.length) partes.push(`Encontrei ${tarefas.length} item(ns) no contexto:\n${tarefas.join('\n')}`);
  else partes.push('Não encontrei isso registrado no que tenho da operação.');
  return partes.join('\n\n');
}

async function tratarResponses(body, res) {
  const instructions = String(body.instructions ?? '');
  const input = textoDoInput(body);
  const chamada = instructions.includes('"primary_agent"')
    ? 'classificador'
    : instructions.includes('requestedCardinality') || instructions.includes('read_tasks')
      ? 'planejador'
      : 'leitura';
  registrar({ service: 'openai', method: 'POST', path: '/v1/responses', chamada, model: body.model, instructions, input });

  if (config.llmDown) return enviar(res, 503, { error: { message: 'simulado: provedor fora do ar', type: 'server_error' } });
  if (Math.random() < config.llmTimeoutRate) {
    await sleep(config.llmTimeoutMs);
    return enviar(res, 504, { error: { message: 'simulado: timeout' } });
  }
  await sleep(Math.max(0, config.llmLatencyMs + (Math.random() * 2 - 1) * config.llmJitterMs));
  if (Math.random() < config.llmErrorRate) {
    return enviar(res, 500, { error: { message: 'simulado: erro interno do provedor', type: 'server_error' } });
  }

  let texto;
  if (chamada === 'classificador') {
    texto = JSON.stringify({
      intent: 'pergunta operacional',
      primary_agent: 'bento',
      required_tools: ['clickup'],
      estimated_complexity: 'low',
      workflow: null,
    });
  } else if (chamada === 'planejador') {
    texto = JSON.stringify(planejar(pedidoDo(input)));
  } else {
    texto = responderLeitura(input);
  }
  return enviar(res, 200, respostaResponses(texto, body));
}

function embedding(texto, dim = 1536) {
  const v = new Array(dim);
  let h = createHash('sha256').update(String(texto)).digest();
  for (let i = 0; i < dim; i += 1) {
    if (i % 32 === 0 && i > 0) h = createHash('sha256').update(h).digest();
    v[i] = (h[i % 32] - 127.5) / 127.5;
  }
  return v;
}

// ---------------------------------------------------------------- ClickUp

function tarefaComoApi(t) {
  return { ...t, url: `https://app.clickup.com/t/${t.id}` };
}

function filtrarTarefas(params) {
  const listas = params.getAll('list_ids[]');
  const responsaveis = params.getAll('assignees[]').map(Number);
  const status = params.getAll('statuses[]');
  const incluiFechadas = params.get('include_closed') === 'true';
  const dueLt = params.get('due_date_lt');
  const dueGt = params.get('due_date_gt');
  const semPrazo = params.get('due_date_null') === 'true';
  return [...clickup.tasks.values()].filter((t) => {
    if (listas.length && !listas.includes(t.list?.id)) return false;
    if (responsaveis.length && !(t.assignees ?? []).some((a) => responsaveis.includes(a.id))) return false;
    if (status.length && !status.includes(t.status?.status)) return false;
    if (!incluiFechadas && ['closed', 'done'].includes(t.status?.type)) return false;
    if (semPrazo && t.due_date) return false;
    if (dueLt && !(t.due_date && Number(t.due_date) < Number(dueLt))) return false;
    if (dueGt && !(t.due_date && Number(t.due_date) > Number(dueGt))) return false;
    return true;
  });
}

const PRIORIDADES = { 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };

function aplicarCampos(t, body) {
  if (body.name !== undefined) t.name = body.name;
  if (body.description !== undefined) {
    t.description = body.description;
    t.text_content = body.description;
  }
  if (body.markdown_description !== undefined) {
    t.description = body.markdown_description;
    t.text_content = body.markdown_description;
  }
  if (body.status !== undefined) t.status = { status: body.status, type: /conclu|done|closed/i.test(body.status) ? 'closed' : 'open', color: '#ccc' };
  if (body.priority !== undefined) {
    t.priority = body.priority === null ? null : { id: String(body.priority), priority: PRIORIDADES[body.priority] ?? 'normal', color: '#f8ae00' };
  }
  if (body.due_date !== undefined) t.due_date = body.due_date === null ? null : String(body.due_date);
  if (body.start_date !== undefined) t.start_date = body.start_date === null ? null : String(body.start_date);
  const porId = (id) => clickup.members.find((m) => m.id === Number(id));
  if (Array.isArray(body.assignees)) t.assignees = body.assignees.map(porId).filter(Boolean);
  if (body.assignees && !Array.isArray(body.assignees)) {
    const add = (body.assignees.add ?? []).map(porId).filter(Boolean);
    const rem = new Set((body.assignees.rem ?? []).map(Number));
    t.assignees = [...(t.assignees ?? []).filter((a) => !rem.has(a.id)), ...add.filter((a) => !(t.assignees ?? []).some((x) => x.id === a.id))];
  }
  if (Array.isArray(body.tags)) t.tags = body.tags.map((name) => ({ name }));
  t.date_updated = String(Date.now());
}

function limiteDoClickUp(res) {
  if (!config.clickupRatePerMin) return false;
  const agora = Date.now();
  clickup.reqsDoMinuto = clickup.reqsDoMinuto.filter((t) => agora - t < 60_000);
  if (clickup.reqsDoMinuto.length >= config.clickupRatePerMin) {
    res.setHeader('retry-after', '1');
    enviar(res, 429, { err: 'Rate limit reached', ECODE: 'APP_002' });
    return true;
  }
  clickup.reqsDoMinuto.push(agora);
  return false;
}

async function tratarClickUp(method, path, params, body, res) {
  registrar({ service: 'clickup', method, path, body: method === 'GET' ? undefined : body });
  if (limiteDoClickUp(res)) return;
  await sleep(config.clickupLatencyMs);
  const seg = path.replace(/^\/api\/v2\//, '').split('/');

  if (seg[0] === 'team' && seg.length === 2 && method === 'GET') {
    return enviar(res, 200, { team: { id: clickup.teamId, members: clickup.members.map((user) => ({ user })) } });
  }
  if (seg[0] === 'team' && seg[2] === 'task' && method === 'GET') {
    const todas = filtrarTarefas(params);
    const pagina = Number(params.get('page') ?? 0);
    const fatia = todas.slice(pagina * 100, pagina * 100 + 100).map(tarefaComoApi);
    return enviar(res, 200, { tasks: fatia, last_page: (pagina + 1) * 100 >= todas.length });
  }
  if (seg[0] === 'list' && seg.length === 2 && method === 'GET') {
    const lista = clickup.lists.get(seg[1]);
    return lista ? enviar(res, 200, { ...lista, statuses: [{ status: 'to do' }, { status: 'em andamento' }, { status: 'concluído', type: 'closed' }] }) : enviar(res, 404, { err: 'List not found' });
  }
  if (seg[0] === 'list' && seg[2] === 'task' && seg.length === 3 && method === 'POST') {
    const lista = clickup.lists.get(seg[1]);
    if (!lista) return enviar(res, 404, { err: 'List not found' });
    // Prefixo do processo: reiniciar o simulador não pode reaproveitar id
    // (a auditoria e a idempotência são indexadas por ele).
    const id = `qa${INICIO}${(clickup.seq += 1).toString(36)}`;
    const t = {
      id,
      name: body.name ?? '(sem nome)',
      status: { status: 'to do', type: 'open', color: '#ccc' },
      priority: null,
      due_date: null,
      start_date: null,
      assignees: [],
      tags: [],
      watchers: [],
      checklists: [],
      attachments: [],
      list: { id: lista.id, name: lista.name },
      folder: lista.folder ?? null,
      space: lista.space ?? null,
      date_created: String(Date.now()),
      date_updated: String(Date.now()),
      parent: body.parent ?? null,
    };
    aplicarCampos(t, body);
    clickup.tasks.set(id, t);
    return enviar(res, 200, tarefaComoApi(t));
  }
  if (seg[0] === 'task' && seg.length === 2) {
    const t = clickup.tasks.get(seg[1]);
    if (!t) return enviar(res, 404, { err: 'Task not found, deleted', ECODE: 'ITEM_013' });
    if (method === 'GET') return enviar(res, 200, tarefaComoApi(t));
    if (method === 'PUT') {
      aplicarCampos(t, body);
      return enviar(res, 200, tarefaComoApi(t));
    }
    if (method === 'DELETE') {
      clickup.tasks.delete(seg[1]);
      return enviar(res, 204, null);
    }
  }
  if (seg[0] === 'task' && seg[2] === 'comment') {
    const lista = clickup.comments.get(seg[1]) ?? [];
    if (method === 'GET') return enviar(res, 200, { comments: lista });
    if (method === 'POST') {
      const c = { id: String((clickup.seq += 1)), comment_text: body.comment_text ?? '', user: { id: 1, username: 'bento' }, date: String(Date.now()) };
      lista.unshift(c);
      clickup.comments.set(seg[1], lista);
      return enviar(res, 200, { id: c.id, hist_id: c.id, date: Number(c.date) });
    }
  }
  if (seg[0] === 'task' && seg[2] === 'tag') {
    const t = clickup.tasks.get(seg[1]);
    if (!t) return enviar(res, 404, { err: 'Task not found' });
    const nome = decodeURIComponent(seg[3]);
    t.tags = (t.tags ?? []).filter((x) => x.name !== nome);
    if (method === 'POST') t.tags.push({ name: nome });
    return enviar(res, 200, {});
  }
  return enviar(res, 404, { err: `simulador: rota não implementada ${method} ${path}` });
}

// ---------------------------------------------------------------- http

function enviar(res, status, corpo) {
  if (res.headersSent) return;
  if (corpo === null) {
    res.writeHead(status);
    return res.end();
  }
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(texto);
}

async function lerCorpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  const texto = Buffer.concat(partes).toString('utf8');
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    return { _raw: texto };
  }
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    const path = url.pathname;
    const body = req.method === 'GET' ? {} : await lerCorpo(req);

    if (path === '/auth/v1/.well-known/jwks.json') return enviar(res, 200, { keys: [jwk] });
    if (path === '/__token' && req.method === 'POST') return enviar(res, 200, { token: emitirToken(body) });
    if (path === '/__config' && req.method === 'POST') {
      Object.assign(config, body);
      return enviar(res, 200, config);
    }
    if (path === '/__config') return enviar(res, 200, config);
    if (path === '/__log' && req.method === 'DELETE') {
      log.length = 0;
      return enviar(res, 204, null);
    }
    if (path === '/__log') {
      const desde = Number(url.searchParams.get('desde') ?? 0);
      const servico = url.searchParams.get('servico');
      return enviar(res, 200, log.filter((e) => e.at >= desde && (!servico || e.service === servico)));
    }
    if (path === '/__clickup/seed' && req.method === 'POST') {
      clickup.teamId = body.teamId ?? clickup.teamId;
      clickup.members = body.members ?? [];
      clickup.lists = new Map((body.lists ?? []).map((l) => [l.id, l]));
      clickup.tasks = new Map((body.tasks ?? []).map((t) => [t.id, t]));
      clickup.comments = new Map();
      return enviar(res, 200, { tasks: clickup.tasks.size, members: clickup.members.length });
    }
    if (path === '/__clickup/state') return enviar(res, 200, { tasks: [...clickup.tasks.values()] });

    if (path.startsWith('/v1/responses') && req.method === 'POST') return await tratarResponses(body, res);
    if (path.startsWith('/v1/embeddings') && req.method === 'POST') {
      registrar({ service: 'openai', method: 'POST', path, chamada: 'embedding' });
      const entradas = Array.isArray(body.input) ? body.input : [body.input];
      return enviar(res, 200, {
        object: 'list',
        data: entradas.map((e, index) => ({ object: 'embedding', index, embedding: embedding(e, body.dimensions ?? 1536) })),
        model: body.model ?? 'text-embedding-simulado',
        usage: { prompt_tokens: tokensDe(entradas.join(' ')), total_tokens: tokensDe(entradas.join(' ')) },
      });
    }
    if (path.startsWith('/api/v2/')) return await tratarClickUp(req.method, path, url.searchParams, body, res);
    if (path.startsWith('/bento-qa')) {
      registrar({ service: 'bento-qa', method: req.method, path });
      return enviar(res, 503, { error: 'simulado: GPU fora do ar' });
    }
    return enviar(res, 404, { error: `simulador: nada em ${req.method} ${path}` });
  } catch (error) {
    return enviar(res, 500, { error: String(error?.stack ?? error) });
  }
});

servidor.keepAliveTimeout = 65_000;
servidor.listen(PORT, '127.0.0.1', () => {
  console.log(`simuladores no ar em ${BASE}`);
});
