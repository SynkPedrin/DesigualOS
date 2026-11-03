import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { DOMINIO_DE_PESSOA_DO_CLICKUP } from '@desigual-os/auth';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { getTeamMembers, type ClickUpMember } from '@desigual-os/tool-gateway';
import { decryptToken } from '../lib/token-crypto';
import { garantirPessoasDoClickUpNasEmpresas } from '../clickup/pessoas-do-clickup';
import { espelhandoConversa, publicadasDaqui } from './espelho-clickup';

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
  /** Da mais nova para a mais antiga, parando no que já foi importado (`desdeMs`); a primeira página vem inteira. */
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
    // A primeira página vem sempre inteira, mesmo o que já foi importado: é nela que aparece a resposta nova numa
    // thread de mensagem antiga (a contagem de respostas muda; a data da mensagem, não).
    const todas: MensagemCU[] = [];
    let pagina = 0;
    for await (const p of paginas<MensagemCU>(token, `${BASE}/${ws}/chat/channels/${canalId}/messages?limit=${desdeMs > 0 ? 50 : 100}&content_format=text/md`)) {
      pagina++;
      for (const m of p) { if (quando(m) <= desdeMs && pagina > 1) return todas; todas.push(m); }
      if (todas.length >= maximo || p.some((m) => quando(m) <= desdeMs)) return todas;
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
    // Ativas ou pessoas só do ClickUp (inativas por não terem login): a conversa com o Gui é com o Gui, não com "alguém de fora".
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), or(eq(schema.users.active, true), like(schema.users.email, `%@${DOMINIO_DE_PESSOA_DO_CLICKUP}`))));
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

/**
 * O que entrou antes de a pessoa existir aqui (pessoas só do ClickUp, 29/10/2026) é acertado na passada seguinte:
 * a conversa direta que tinha virado grupo "Gui · ClickUp" vira a conversa direta com o Gui, e a fala dele, guardada
 * como "**Gui**: texto" em nome do usuário técnico, passa a ser dele. Idempotente: sem nada a acertar, não escreve.
 */
async function promoverConversaAntiga(organizationId: string, conversationId: string, canal: CanalCU, daqui: string[], pessoasDoCanal: Array<{ userId: string | null; nome: string } | undefined>) {
  const unicos = [...new Set(daqui)];
  if (String(canal.type ?? '').toUpperCase() === 'DM' && unicos.length === 2) {
    const directKey = [...unicos].sort().join(':');
    const [jaExiste] = await db.select({ id: schema.internalConversations.id }).from(schema.internalConversations)
      .where(and(eq(schema.internalConversations.organizationId, organizationId), eq(schema.internalConversations.kind, 'direct'), eq(schema.internalConversations.directKey, directKey))).limit(1);
    if (!jaExiste) {
      await db.update(schema.internalConversations).set({ kind: 'direct', directKey, title: null })
        .where(and(eq(schema.internalConversations.id, conversationId), eq(schema.internalConversations.kind, 'group')));
    }
  }
  for (const p of pessoasDoCanal) {
    if (!p?.userId) continue;
    const prefixo = `**${p.nome.replace(/\*/g, '')}**: `;
    await db.update(schema.internalMessages).set({ senderId: p.userId, kind: 'clickup', content: sql`substr(${schema.internalMessages.content}, ${prefixo.length + 1})` })
      .where(and(
        eq(schema.internalMessages.conversationId, conversationId), eq(schema.internalMessages.kind, 'clickup_externo'),
        sql`left(${schema.internalMessages.content}, ${prefixo.length}) = ${prefixo}`,
      ));
  }
}

export interface OpcoesDaImportacao {
  api?: ApiDeChat;
  membrosDoTime?: ClickUpMember[];
  workspace?: string;
  /**
   * Mensagens que CHEGARAM agora (não a primeira carga): a rota avisa ao vivo e notifica, como numa mensagem escrita
   * aqui. Ids das mensagens gravadas, por conversa.
   */
  aoChegar?: (conversationId: string, messageIds: string[]) => Promise<void>;
}

interface MetaDoCanal { ultimaMs?: number; tipo?: string; primeiraCarga?: boolean; respostas?: Record<string, number> }

