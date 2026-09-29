/**
 * aceite.mts — a bateria de aceite do control plane.
 *
 * Prova as coisas que só aparecem com MAIS DE UM usuário: isolamento de
 * permissão, isolamento de memória privada, e concorrência. Um teste de um
 * usuário só não consegue reprovar nenhuma delas.
 *
 * O ÚNICO ATALHO: os tokens são emitidos direto pelo token-store, em vez de
 * passar pela tela de consentimento. O motivo é que a tela pede a SENHA de cada
 * funcionário, e um teste não deve tê-las. Tudo depois disso — papel, scope,
 * fronteira de organização, auditoria — é o caminho real.
 *
 *   pnpm --filter @desigual-os/mcp exec tsx scripts/aceite.mts [url]
 */
import '../src/env.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { emitirTokens } from '../src/auth/token-store.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3010';
let falhas = 0;
const ok = (r: string, c: boolean, d = '') => { if (!c) falhas += 1; console.log(`  ${c ? '✓' : '✗ FALHOU'}  ${r}${d ? ` — ${d}` : ''}`); };

interface Ator { rotulo: string; email: string; papel: string; token: string; userId: string }

async function prepararAtor(email: string, papel: string, rotulo: string): Promise<Ator | null> {
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)));
  if (!u) return null;
  const [m] = await db
    .select({ id: schema.organizationMembers.id, org: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, u.id));
  if (!m) return null;
  await db.update(schema.organizationMembers).set({ role: papel }).where(eq(schema.organizationMembers.id, m.id));
  const par = await emitirTokens({
    clientId: 'aceite-do-control-plane',
    userId: u.id,
    organizationId: m.org,
    scopes: ['desigual.read', 'desigual.write', 'admin.read'],
  });
  return { rotulo, email, papel, token: par.accessToken, userId: u.id };
}

/**
 * JSON-RPC exige id inteiro ou string. Float é recusado, e o sintoma é resposta
 * vazia em TODA chamada — que parece defeito do servidor e não do cliente.
 */
let proximoId = 1;
/**
 * SEM mapa de sessão compartilhado. O transporte é sem estado, e o mapa que
 * havia aqui era escrito por chamadas concorrentes ao mesmo tempo: duas
 * respostas voltavam com a identidade de uma só. O servidor estava certo — foi
 * conferido isolando o caso — e quem misturava era este helper.
 */
