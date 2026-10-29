import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { getTeamMembers, type ClickUpMember } from '@desigual-os/tool-gateway';
import { decryptToken } from '../lib/token-crypto';

const logger = createLogger({ service: 'chat-clickup' });

/**
 * O CHAT DO CLICKUP DENTRO DA COMUNICAÇÃO (29/10/2026).
 *
 * A Comunicação vai substituir o chat do ClickUp, como o Daily substitui as tarefas. Para a equipe passar o dia
 * inteiro aqui, o que já foi conversado lá (canais, conversas diretas e em grupo) precisa estar aqui, e o que
 * continuar chegando lá também.
 *
 * QUEM LÊ: o token OAuth de cada colaborador que conectou o ClickUp (Integrações). A API do ClickUp só mostra a
 * cada pessoa as conversas de que ela participa, então uma conversa direta entre duas pessoas só entra se uma
 * delas conectou, e só aparece aqui para quem participa dela. Nada é escrito no ClickUp.
 *
 * COMO GRAVA: direto nas tabelas da Comunicação, sem passar pelo envio (que notifica): histórico não é mensagem
 * nova. Tipo `clickup` quando o autor tem conta aqui; `clickup_externo` quando não tem (Gui, Ana Luiza...): aí o
 * remetente é o usuário técnico "ClickUp" e o nome real vai no começo do texto, que a tela mostra como autor.
 * Idempotente: `client_message_id = clickup:<id>` + o índice único de mensagem. O ponto até onde cada canal já foi
 * importado fica em `work_external_mappings` (tipo `chat_channel`), junto com o vínculo canal→conversa.
 *
 * Desligável: `CHAT_CLICKUP_SYNC=off`.
 */

export function chatDoClickUpLigado(): boolean {
  return process.env.CHAT_CLICKUP_SYNC !== 'off';
}

// ── API de chat do ClickUp (v3) ───────────────────────────────────────────────────────────────────────────────────

export interface CanalCU { id: string; name?: string | null; type?: string | null; description?: string | null; visibility?: string | null }
export interface MensagemCU { id: string; content?: string | null; user_id?: string | number | null; date?: number | string | null; replies_count?: number | null }
export interface MembroCU { id: string | number; email?: string | null; username?: string | null }

/** O que o importador precisa do ClickUp; os testes trocam por um ClickUp simulado. */
export interface ApiDeChat {
  canais(token: string, workspace: string): Promise<CanalCU[]>;
  membros(token: string, workspace: string, canalId: string): Promise<MembroCU[]>;
  /** Da mais nova para a mais antiga, parando no que já foi importado (`desdeMs`). */
  mensagens(token: string, workspace: string, canalId: string, desdeMs: number, maximo: number): Promise<MensagemCU[]>;
  respostas(token: string, workspace: string, mensagemId: string): Promise<MensagemCU[]>;
}

const BASE = 'https://api.clickup.com/api/v3/workspaces';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ultimaChamada = new Map<string, number>();

/** Uma chamada por vez por token, com folga (o ClickUp corta em ~100/min por token) e respeito ao 429. */
async function chamar<T>(token: string, url: string): Promise<T> {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const desde = Date.now() - (ultimaChamada.get(token) ?? 0);
    if (desde < 700) await espera(700 - desde);
    ultimaChamada.set(token, Date.now());
    const r = await fetch(url, { headers: { Authorization: token }, signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) { await espera(Math.min(Number(r.headers.get('retry-after') ?? 30) * 1000, 60_000)); continue; }
    if (!r.ok) throw new Error(`ClickUp chat (${r.status}) em ${url.replace(BASE, '').split('?')[0]}`);
    return (await r.json()) as T;
  }
  throw new Error('ClickUp chat (429): limite de requisições, tenta na próxima passada');
}

async function* paginas<T>(token: string, url: string): AsyncGenerator<T[]> {
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const sep = url.includes('?') ? '&' : '?';
    const j: { data?: T[]; next_cursor?: string | null } = await chamar(token, cursor ? `${url}${sep}cursor=${encodeURIComponent(cursor)}` : url);
    yield j.data ?? [];
    cursor = j.next_cursor ?? null;
    if (!cursor) return;
  }
}