/** Membros de cada canal mudam pouco: relidos a cada 10 min (a passada agora roda a cada 30 s). */
const membrosEmCache = new Map<string, { em: number; membros: MembroCU[]; daqui?: string }>();
const MEMBROS_VALEM_MS = 10 * 60_000;

/** Uma passada para a empresa: o que mudou desde a última (na primeira, o histórico inteiro). */
export async function importarChatDoClickUp(organizationId: string, opcoes: OpcoesDaImportacao = {}): Promise<ResultadoDoChat> {
  const api = opcoes.api ?? apiDeChatReal;
  const r: ResultadoDoChat = { organizationId, tokens: 0, canais: 0, conversasCriadas: 0, mensagens: 0, respostas: 0, ignorados: [], falhas: [] };
  const conexoes = await db.select({ userId: schema.integrationConnections.userId, token: schema.integrationConnections.accessTokenEncrypted, workspace: schema.integrationConnections.externalWorkspaceId })
    .from(schema.integrationConnections)
    .innerJoin(schema.organizationMembers, and(eq(schema.organizationMembers.userId, schema.integrationConnections.userId), eq(schema.organizationMembers.organizationId, organizationId)))
    .where(and(eq(schema.integrationConnections.provider, 'clickup'), eq(schema.integrationConnections.status, 'connected')));
  // Só o token do MESMO workspace do ClickUp da empresa (o das tarefas do Daily).
  const workspaceDaEmpresa = opcoes.workspace ?? process.env.CLICKUP_TEAM_ID ?? null;
  const leitores = conexoes.filter((c) => c.workspace && (!workspaceDaEmpresa || c.workspace === workspaceDaEmpresa)).map((c) => ({ ...c, token: decryptToken(c.token) }));
  r.tokens = leitores.length;
  if (!leitores.length) return r;

  const membrosCU = opcoes.membrosDoTime ?? await membrosDoTimeEmCache();
  const pessoas = await pessoasDaEmpresa(organizationId, membrosCU);
  const tecnico = await usuarioTecnico();

  // Cada canal é lido por UM token que o enxerga. Os canais se repartem entre os tokens (cada token tem o próprio
  // limite no ClickUp) e os tokens leem em paralelo: com um token só lendo tudo, a passada passava de 30 s.
  const vistos = new Map<string, { canal: CanalCU; leitores: Array<{ token: string; workspace: string }> }>();
  for (const l of leitores) {
    try {
      for (const canal of await api.canais(l.token, l.workspace!)) {
        const v = vistos.get(canal.id) ?? { canal, leitores: [] };
        v.leitores.push({ token: l.token, workspace: l.workspace! });
        vistos.set(canal.id, v);
      }
    } catch (error) {
      r.falhas.push({ erro: `canais de um colaborador: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const porToken = new Map<string, Array<{ canal: CanalCU; token: string; workspace: string }>>();
  for (const { canal, leitores: ls } of vistos.values()) {
    const escolhido = ls.reduce((a, b) => ((porToken.get(a.token)?.length ?? 0) <= (porToken.get(b.token)?.length ?? 0) ? a : b));
    const fila = porToken.get(escolhido.token) ?? [];
    fila.push({ canal, ...escolhido });
    porToken.set(escolhido.token, fila);
  }

  // Os vínculos canal→conversa numa ida só (antes, duas consultas por canal a cada passada).
  const vinculos = new Map((await db.select().from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'),
    eq(schema.workExternalMappings.externalType, 'chat_channel'),
  ))).map((v) => [v.externalId, v]));

  async function lerCanal(canal: CanalCU, token: string, workspace: string) {
    r.canais++;
    try {
      const emCache = membrosEmCache.get(canal.id);
      const frescos = !emCache || Date.now() - emCache.em > MEMBROS_VALEM_MS;
      const membros = frescos ? await api.membros(token, workspace, canal.id) : emCache.membros;
      const daqui = membros.map((m) => pessoas.get(String(m.id))?.userId).filter((x): x is string => Boolean(x));
      // Quem da conversa tem conta aqui mudou (pessoa nova cadastrada): acerta membros e autoria já, sem esperar os 10 min.
      const chaveDaqui = [...new Set(daqui)].sort().join(',');
      const mudouQuemEDaqui = emCache?.daqui !== chaveDaqui;
      membrosEmCache.set(canal.id, frescos ? { em: Date.now(), membros, daqui: chaveDaqui } : { ...emCache, daqui: chaveDaqui });
      const deFora = membros.filter((m) => !pessoas.get(String(m.id))?.userId).map((m) => pessoas.get(String(m.id))?.nome ?? m.username ?? m.email ?? 'alguém');
      const jaLigada = vinculos.get(canal.id);
      const conversa = jaLigada ? { id: jaLigada.entityId, criada: false } : await conversaDoCanal(organizationId, canal, daqui, deFora);
      if (!conversa) { r.ignorados.push({ canal: canal.id, motivo: 'ninguém da conversa tem conta na plataforma' }); return; }
      if (conversa.criada) r.conversasCriadas++;
      // Mensagem daqui sendo publicada lá agora: esta conversa fica para a próxima passada (senão voltaria em dobro).
      if (espelhandoConversa(conversa.id)) return;
      // Membros novos no ClickUp entram aqui também (só quando a lista de membros foi relida).
      if (!conversa.criada && (frescos || mudouQuemEDaqui) && daqui.length) {
        await db.insert(schema.internalConversationMembers).values([...new Set(daqui)].map((userId) => ({ conversationId: conversa.id, userId, organizationId }))).onConflictDoNothing();
        await promoverConversaAntiga(organizationId, conversa.id, canal, daqui, membros.map((m) => pessoas.get(String(m.id))));
      }

      const v = jaLigada ?? await vinculo(organizationId, canal.id);
      const meta = (v?.meta ?? {}) as MetaDoCanal;
      const desde = Number(meta.ultimaMs ?? 0);
      // Primeira carga (conversa nova aqui, ou vínculo recém-criado pelo envio daqui): histórico, não notifica.
      const primeira = conversa.criada || Boolean(meta.primeiraCarga);
      const lidas = await api.mensagens(token, workspace, canal.id, desde, MAXIMO_POR_CANAL);
      const candidatas = lidas.filter((m) => quando(m) > desde);
      // Respostas: a contagem de cada mensagem lida, comparada com a da passada anterior. Mudou → lê a thread.
      const respostasAntes = meta.respostas ?? {};
      const threadsMudaram = lidas.filter((m) => (m.replies_count ?? 0) > 0 && (m.replies_count ?? 0) !== (respostasAntes[m.id] ?? 0));
      if (!candidatas.length && !threadsMudaram.length && !meta.primeiraCarga) return;

      const doDaqui = await publicadasDaqui(organizationId, [...candidatas, ...threadsMudaram].map((m) => m.id));
      const novas = candidatas.filter((m) => !doDaqui.has(m.id)).sort((a, b) => quando(a) - quando(b));
      const chegaram: string[] = [];
      for (let i = 0; i < novas.length; i += 200) {
        const lote = novas.slice(i, i + 200).map((m) => valores(organizationId, conversa.id, m, pessoas, tecnico, null));
        const gravadas = await db.insert(schema.internalMessages).values(lote).onConflictDoNothing().returning({ id: schema.internalMessages.id });
        r.mensagens += gravadas.length;
        chegaram.push(...gravadas.map((g) => g.id));
      }
      // Respostas em thread: a raiz é a mensagem daqui com o mesmo id do ClickUp (importada, ou publicada daqui).
      for (const raizCU of threadsMudaram) {
        const raizId = doDaqui.get(raizCU.id) ?? (await db.select({ id: schema.internalMessages.id }).from(schema.internalMessages)
          .where(and(eq(schema.internalMessages.conversationId, conversa.id), eq(schema.internalMessages.clientMessageId, `clickup:${raizCU.id}`))).limit(1))[0]?.id;
        if (!raizId) continue;
        const todas = await api.respostas(token, workspace, raizCU.id);
        const jaDaqui = await publicadasDaqui(organizationId, todas.map((m) => m.id));
        const respostas = todas.filter((m) => !jaDaqui.has(m.id));
        if (!respostas.length) continue;
        const gravadas = await db.insert(schema.internalMessages).values(respostas.map((m) => valores(organizationId, conversa.id, m, pessoas, tecnico, raizId))).onConflictDoNothing().returning({ id: schema.internalMessages.id });
        r.respostas += gravadas.length;
        chegaram.push(...gravadas.map((g) => g.id));
        if (!gravadas.length) continue;
        const ultima = new Date(Math.max(...respostas.map(quando)));
        await db.update(schema.internalMessages).set({
          replyCount: sql`(select count(*)::int from internal_messages t where t.thread_root_id = ${raizId} and t.deleted_at is null)`,
          lastReplyAt: sql`greatest(${schema.internalMessages.lastReplyAt}, ${ultima.toISOString()}::timestamptz)`,
        }).where(eq(schema.internalMessages.id, raizId));
      }
      const maisNova = Math.max(desde, ...lidas.map(quando));
      if (novas.length) {
        await db.update(schema.internalConversations).set({ lastMessageAt: sql`greatest(${schema.internalConversations.lastMessageAt}, ${new Date(Math.max(...novas.map(quando))).toISOString()}::timestamptz)` }).where(eq(schema.internalConversations.id, conversa.id));
      }
      // Primeira carga: o histórico entra como lido (senão cada pessoa abriria a Comunicação com milhares de "novas").
      if (conversa.criada) await db.update(schema.internalConversationMembers).set({ lastReadAt: new Date() }).where(eq(schema.internalConversationMembers.conversationId, conversa.id));
      const respostas = Object.fromEntries(lidas.filter((m) => (m.replies_count ?? 0) > 0).slice(0, 100).map((m) => [m.id, m.replies_count ?? 0]));
      await db.update(schema.workExternalMappings).set({ meta: sql`${schema.workExternalMappings.meta} || ${JSON.stringify({ ultimaMs: maisNova, primeiraCarga: false, respostas: { ...respostasAntes, ...respostas } })}::jsonb`, syncedAt: new Date() })
        .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'chat_channel'), eq(schema.workExternalMappings.externalId, canal.id)));
      if (!primeira && chegaram.length && opcoes.aoChegar) {
        await opcoes.aoChegar(conversa.id, chegaram).catch((error: unknown) => logger.warn({ error, conversationId: conversa.id }, 'Chat do ClickUp: aviso da mensagem que chegou falhou'));
      }
    } catch (error) {
      r.falhas.push({ canal: canal.id, erro: error instanceof Error ? error.message : String(error) });
    }
  }

  await Promise.all([...porToken.values()].map(async (fila) => { for (const c of fila) await lerCanal(c.canal, c.token, c.workspace); }));
  return r;
}

let timeEmCache: { em: number; membros: ClickUpMember[] } | null = null;
async function membrosDoTimeEmCache(): Promise<ClickUpMember[]> {
  if (timeEmCache && Date.now() - timeEmCache.em < 5 * 60_000) return timeEmCache.membros;
  const membros = await getTeamMembers({ apiKey: process.env.CLICKUP_API_KEY ?? '', teamId: process.env.CLICKUP_TEAM_ID ?? '' });
  timeEmCache = { em: Date.now(), membros };
  return membros;
}

// ── passadas automáticas ──────────────────────────────────────────────────────────────────────────────────────────

let ultimas: ResultadoDoChat[] = [];
let rodando = false;
let ultimaArrumacao = 0;
let aoChegar: OpcoesDaImportacao['aoChegar'] | null = null;
export function ultimasImportacoesDoChat() { return ultimas; }

/**
 * Empresas DONAS do workspace do ClickUp: as que têm tarefas do ClickUp no Daily (listas vinculadas). Uma pessoa pode
 * ser membro de várias empresas; sem esta regra, o chat da agência entrava também numa empresa de teste dela
 * (visto na primeira passada em produção, 29/10/2026).
 */
export async function empresasDonasDoClickUp(): Promise<string[]> {
  const linhas = await db.selectDistinct({ id: schema.workExternalMappings.organizationId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')));
  return linhas.map((l) => l.id);
}

/**
 * Desfaz o que foi importado numa empresa que não é dona do workspace. Conversa que só tem mensagens do ClickUp sai
 * inteira; conversa que já existia (com mensagens escritas aqui) perde só as importadas. Idempotente.
 */
export async function desfazerImportacaoFora(donas: string[]): Promise<number> {
  const fora = await db.select().from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'chat_channel'),
    donas.length ? sql`${schema.workExternalMappings.organizationId} not in (${sql.join(donas.map((d) => sql`${d}::uuid`), sql`, `)})` : sql`true`,
  ));
  for (const v of fora) {
    const [propria] = await db.select({ id: schema.internalMessages.id }).from(schema.internalMessages)
      .where(and(eq(schema.internalMessages.conversationId, v.entityId), sql`${schema.internalMessages.kind} not in ('clickup', 'clickup_externo')`)).limit(1);
    if (propria) await db.delete(schema.internalMessages).where(and(eq(schema.internalMessages.conversationId, v.entityId), inArray(schema.internalMessages.kind, ['clickup', 'clickup_externo'])));
    else await db.delete(schema.internalConversations).where(eq(schema.internalConversations.id, v.entityId));
    await db.delete(schema.workExternalMappings).where(eq(schema.workExternalMappings.id, v.id));
  }
  if (fora.length) logger.warn({ conversas: fora.length }, 'Chat do ClickUp: importação desfeita em empresa que não é dona do workspace');
  return fora.length;
}

/** As empresas donas do workspace do ClickUp. Uma passada por vez. */
export async function passadaDoChatDoClickUp(): Promise<ResultadoDoChat[]> {
  if (rodando) return ultimas;
  rodando = true;
  try {
    const donas = await empresasDonasDoClickUp();
    // A passada roda a cada 30 s; a faxina e as pessoas novas do ClickUp, a cada 5 min (mudam muito pouco).
    if (Date.now() - ultimaArrumacao > 5 * 60_000) {
      ultimaArrumacao = Date.now();
      await desfazerImportacaoFora(donas);
      // Quem entrou no ClickUp desde a última passada já chega como pessoa (senão a conversa nasce com "alguém de fora").
      await garantirPessoasDoClickUpNasEmpresas().catch((error: unknown) => logger.warn({ error }, 'Chat do ClickUp: pessoas do ClickUp não atualizadas'));
    }
    const resultados: ResultadoDoChat[] = [];
    for (const id of donas) {
      const res = await importarChatDoClickUp(id, aoChegar ? { aoChegar } : {});
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
const INTERVALO_MS = Number(process.env.CHAT_CLICKUP_INTERVALO_MS) || 30_000;
/**
 * A cada 30 s (era 5 min: a mensagem do ClickUp chegava aqui até 5 min depois, 03/11/2026). A primeira passada sai
 * 1 min depois de subir. Passada que demora mais que o intervalo não empilha (`rodando`). Não roda em teste.
 * `aoChegarMensagens`: o que fazer com a mensagem que chegou (aviso ao vivo e notificação, nas rotas).
 */
export function iniciarChatDoClickUp(aoChegarMensagens?: OpcoesDaImportacao['aoChegar']): void {
  if (ligado || process.env.VITEST || !chatDoClickUpLigado()) return;
  ligado = true;
  aoChegar = aoChegarMensagens ?? null;
  const rodar = () => { passadaDoChatDoClickUp().catch((error: unknown) => logger.warn({ error }, 'Chat do ClickUp: passada falhou')); };
  setTimeout(rodar, 60_000).unref();
  setInterval(rodar, INTERVALO_MS).unref();
  logger.info({ intervaloMs: INTERVALO_MS }, 'Chat do ClickUp: importação ligada');
}

/** Para a tela de status: quantas conversas e mensagens do ClickUp já estão aqui. */
export async function totaisDoChatImportado(organizationId: string) {
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workExternalMappings).where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.externalType, 'chat_channel')));
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.internalMessages).where(and(eq(schema.internalMessages.organizationId, organizationId), inArray(schema.internalMessages.kind, ['clickup', 'clickup_externo'])));
  return { conversas: c?.n ?? 0, mensagens: m?.n ?? 0 };
}