async function chamar(ator: Ator, method: string, params?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ator.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: proximoId++, method, ...(params ? { params } : {}) }),
  });
  const texto = await r.text();
  const linha = texto.split('\n').find((l) => l.startsWith('data: '));
  try { return JSON.parse(linha ? linha.slice(6) : texto); } catch { return { __raw: texto.slice(0, 200) }; }
}
async function tool(ator: Ator, nome: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await chamar(ator, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aceite', version: '1' } });
  const r = await chamar(ator, 'tools/call', { name: nome, arguments: args });
  const texto = (r.result as { content?: Array<{ text: string }> } | undefined)?.content?.[0]?.text ?? '{}';
  try { return JSON.parse(texto); } catch { return { __texto: texto }; }
}

console.log(`\nACEITE DO CONTROL PLANE — ${BASE}\n`);

// ── ATORES ───────────────────────────────────────────────────────────────
console.log('0. Quatro papéis diferentes, contas reais do banco');
const definicoes: Array<[string, string, string]> = [
  ['pedro@institutoalmada.org', 'SUPER_ADMIN', 'Pedro'],
  ['super@institutoalmada.org', 'MANAGER', 'Endrigo'],
  ['tammy@institutoalmada.org', 'CUSTOMER_SUCCESS', 'Tammy'],
  ['studio-test@institutoalmada.org', 'CREATIVE', 'Criativo'],
];
const atores: Ator[] = [];
for (const [email, papel, rotulo] of definicoes) {
  const a = await prepararAtor(email, papel, rotulo);
  ok(`${rotulo} (${papel})`, a !== null, a ? email : `conta ${email} não existe`);
  if (a) atores.push(a);
}
const [pedro, endrigo, tammy, criativo] = atores;
if (!pedro || !endrigo || !tammy || !criativo) { console.log('\nSem os quatro atores, o aceite não roda.\n'); process.exit(1); }

// ── TAMMY: o fluxo de atendimento ────────────────────────────────────────
console.log('\n1. Tammy (atendimento) — o fluxo que a missão descreve');
const clientes = await tool(tammy, 'search_clients', { query: 'cosentino', limit: 3 });
const primeiro = ((clientes.clients ?? []) as Array<{ client_id: string; name: string }>)[0];
ok('acha a Cosentino', Boolean(primeiro), primeiro?.name ?? '');
if (primeiro) {
  const ctx = await tool(tammy, 'get_client_context', { client_id: primeiro.client_id });
  ok('get_client_context traz operação', typeof ctx.open_tasks === 'number', `${ctx.open_tasks} abertas`);
  const op = await tool(tammy, 'get_client_operation', { client_id: primeiro.client_id });
  ok('get_client_operation NÃO cai pra global', op.client === primeiro.name, String(op.client ?? op.error));
  ok('diz quem sustenta o cliente', Array.isArray(op.quem_sustenta), `${(op.quem_sustenta as unknown[] ?? []).length} pessoa(s)`);
}
const mudou = await tool(tammy, 'get_recent_changes', { days: 2 });
ok('get_recent_changes lê o event store', typeof mudou.tarefas_que_mudaram === 'number', `${mudou.tarefas_que_mudaram} mudaram`);
ok('declara o que o evento NÃO sabe', typeof mudou.limitacao === 'string');

// ── MEMÓRIA COMPARTILHADA E PRIVADA ──────────────────────────────────────
console.log('\n2. Memória — o que se compartilha e o que nunca vaza');
const marca = `ACEITE-${Date.now()}`;
const compartilhada = await tool(tammy, 'remember', {
  content: `${marca} Na 3Net nunca usar promessa de estabilidade durante chuva.`,
  scope: 'AGENCY',
  subject: 'promessa de estabilidade 3net',
});
ok('Tammy registra regra da agência', compartilhada.status === 'SAVED', String(compartilhada.scope ?? ''));

const privada = await tool(tammy, 'remember', {
  content: `${marca} Anotação privada da Tammy que ninguém mais pode ver.`,
  scope: 'USER_PRIVATE',
});
ok('Tammy registra nota privada', privada.status === 'SAVED', String(privada.scope ?? ''));

const endrigoVe = await tool(endrigo, 'recall', { query: marca, limit: 10 });
const vistos = ((endrigoVe.results ?? []) as Array<{ scope: string; content: string }>);
ok('Endrigo VÊ a regra da agência', vistos.some((m) => m.scope === 'AGENCY'), `${vistos.length} resultado(s)`);
ok('Endrigo NÃO vê a nota privada da Tammy', !vistos.some((m) => m.scope === 'USER_PRIVATE'));

const pedroVe = await tool(pedro, 'recall', { query: marca, limit: 10 });
const vistosPedro = ((pedroVe.results ?? []) as Array<{ scope: string }>);
ok('NEM O SUPER_ADMIN vê a privada da Tammy', !vistosPedro.some((m) => m.scope === 'USER_PRIVATE'));

const tammyVe = await tool(tammy, 'recall', { query: marca, limit: 10 });
ok('a própria Tammy vê a nota dela', ((tammyVe.results ?? []) as Array<{ scope: string }>).some((m) => m.scope === 'USER_PRIVATE'));

// ── PERMISSÕES ───────────────────────────────────────────────────────────
console.log('\n3. Permissões — papéis diferentes, acessos diferentes');
const criativoTrafego = await tool(criativo, 'get_campaign_performance', { client_id: primeiro?.client_id ?? '00000000-0000-0000-0000-000000000000' });
ok('CREATIVE não lê mídia paga', criativoTrafego.error === 'SCOPE_MISSING', String(criativoTrafego.error ?? 'passou'));
const criativoLe = await tool(criativo, 'search_clients', { query: 'a', limit: 2 });
ok('CREATIVE lê clientes normalmente', Array.isArray(criativoLe.clients));
const mediaEndrigo = await tool(endrigo, 'get_campaign_performance', { client_id: primeiro?.client_id ?? '00000000-0000-0000-0000-000000000000' });
ok('MANAGER alcança mídia (mesmo sem dado)', mediaEndrigo.error !== 'SCOPE_MISSING', String(mediaEndrigo.status ?? mediaEndrigo.error ?? ''));
const perms = await tool(criativo, 'get_current_permissions');
ok('CREATIVE se reconhece', perms.role === 'CREATIVE', String(perms.role ?? ''));
ok('e sabe que não escreve cliente', perms.can_write_clients === false);

// ── PEDRO: governança ────────────────────────────────────────────────────
console.log('\n4. Pedro (super) — governança');
const saude = await tool(pedro, 'get_health');
ok('get_health responde', typeof saude.banco === 'object', `banco ${(saude.banco as { latencia_ms?: number })?.latencia_ms}ms`);
ok('SEPARA falha de recusa legítima', typeof (saude.escritas_24h as { recusa_legitima?: number })?.recusa_legitima === 'number');
const visao = await tool(pedro, 'get_operation_overview');
ok('get_operation_overview separa carteira de interno', typeof (visao.carteira as { tarefas_abertas?: number })?.tarefas_abertas === 'number'
  && typeof (visao.interno as { tarefas_abertas?: number })?.tarefas_abertas === 'number');
ok('declara clientes sem rastreio', Array.isArray(visao.clientes_sem_rastreio));

// ── CONCORRÊNCIA ─────────────────────────────────────────────────────────
console.log('\n5. Concorrência — o MCP não herda "uma pergunta por vez"');
const inicio = Date.now();
const disparos = [
  tool(tammy, 'get_current_user'), tool(endrigo, 'get_current_user'),
  tool(pedro, 'get_current_user'), tool(criativo, 'get_current_user'),
  tool(tammy, 'search_clients', { query: 'a', limit: 3 }),
  tool(endrigo, 'search_clients', { query: 'c', limit: 3 }),
  tool(pedro, 'get_health'), tool(criativo, 'get_current_permissions'),
  tool(tammy, 'recall', { query: 'regra', limit: 3 }),
  tool(endrigo, 'get_recent_changes', { days: 1 }),
];
const resultados = await Promise.all(disparos);
const duracao = Date.now() - inicio;
ok('10 chamadas concorrentes, 4 usuários', resultados.every((r) => !r.error || r.error === 'DATA_NOT_AVAILABLE'), `${duracao}ms no total`);
const identidades = resultados.slice(0, 4).map((r) => r.user_id);
ok('cada usuário recebe a PRÓPRIA identidade', new Set(identidades).size === 4, `${new Set(identidades).size} identidades distintas`);

// ── AUDITORIA ────────────────────────────────────────────────────────────
console.log('\n6. Auditoria — toda escrita deixa rastro');
const linhas = await db
  .select({ tool: schema.auditLogs.tool, source: schema.auditLogs.source, userId: schema.auditLogs.userId, requestId: schema.auditLogs.requestId })
  .from(schema.auditLogs)
  .where(eq(schema.auditLogs.source, 'mcp'))
  .limit(200);
ok('escritas do MCP estão auditadas', linhas.length > 0, `${linhas.length} linha(s)`);
ok('com request_id', linhas.every((l) => Boolean(l.requestId)));
ok('atribuídas a um usuário', linhas.every((l) => Boolean(l.userId)));
ok('o remember da Tammy está lá', linhas.some((l) => l.tool === 'remember'));

console.log(falhas === 0 ? '\n✓ ACEITE COMPLETO OK\n' : `\n✗ ${falhas} verificação(ões) falharam\n`);
process.exit(falhas === 0 ? 0 : 1);