export const apiDeChatReal: ApiDeChat = {
  async canais(token, ws) {
    const todos: CanalCU[] = [];
    for await (const p of paginas<CanalCU>(token, `${BASE}/${ws}/chat/channels?limit=100&include_closed=true`)) todos.push(...p);
    return todos;
  },
  async membros(token, ws, canalId) {
    const todos: MembroCU[] = [];
    for await (const p of paginas<MembroCU>(token, `${BASE}/${ws}/chat/channels/${canalId}/members?limit=100`)) todos.push(...p);
    return todos;
  },
  async mensagens(token, ws, canalId, desdeMs, maximo) {
    const todas: MensagemCU[] = [];
    for await (const p of paginas<MensagemCU>(token, `${BASE}/${ws}/chat/channels/${canalId}/messages?limit=100&content_format=text/md`)) {
      for (const m of p) { if (quando(m) <= desdeMs) return todas; todas.push(m); }
      if (todas.length >= maximo) return todas;
    }
    return todas;
  },
  async respostas(token, ws, mensagemId) {
    const todas: MensagemCU[] = [];
    for await (const p of paginas<MensagemCU>(token, `${BASE}/${ws}/chat/messages/${mensagemId}/replies?limit=100&content_format=text/md`)) todas.push(...p);
    return todas;
  },
};

function quando(m: MensagemCU): number {
  const n = typeof m.date === 'number' ? m.date : Number(m.date);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── importação ────────────────────────────────────────────────────────────────────────────────────────────────────

const USUARIO_CLICKUP_EMAIL = 'clickup-importado@desigual-os.invalid';
const MAXIMO_POR_CANAL = Number(process.env.CHAT_CLICKUP_MAXIMO_POR_CANAL) || 20_000;

export interface ResultadoDoChat {
  organizationId: string;
  tokens: number;
  canais: number;
  conversasCriadas: number;
  mensagens: number;
  respostas: number;
  ignorados: Array<{ canal: string; motivo: string }>;
  falhas: Array<{ canal?: string; erro: string }>;
}

async function usuarioTecnico(): Promise<string> {
  await db.insert(schema.users).values({ email: USUARIO_CLICKUP_EMAIL, name: 'ClickUp', active: false }).onConflictDoNothing();
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, USUARIO_CLICKUP_EMAIL));
  return u!.id;
}

/** Pessoa do ClickUp (id) → usuário daqui, por e-mail igual no cadastro ou no e-mail do ClickUp. */
async function pessoasDaEmpresa(organizationId: string, membrosCU: ClickUpMember[]) {
  const linhas = await db.select({ id: schema.users.id, email: schema.users.email, clickupEmail: schema.users.clickupEmail, name: schema.users.name })
    .from(schema.organizationMembers).innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.users.active, true)));
  const porEmail = new Map<string, string>();
  for (const u of linhas) for (const e of [u.email, u.clickupEmail]) if (e) porEmail.set(e.trim().toLowerCase(), u.id);
  const porId = new Map<string, { userId: string | null; nome: string }>();
  for (const m of membrosCU) porId.set(String(m.id), { userId: porEmail.get(m.email.trim().toLowerCase()) ?? null, nome: m.username || m.email });
  return porId;
}

async function vinculo(organizationId: string, canalId: string) {
  const [v] = await db.select().from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'),
    eq(schema.workExternalMappings.externalType, 'chat_channel'), eq(schema.workExternalMappings.externalId, canalId),
  )).limit(1);
  return v ?? null;
}

