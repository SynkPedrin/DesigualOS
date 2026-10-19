/**
 * prova-ator-end-to-end.mts — runtime de aceite do bloco "Claude actor end-to-end".
 *
 * Não é teste unitário: emite credenciais de conexão pela MESMA função que o
 * master flow usa (`emitirCredencialDeConexao`), fala com o servidor MCP que
 * está NO AR (POST /mcp, bearer, protocolo JSON-RPC como o Claude fala) e lê
 * do BANCO o que ficou gravado — o operational_event e a memory, não a resposta
 * da tool. O que a prova cria, ela apaga (memórias, eventos de negócio,
 * telemetria e evento de conexão da janela) e revoga as credenciais mintadas.
 *
 * Três atores, três vereditos:
 *   1. PERSON  — credencial de "Pedro Claude": recorded_by = Pedro Claude,
 *                actor_type = 'person', authorized_by = master.
 *   2. SHARED  — credencial de "Equipe Atendimento": recorded_by = Equipe
 *                Atendimento, actor_type = 'shared_account', e NENHUM nome de
 *                membro (Tammy/Alicia/Jamile) em campo nenhum; o nome do master
 *                só pode aparecer nos campos designados de autorizador
 *                (authorized_by / authorized_by_user_id), nunca como autoria.
 *   3. LEGADO  — token OAuth de sempre (kind 'access', sem actor_identity_id,
 *                emitido por `emitirTokens`, a função do /token): recorded_by =
 *                dono do login, sem NENHUM campo novo de ator.
 *
 * O turno do Bento (passo 5) é EVIDÊNCIA, não veredito: 1 turno de LLM não
 * aprova nem reprova. A prova determinística é metadata + payload acima.
 *
 * Pré-requisitos:
 *   - MCP no ar (PORT/MCP_PORT, default 3010) e API no ar (127.0.0.1:3001);
 *   - /tmp/desigual-qa-token vivo para o turno do Bento (node scripts/qa/login.mjs).
 *
 * Uso: pnpm --filter @desigual-os/mcp exec tsx scripts/prova-ator-end-to-end.mts
 */
import { readFileSync } from 'node:fs';

process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname);

const { and, eq, gte, inArray } = await import('drizzle-orm');
const { db, schema } = await import('@desigual-os/database');
const { emitirCredencialDeConexao, emitirTokens, revogarPorValor } = await import('../src/auth/token-store.js');

const ORG = process.env.PROVIDER_ORGANIZATION_ID!.trim();
const MCP_BASE = process.env.PROVA_MCP_URL ?? `http://127.0.0.1:${process.env.MCP_PORT ?? 3010}`;
const API_BASE = process.env.QA_API_BASE ?? 'http://127.0.0.1:3001';
const CLIENTE_QA = '3f1849a0-8682-45df-8ea2-b74be305f98b'; // "Cliente Teste 7"
const CLIENT_ID = 'prova-ator-e2e';
const RUN = `prova-ator-${Date.now().toString(36)}`;
const INICIO = new Date();