/** A conversa da Comunicação que corresponde ao canal (cria na primeira vez). `null` = ninguém daqui participa. */
async function conversaDoCanal(organizationId: string, canal: CanalCU, membrosDaqui: string[], nomesDeFora: string[]): Promise<{ id: string; criada: boolean } | null> {
  const v = await vinculo(organizationId, canal.id);
  if (v) return { id: v.entityId, criada: false };
  const unicos = [...new Set(membrosDaqui)];
  if (unicos.length === 0) return null;
  const tipo = String(canal.type ?? 'CHANNEL').toUpperCase();
  let id: string;
  if (tipo === 'DM' && unicos.length === 2) {
    const directKey = [...unicos].sort().join(':');
    await db.insert(schema.internalConversations).values({ organizationId, kind: 'direct', directKey }).onConflictDoNothing();
    const [c] = await db.select({ id: schema.internalConversations.id }).from(schema.internalConversations).where(and(eq(schema.internalConversations.organizationId, organizationId), eq(schema.internalConversations.kind, 'direct'), eq(schema.internalConversations.directKey, directKey)));
    id = c!.id;
  } else if (tipo === 'DM' || tipo === 'GROUP_DM') {
    // Conversa com quem ainda não tem conta aqui vira grupo com o nome da pessoa de fora.
    const titulo = (canal.name?.trim() || (nomesDeFora.length ? `${nomesDeFora.join(', ')} · ClickUp` : null))?.slice(0, 80) ?? null;
    const [c] = await db.insert(schema.internalConversations).values({ organizationId, kind: 'group', title: titulo }).returning({ id: schema.internalConversations.id });
    id = c!.id;
  } else {
    const titulo = (canal.name?.trim() || 'canal do ClickUp').replace(/^#/, '').slice(0, 80);
    const [existente] = await db.select({ id: schema.internalConversations.id }).from(schema.internalConversations).where(and(
      eq(schema.internalConversations.organizationId, organizationId), eq(schema.internalConversations.kind, 'channel'),
      sql`lower(${schema.internalConversations.title}) = lower(${titulo})`, sql`${schema.internalConversations.archivedAt} is null`,
    )).limit(1);
    if (existente) id = existente.id; // canal com o mesmo nome já existe aqui: o histórico entra nele
    else {
      const visibility = String(canal.visibility ?? '').toUpperCase() === 'PRIVATE' ? 'private' : 'public';
      const [c] = await db.insert(schema.internalConversations).values({ organizationId, kind: 'channel', title: titulo, description: canal.description?.slice(0, 500) ?? null, visibility }).returning({ id: schema.internalConversations.id });
      id = c!.id;
    }
  }
  if (unicos.length) await db.insert(schema.internalConversationMembers).values(unicos.map((userId) => ({ conversationId: id, userId, organizationId }))).onConflictDoNothing();
  await db.insert(schema.workExternalMappings).values({ organizationId, provider: 'clickup', externalType: 'chat_channel', externalId: canal.id, entityType: 'internal_conversation', entityId: id, meta: { ultimaMs: 0, tipo } }).onConflictDoNothing();
  return { id, criada: true };
}

function valores(organizationId: string, conversationId: string, m: MensagemCU, pessoas: Map<string, { userId: string | null; nome: string }>, tecnico: string, threadRootId: string | null) {
  const p = pessoas.get(String(m.user_id ?? ''));
  const texto = (m.content ?? '').slice(0, 20_000);
  const deFora = !p?.userId;
  return {
    organizationId, conversationId, threadRootId,
    senderId: p?.userId ?? tecnico,
    kind: deFora ? 'clickup_externo' : 'clickup',
    content: deFora ? `**${(p?.nome ?? 'Alguém do ClickUp').replace(/\*/g, '')}**: ${texto}` : texto,
    clientMessageId: `clickup:${m.id}`,
    createdAt: new Date(quando(m) || Date.now()),
  };
}

/** Uma passada para a empresa: o que mudou desde a última (na primeira, o histórico inteiro). */
export async function importarChatDoClickUp(organizationId: string, opcoes: { api?: ApiDeChat; membrosDoTime?: ClickUpMember[] } = {}): Promise<ResultadoDoChat> {
  const api = opcoes.api ?? apiDeChatReal;
  const r: ResultadoDoChat = { organizationId, tokens: 0, canais: 0, conversasCriadas: 0, mensagens: 0, respostas: 0, ignorados: [], falhas: [] };
  const conexoes = await db.select({ userId: schema.integrationConnections.userId, token: schema.integrationConnections.accessTokenEncrypted, workspace: schema.integrationConnections.externalWorkspaceId })
    .from(schema.integrationConnections)
    .innerJoin(schema.organizationMembers, and(eq(schema.organizationMembers.userId, schema.integrationConnections.userId), eq(schema.organizationMembers.organizationId, organizationId)))
    .where(and(eq(schema.integrationConnections.provider, 'clickup'), eq(schema.integrationConnections.status, 'connected')));
  const leitores = conexoes.filter((c) => c.workspace).map((c) => ({ ...c, token: decryptToken(c.token) }));
  r.tokens = leitores.length;
  if (!leitores.length) return r;

  const membrosCU = opcoes.membrosDoTime ?? await getTeamMembers({ apiKey: process.env.CLICKUP_API_KEY ?? '', teamId: process.env.CLICKUP_TEAM_ID ?? '' });
  const pessoas = await pessoasDaEmpresa(organizationId, membrosCU);
  const tecnico = await usuarioTecnico();

  // Cada canal é lido uma vez, pelo primeiro token que o enxerga.
  const canais = new Map<string, { canal: CanalCU; token: string; workspace: string }>();
  for (const l of leitores) {
    try {
      for (const canal of await api.canais(l.token, l.workspace!)) if (!canais.has(canal.id)) canais.set(canal.id, { canal, token: l.token, workspace: l.workspace! });
    } catch (error) {
      r.falhas.push({ erro: `canais de um colaborador: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  for (const { canal, token, workspace } of canais.values()) {
    r.canais++;
    try {
      const membros = await api.membros(token, workspace, canal.id);
      const daqui = membros.map((m) => pessoas.get(String(m.id))?.userId).filter((x): x is string => Boolean(x));
      const deFora = membros.filter((m) => !pessoas.get(String(m.id))?.userId).map((m) => pessoas.get(String(m.id))?.nome ?? m.username ?? m.email ?? 'alguém');
      const conversa = await conversaDoCanal(organizationId, canal, daqui, deFora);
      if (!conversa) { r.ignorados.push({ canal: canal.id, motivo: 'ninguém da conversa tem conta na plataforma' }); continue; }
      if (conversa.criada) r.conversasCriadas++;
      // Membros novos no ClickUp entram aqui também.
      if (!conversa.criada && daqui.length) await db.insert(schema.internalConversationMembers).values([...new Set(daqui)].map((userId) => ({ conversationId: conversa.id, userId, organizationId }))).onConflictDoNothing();

      const v = await vinculo(organizationId, canal.id);
      const desde = Number((v?.meta as { ultimaMs?: number } | undefined)?.ultimaMs ?? 0);
      const novas = (await api.mensagens(token, workspace, canal.id, desde, MAXIMO_POR_CANAL)).sort((a, b) => quando(a) - quando(b));
      if (!novas.length) continue;
      for (let i = 0; i < novas.length; i += 200) {
        const lote = novas.slice(i, i + 200).map((m) => valores(organizationId, conversa.id, m, pessoas, tecnico, null));
        const gravadas = await db.insert(schema.internalMessages).values(lote).onConflictDoNothing().returning({ id: schema.internalMessages.id });
        r.mensagens += gravadas.length;
      }
      // Respostas em thread: a raiz é a mensagem já gravada com o mesmo id do ClickUp.
      for (const raizCU of novas.filter((m) => (m.replies_count ?? 0) > 0)) {
        const [raiz] = await db.select({ id: schema.internalMessages.id }).from(schema.internalMessages).where(and(eq(schema.internalMessages.conversationId, conversa.id), eq(schema.internalMessages.clientMessageId, `clickup:${raizCU.id}`))).limit(1);
        if (!raiz) continue;
        const respostas = await api.respostas(token, workspace, raizCU.id);
        if (!respostas.length) continue;
        const gravadas = await db.insert(schema.internalMessages).values(respostas.map((m) => valores(organizationId, conversa.id, m, pessoas, tecnico, raiz.id))).onConflictDoNothing().returning({ id: schema.internalMessages.id });
        r.respostas += gravadas.length;
        const ultima = new Date(Math.max(...respostas.map(quando)));
        await db.update(schema.internalMessages).set({
          replyCount: sql`(select count(*)::int from internal_messages t where t.thread_root_id = ${raiz.id} and t.deleted_at is null)`,
          lastReplyAt: ultima,
        }).where(eq(schema.internalMessages.id, raiz.id));
      }
      const maisNova = Math.max(...novas.map(quando));
      await db.update(schema.internalConversations).set({ lastMessageAt: sql`greatest(${schema.internalConversations.lastMessageAt}, ${new Date(maisNova).toISOString()}::timestamptz)` }).where(eq(schema.internalConversations.id, conversa.id));
      // Primeira carga: o histórico entra como lido (senão cada pessoa abriria a Comunicação com milhares de "novas").
      if (conversa.criada) await db.update(schema.internalConversationMembers).set({ lastReadAt: new Date() }).where(eq(schema.internalConversationMembers.conversationId, conversa.id));
      await db.update(schema.workExternalMappings).set({ meta: sql`${schema.workExternalMappings.meta} || ${JSON.stringify({ ultimaMs: maisNova })}::jsonb`, syncedAt: new Date() })
        .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'chat_channel'), eq(schema.workExternalMappings.externalId, canal.id)));
    } catch (error) {
      r.falhas.push({ canal: canal.id, erro: error instanceof Error ? error.message : String(error) });
    }
  }
  return r;
}

// ── passadas automáticas ──────────────────────────────────────────────────────────────────────────────────────────

let ultimas: ResultadoDoChat[] = [];
let rodando = false;
export function ultimasImportacoesDoChat() { return ultimas; }

/** Todas as empresas com alguém que conectou o ClickUp. Uma passada por vez. */
export async function passadaDoChatDoClickUp(): Promise<ResultadoDoChat[]> {
  if (rodando) return ultimas;
  rodando = true;
  try {
    const orgs = await db.selectDistinct({ id: schema.organizationMembers.organizationId }).from(schema.organizationMembers)
      .innerJoin(schema.integrationConnections, and(eq(schema.integrationConnections.userId, schema.organizationMembers.userId), eq(schema.integrationConnections.provider, 'clickup')));
    const resultados: ResultadoDoChat[] = [];
    for (const { id } of orgs) {
      const res = await importarChatDoClickUp(id);
      resultados.push(res);
      if (res.mensagens || res.respostas || res.falhas.length) logger.info({ ...res, ignorados: res.ignorados.length }, 'Chat do ClickUp: passada');
    }
    ultimas = resultados;
    return resultados;
  } finally {
    rodando = false;
  }
}

let ligado = false;
/** A cada 5 min (a primeira 1 min depois de subir). Não roda em teste. */
export function iniciarChatDoClickUp(): void {
  if (ligado || process.env.VITEST || !chatDoClickUpLigado()) return;
  ligado = true;
  const rodar = () => { passadaDoChatDoClickUp().catch((error: unknown) => logger.warn({ error }, 'Chat do ClickUp: passada falhou')); };
  setTimeout(rodar, 60_000).unref();
  setInterval(rodar, 5 * 60_000).unref();
  logger.info('Chat do ClickUp: importação ligada (a cada 5 min)');
}

/** Para a tela de status: quantas conversas e mensagens do ClickUp já estão aqui. */
export async function totaisDoChatImportado(organizationId: string) {
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workExternalMappings).where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.externalType, 'chat_channel')));
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.internalMessages).where(and(eq(schema.internalMessages.organizationId, organizationId), inArray(schema.internalMessages.kind, ['clickup', 'clickup_externo'])));
  return { conversas: c?.n ?? 0, mensagens: m?.n ?? 0 };
}