let falhas = 0;
const ok = (rotulo: string, condicao: boolean, detalhe = '') => {
  if (!condicao) falhas += 1;
  console.log(`  ${condicao ? 'PASSOU' : 'FALHOU'}  ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
};

// ── Fixture do banco ────────────────────────────────────────────────────────
await db.insert(schema.mcpClients).values({
  clientId: CLIENT_ID, clientName: 'Prova ator end-to-end', redirectUris: [], grantTypes: [],
  scopes: ['desigual.read', 'desigual.write', 'memory.read', 'memory.write'],
}).onConflictDoNothing();

const [master] = await db.select({ id: schema.users.id, name: schema.users.name })
  .from(schema.users).where(eq(schema.users.email, 'pedro@institutoalmada.org'));
const identidade = async (externalId: string) => (await db.select()
  .from(schema.operationalIdentities)
  .where(and(eq(schema.operationalIdentities.organizationId, ORG), eq(schema.operationalIdentities.externalId, externalId))))[0]!;
const pedroClaude = await identidade('claude-pedro');
const atendimento = await identidade('claude-atendimento');
const SCOPES = ['desigual.read', 'desigual.write', 'memory.read', 'memory.write'];

// ── Cliente JSON-RPC mínimo, igual ao que o e2e-oauth.mjs fala ─────────────
async function rpc(token: string, method: string, params?: unknown): Promise<any> {
  const r = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, ...(params ? { params } : {}) }),
  });
  const texto = await r.text();
  const linha = texto.split('\n').find((l) => l.startsWith('data: '));
  try { return JSON.parse(linha ? linha.slice(6) : texto); } catch { return { __raw: texto.slice(0, 300), __status: r.status }; }
}

async function inicializar(token: string): Promise<boolean> {
  const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prova-ator', version: '1.0.0' } });
  return init.result?.serverInfo?.name === 'desigual-os';
}

async function gravarFeedback(token: string, marca: string): Promise<{ memoryId: string | null; bruto: any }> {
  const resp = await rpc(token, 'tools/call', {
    name: 'save_client_feedback',
    arguments: {
      client_id: CLIENTE_QA,
      feedback: `Preferência de prova ${marca}: o cliente quer tom informal e sem jargão em todos os criativos.`,
    },
  });
  const texto = resp.result?.content?.[0]?.text ?? '';
  let parsed: any = {};
  try { parsed = JSON.parse(texto); } catch { /* erro da tool vem como texto livre */ }
  return { memoryId: parsed.memory_id ?? null, bruto: resp.error ?? parsed ?? texto.slice(0, 200) };
}

async function lerMemoria(id: string) {
  return (await db.select().from(schema.memories).where(eq(schema.memories.id, id)))[0] ?? null;
}
async function lerEventoDaMemoria(id: string) {
  return (await db.select().from(schema.operationalEvents)
    .where(and(eq(schema.operationalEvents.entityType, 'memory'), eq(schema.operationalEvents.entityId, id))))[0] ?? null;
}

const MEMBROS_ATENDIMENTO = ['tammy', 'alicia', 'jamile'];
/** Procura nomes proibidos em TODO o objeto, exceto nos campos designados de autorizador. */
function camposComNomesProibidos(obj: unknown, nomeMaster: string, caminho = ''): string[] {
  const achados: string[] = [];
  if (obj === null || obj === undefined) return achados;
  if (typeof obj === 'string') {
    const v = obj.toLowerCase();
    const ehCampoDeAutorizador = /(^|\.)authorized_by(_user_id)?$/.test(caminho);
    for (const nome of MEMBROS_ATENDIMENTO) if (v.includes(nome)) achados.push(`${caminho} contém membro "${nome}"`);
    if (!ehCampoDeAutorizador && nomeMaster && v.includes(nomeMaster.toLowerCase())) achados.push(`${caminho} contém o master "${nomeMaster}" fora de authorized_by`);
    return achados;
  }
  if (Array.isArray(obj)) return obj.flatMap((item, i) => camposComNomesProibidos(item, nomeMaster, `${caminho}[${i}]`));
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) achados.push(...camposComNomesProibidos(v, nomeMaster, caminho ? `${caminho}.${k}` : k));
  }
  return achados;
}

// Estado para a limpeza no finally, aconteça o que acontecer.
const memoriasCriadas: string[] = [];
const tokensParaRevogar: string[] = [];
let respostaBento = '(não executado)';

try {
  console.log(`\nPROVA ATOR END-TO-END — ${MCP_BASE} — marca ${RUN}\n`);

  // ── PASSO 1: PERSON ──────────────────────────────────────────────────────
  console.log('PASSO 1 — PERSON (credencial de "Pedro Claude")');
  const cPerson = await emitirCredencialDeConexao({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, actorIdentityId: pedroClaude.id, scopes: SCOPES });
  tokensParaRevogar.push(cPerson.credencial);
  const marcaPerson = `${RUN}-person`;
  ok('initialize no MCP real', await inicializar(cPerson.credencial));
  const person = await gravarFeedback(cPerson.credencial, marcaPerson);
  ok('save_client_feedback aceito', !!person.memoryId, JSON.stringify(person.bruto).slice(0, 160));
  if (person.memoryId) {
    memoriasCriadas.push(person.memoryId);
    const mem = await lerMemoria(person.memoryId);
    const meta = (mem?.metadata ?? {}) as Record<string, unknown>;
    const ev = await lerEventoDaMemoria(person.memoryId);
    const payload = (ev?.payload ?? {}) as Record<string, unknown>;
    ok('memory.metadata.recorded_by = Pedro Claude', meta.recorded_by === 'Pedro Claude', String(meta.recorded_by));
    ok('memory.metadata.actor_identity_id = id Pedro Claude', meta.actor_identity_id === pedroClaude.id);
    ok('memory.metadata.actor_type = person', meta.actor_type === 'person', String(meta.actor_type));
    ok('memory.metadata.authorized_by = master', meta.authorized_by === master!.name, String(meta.authorized_by));
    ok('evento CLIENT_FEEDBACK gravado', !!ev && ev!.type === 'CLIENT_FEEDBACK', ev?.id ?? 'ausente');
    ok('evento.actor = Pedro Claude', ev?.actor === 'Pedro Claude', String(ev?.actor));
    ok('evento.payload.actor_identity_id correto', payload.actor_identity_id === pedroClaude.id);
    ok('evento.payload.actor_type = person', payload.actor_type === 'person', String(payload.actor_type));
    ok('evento.payload.actor = Pedro Claude', payload.actor === 'Pedro Claude', String(payload.actor));
    ok('evento.payload.authorized_by_user_id = master', payload.authorized_by_user_id === master!.id);
    console.log(`    evidência: memory=${person.memoryId} event=${ev?.id}`);
  }

  // ── PASSO 2: SHARED ──────────────────────────────────────────────────────
  console.log('\nPASSO 2 — SHARED (credencial de "Equipe Atendimento")');
  const cShared = await emitirCredencialDeConexao({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, actorIdentityId: atendimento.id, scopes: SCOPES });
  tokensParaRevogar.push(cShared.credencial);
  const marcaShared = `${RUN}-shared`;
  ok('initialize no MCP real', await inicializar(cShared.credencial));
  const shared = await gravarFeedback(cShared.credencial, marcaShared);
  ok('save_client_feedback aceito', !!shared.memoryId, JSON.stringify(shared.bruto).slice(0, 160));
  if (shared.memoryId) {
    memoriasCriadas.push(shared.memoryId);
    const mem = await lerMemoria(shared.memoryId);
    const meta = (mem?.metadata ?? {}) as Record<string, unknown>;
    const ev = await lerEventoDaMemoria(shared.memoryId);
    const payload = (ev?.payload ?? {}) as Record<string, unknown>;
    ok('memory.metadata.recorded_by = Equipe Atendimento', meta.recorded_by === 'Equipe Atendimento', String(meta.recorded_by));
    ok('memory.metadata.actor_type = shared_account', meta.actor_type === 'shared_account', String(meta.actor_type));
    ok('memory.metadata.actor_identity_id = id Equipe Atendimento', meta.actor_identity_id === atendimento.id);
    ok('evento.actor = Equipe Atendimento', ev?.actor === 'Equipe Atendimento', String(ev?.actor));
    ok('evento.payload.authorized_by_user_id = master', payload.authorized_by_user_id === master!.id);
    const proibidos = [
      ...camposComNomesProibidos(meta, master!.name, 'metadata'),
      ...camposComNomesProibidos(payload, master!.name, 'payload'),
      ...camposComNomesProibidos({ actor: ev?.actor }, master!.name, 'evento'),
    ];
    ok('NENHUM nome de membro (Tammy/Alicia/Jamile) nem master como autoria', proibidos.length === 0, proibidos.join('; ') || 'limpo');
    console.log(`    evidência: memory=${shared.memoryId} event=${ev?.id} | metadata=${JSON.stringify(meta)}`);
  }

  // ── PASSO 3: LEGADO ──────────────────────────────────────────────────────
  console.log('\nPASSO 3 — LEGADO (token OAuth kind access, sem actor_identity_id)');
  const parLegado = await emitirTokens({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, scopes: SCOPES });
  tokensParaRevogar.push(parLegado.refreshToken); // revogar o refresh derruba a família inteira
  const marcaLegado = `${RUN}-legado`;
  ok('initialize no MCP real', await inicializar(parLegado.accessToken));
  const legado = await gravarFeedback(parLegado.accessToken, marcaLegado);
  ok('save_client_feedback aceito', !!legado.memoryId, JSON.stringify(legado.bruto).slice(0, 160));
  if (legado.memoryId) {
    memoriasCriadas.push(legado.memoryId);
    const mem = await lerMemoria(legado.memoryId);
    const meta = (mem?.metadata ?? {}) as Record<string, unknown>;
    const ev = await lerEventoDaMemoria(legado.memoryId);
    const payload = (ev?.payload ?? {}) as Record<string, unknown>;
    ok('memory.metadata.recorded_by = dono do login', meta.recorded_by === master!.name, String(meta.recorded_by));
    const camposNovosNaMemoria = ['actor_identity_id', 'actor_type', 'authorized_by'].filter((k) => k in meta);
    ok('memory SEM campos novos de ator ({} do helper)', camposNovosNaMemoria.length === 0, camposNovosNaMemoria.join(',') || 'nenhum');
    const camposNovosNoEvento = ['actor_identity_id', 'actor', 'actor_type', 'authorized_by_user_id'].filter((k) => k in payload);
    ok('evento SEM campos novos de ator', camposNovosNoEvento.length === 0, camposNovosNoEvento.join(',') || 'nenhum');
    ok('evento.actor = dono do login', ev?.actor === master!.name, String(ev?.actor));
    console.log(`    evidência: memory=${legado.memoryId} event=${ev?.id}`);
  }

  // ── PASSO 5 (antes da limpeza): 1 turno do Bento, evidência verbatim ─────
  console.log('\nPASSO 5 — Bento, 1 turno ao vivo (EVIDÊNCIA, não veredito)');
  let tokenApi: string | null = null;
  try { tokenApi = readFileSync('/tmp/desigual-qa-token', 'utf8').trim(); } catch { /* sem token */ }
  if (!tokenApi) {
    respostaBento = '(pulado: /tmp/desigual-qa-token ausente — rode node scripts/qa/login.mjs)';
    console.log(`  ${respostaBento}`);
  } else {
    const pergunta = `Quem registrou a preferência ${marcaShared} do Cliente Teste 7?`;
    const headers = { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' };
    const ack = await fetch(`${API_BASE}/chat`, { method: 'POST', headers, body: JSON.stringify({ message: pergunta, agent_hint: 'AUTO' }) });
    const corpo = await ack.json().catch(() => ({}));
    if (!ack.ok) {
      respostaBento = `(falhou: HTTP ${ack.status} ${JSON.stringify(corpo).slice(0, 200)})`;
    } else {
      const executionId = corpo.execution_id;
      const convId = corpo.conversation_id;
      const limite = Date.now() + 300_000;
      let ultimo: any = null;
      while (Date.now() < limite) {
        await new Promise((s) => setTimeout(s, 2000));
        const er = await fetch(`${API_BASE}/executions/${executionId}`, { headers });
        if (!er.ok) continue;
        ultimo = await er.json();
        const status = ultimo.status ?? ultimo.execution?.status;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') break;
      }
      const steps = ultimo?.steps ?? ultimo?.execution_steps ?? [];
      const output = steps[steps.length - 1]?.output ?? ultimo?.output ?? {};
      let texto = typeof output === 'string' ? output : output.response ?? output.answer ?? output.text ?? '';
      if (!String(texto).trim() || texto === '{}') {
        try {
          const mr = await fetch(`${API_BASE}/conversations/${convId}/messages`, { headers });
          const msgs = await mr.json();
          const lista = Array.isArray(msgs) ? msgs : msgs.messages ?? [];
          texto = [...lista].reverse().find((m: any) => m.role === 'assistant')?.content ?? '';
        } catch { /* mantém vazio */ }
      }
      respostaBento = String(texto || `(sem texto; status=${ultimo?.status ?? ultimo?.execution?.status})`);
    }
    console.log(`  pergunta : ${pergunta}`);
    console.log(`  resposta (verbatim):\n  ${respostaBento.split('\n').join('\n  ')}`);
  }
} finally {
  // ── PASSO 4: LIMPEZA — a prova apaga a própria sujeira ───────────────────
  console.log('\nPASSO 4 — LIMPEZA');
  if (memoriasCriadas.length) {
    await db.delete(schema.operationalEvents).where(and(eq(schema.operationalEvents.entityType, 'memory'), inArray(schema.operationalEvents.entityId, memoriasCriadas)));
    await db.delete(schema.memories).where(inArray(schema.memories.id, memoriasCriadas));
    console.log(`  ${memoriasCriadas.length} memória(s) + eventos CLIENT_FEEDBACK removidos`);
  }
  // Telemetria (MCP_TOOL_CALLED) e conexão (CONNECTION_CREATED) gerados pelas
  // chamadas da prova dentro da janela: recorte por janela + cliente QA + master.
  const telemetria = await db.delete(schema.operationalEvents).where(and(
    eq(schema.operationalEvents.type, 'MCP_TOOL_CALLED'),
    eq(schema.operationalEvents.userId, master!.id),
    eq(schema.operationalEvents.clientId, CLIENTE_QA),
    gte(schema.operationalEvents.createdAt, INICIO),
  )).returning({ id: schema.operationalEvents.id });
  console.log(`  ${telemetria.length} evento(s) de telemetria da prova removidos`);
  const conexoes = await db.delete(schema.operationalEvents).where(and(
    eq(schema.operationalEvents.type, 'CONNECTION_CREATED'),
    eq(schema.operationalEvents.userId, master!.id),
    gte(schema.operationalEvents.createdAt, INICIO),
  )).returning({ id: schema.operationalEvents.id });
  console.log(`  ${conexoes.length} evento(s) CONNECTION_CREATED da janela removidos`);
  for (const t of tokensParaRevogar) await revogarPorValor(t);
  console.log(`  ${tokensParaRevogar.length} credencial(is)/família(s) revogada(s)`);
  console.log('  (mcp_sessions e audit_logs ficam: são trilha de auditoria, não dado de negócio falsificado)');
}

console.log(`\n${falhas === 0 ? '✓ PROVA PASSOU' : `✗ ${falhas} verificação(ões) FALHARAM`}`);
console.log(`RESPOSTA_BENTO_VERBATIM>>>${respostaBento}<<<FIM`);
process.exit(falhas === 0 ? 0 : 1);
