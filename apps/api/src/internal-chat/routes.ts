import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { publishWsEvent } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import * as svc from './service';
import { AnexoRecusado, abrirAnexo, apagarAnexo, gravarAnexo, politicaDeAnexos, tipoParaServir } from './arquivos';
import { estadosDePresenca, marcarPresenca, presentes } from './presenca';
import { TIPOS_DE_OBJETO, estadoAtual, validarObjetos, visibilidadeDosObjetos, type Contexto, type PedidoDeObjeto } from './objetos';
import { TarefaEmAndamento, criarTarefaDaMensagem } from './tarefas';
import { pedirAoAgente } from './assistente';

/**
 * Comunicação interna — rotas. Todas exigem login, organização de trabalho e o
 * módulo 'comunicacao' no workspace; toda leitura/escrita passa por
 * `conversaAcessivel` (regra única de leitura, ver service.ts). Ids vindos do
 * cliente nunca bastam: trocar o id na URL de uma conversa alheia devolve 404.
 */

const logger = createLogger({ service: 'internal-chat' });

const objetoSchema = z.object({
  type: z.enum(TIPOS_DE_OBJETO as unknown as [string, ...string[]]),
  id: z.string().trim().min(1).max(80),
  context: z.record(z.unknown()).optional(),
});

const enviarSchema = z.object({
  content: z.string().max(svc.LIMITE_DE_TEXTO).optional().nullable(),
  clientMessageId: z.string().trim().min(8).max(80),
  replyToId: z.string().uuid().optional().nullable(),
  threadRootId: z.string().uuid().optional().nullable(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  mentions: z.array(z.string().uuid()).max(50).optional(),
  objects: z.array(objetoSchema).max(5).optional(),
});

type Mensagem = svc.MensagemCompleta;

function apresentarAnexo(a: typeof schema.internalMessageAttachments.$inferSelect) {
  return {
    id: a.id,
    message_id: a.messageId,
    conversation_id: a.conversationId,
    filename: a.filename,
    mimetype: tipoParaServir(a.storageKey),
    kind: a.kind,
    size_bytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    url: `/internal-chat/attachments/${a.id}`,
    created_at: a.createdAt.toISOString(),
  };
}

/**
 * Mensagem para a tela. `visiveis` = objetos cujo resumo este leitor pode ver;
 * os demais vão sem snapshot (`restricted`). `null` = sem resumo nenhum (eventos
 * ao vivo: cada leitor busca o estado atual com a PRÓPRIA permissão).
 */
function apresentarMensagem(m: Mensagem, visiveis: Set<string> | null) {
  return {
    id: m.message.id,
    conversation_id: m.message.conversationId,
    sender_id: m.message.senderId,
    sender_name: m.sender?.name ?? null,
    sender_avatar_url: m.sender?.avatarUrl ?? null,
    kind: m.message.kind,
    content: m.message.content,
    client_message_id: m.message.clientMessageId,
    reply_to: m.replyTo ? { id: m.replyTo.id, sender_name: m.replyTo.senderName, content: m.replyTo.content, deleted: m.replyTo.deleted } : null,
    thread_root_id: m.message.threadRootId,
    reply_count: m.message.replyCount,
    last_reply_at: m.message.lastReplyAt?.toISOString() ?? null,
    thread_participants: m.threadParticipants.map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatarUrl })),
    mentions: m.message.mentions,
    created_at: m.message.createdAt.toISOString(),
    edited_at: m.message.editedAt?.toISOString() ?? null,
    deleted: Boolean(m.message.deletedAt),
    pinned: Boolean(m.message.pinnedAt),
    saved: m.saved,
    attachments: m.attachments.map(apresentarAnexo),
    reactions: m.reactions.map((r) => ({ emoji: r.emoji, user_ids: r.userIds })),
    objects: m.objects.map((o) => {
      const pode = visiveis?.has(o.id) ?? false;
      return {
        id: o.id,
        type: o.objectType,
        object_id: pode ? o.objectId : null,
        provider: o.provider,
        context: pode ? o.context : {},
        snapshot: pode ? o.snapshot : null,
        restricted: visiveis !== null && !pode,
        shared_at: o.createdAt.toISOString(),
      };
    }),
  };
}

async function apresentarParaLeitor(mensagens: Mensagem[], ctx: Contexto) {
  const todos = mensagens.flatMap((m) => m.objects);
  const visiveis = todos.length ? await visibilidadeDosObjetos(ctx, todos) : new Set<string>();
  return mensagens.map((m) => apresentarMensagem(m, visiveis));
}

function falha(reply: FastifyReply, erro: unknown) {
  if (erro instanceof svc.AcessoNegado) { reply.code(404); return { error: erro.message }; }
  if (erro instanceof svc.DadoInvalido) { reply.code(400); return { error: erro.message }; }
  if (erro instanceof svc.SemPermissao) { reply.code(403); return { error: erro.message }; }
  if (erro instanceof TarefaEmAndamento) { reply.code(409); return { error: erro.message }; }
  if (erro instanceof AnexoRecusado) { reply.code(erro.status); return { error: erro.message }; }
  if (erro instanceof z.ZodError) { reply.code(400); return { error: erro.issues.map((i) => i.message).join('; ') }; }
  throw erro;
}

/** Evento ao vivo SÓ para quem pode ler a conversa (o filtro está no servidor de WebSocket). */
async function avisar(destinatarios: string[], evento: string, payload: Record<string, unknown>) {
  if (destinatarios.length === 0) return;
  await publishWsEvent({ type: 'chat.event', payload: { recipient_ids: destinatarios, event: evento, ...payload } }).catch((error) => {
    logger.warn({ error, evento }, 'Falha ao publicar evento da Comunicação (a tela recupera pelo refetch)');
  });
}

function nomeDaConversa(conversa: svc.Conversa) {
  if (conversa.kind === 'general') return '#Geral';
  if (conversa.kind === 'channel') return `#${conversa.title}`;
  if (conversa.kind === 'group') return conversa.title ? `o grupo ${conversa.title}` : 'um grupo';
  if (conversa.kind === 'discussion') return `a discussão ${conversa.title ?? ''}`.trim();
  return '';
}

interface Alvo { type: string; title: string }

/**
 * Notificação no sino. Não notifica: quem está olhando a conversa agora (leu
 * nos últimos 20 s), quem está em "não perturbe", e — para o recado comum —
 * quem silenciou a conversa. Menção, resposta e thread chegam mesmo silenciada.
 */
async function notificarAlvos(conversa: svc.Conversa, alvos: Map<string, Alvo>, corpo: string, link: string, dedupe: string) {
  if (alvos.size === 0) return;
  const estado = await svc.estadoDosMembros(conversa, [...alvos.keys()]);
  const agora = Date.now();
  const comuns = new Set(['chat.direct', 'chat.group', 'chat.channel', 'chat.reaction', 'chat.shared']);
  const linhas = [...alvos].filter(([userId, alvo]) => {
    const e = estado.get(userId);
    if (e?.dndUntil && e.dndUntil.getTime() > agora) return false;
    // "Está olhando a conversa" vale para a linha principal; a thread e o convite chegam mesmo assim.
    if (e?.lastReadAt && agora - e.lastReadAt.getTime() < 20_000 && alvo.type !== 'chat.invite' && alvo.type !== 'chat.thread') return false;
    if (e?.mutedAt && comuns.has(alvo.type)) return false;
    if (alvo.type === 'chat.reaction' && e && !e.notifyReactions) return false;
    if (alvo.type === 'chat.channel' && !(e?.notifyChannelMessages)) return false;
    return true;
  }).map(([userId, alvo]) => ({
    userId,
    organizationId: conversa.organizationId,
    type: alvo.type,
    title: alvo.title,
    body: corpo.slice(0, 140),
    link,
    dedupeKey: `${dedupe}:${userId}`,
  }));
  if (linhas.length) await db.insert(schema.notifications).values(linhas).onConflictDoNothing();
}

type Envio = Pick<Awaited<ReturnType<typeof svc.enviarMensagem>>, 'mensagem' | 'mencionados' | 'autorRespondido' | 'raiz'> & { participantesDaThread?: string[] };

/**
 * O que acontece DEPOIS de gravar: evento ao vivo para quem lê a conversa (e a
 * thread atualizada) e as notificações do sino. Fica fora da resposta de quem
 * enviou — era metade do tempo do envio (medido no Hub 2.1).
 */
async function depoisDoEnvio(conversa: svc.Conversa, r: Envio) {
  const quem = await svc.destinatarios(conversa);
  await avisar(quem, 'message.created', { conversation_id: conversa.id, conversation_kind: conversa.kind, message: apresentarMensagem(r.mensagem, null) });
  if (r.raiz) {
    const [raiz] = await svc.completar([r.raiz]);
    await avisar(quem, 'message.updated', { conversation_id: conversa.id, message: apresentarMensagem(raiz!, null) });
  }
  await notificarMensagem(conversa, r);
}

/** Tempo por etapa de uma requisição, devolvido no cabeçalho Server-Timing (aparece no DevTools). */
function cronometro() {
  const inicio = performance.now();
  let anterior = inicio;
  const etapas: Array<[string, number]> = [];
  const api = {
    marca(nome: string) { const agora = performance.now(); etapas.push([nome, agora - anterior]); anterior = agora; return api; },
    cabecalho() { return [...etapas, ['total', performance.now() - inicio] as [string, number]].map(([n, d]) => `${n};dur=${d.toFixed(1)}`).join(', '); },
  };
  return api;
}

async function notificarMensagem(conversa: svc.Conversa, r: Envio) {
  const m = r.mensagem;
  const participantesDaThread = r.participantesDaThread ?? (r.raiz ? await svc.participantesDaThread(r.raiz, m.message.senderId) : []);
  const remetente = m.message.senderId;
  const nome = m.sender?.name ?? 'Alguém';
  const trecho = m.message.content ?? (m.objects.length ? 'Compartilhou um item' : m.attachments.length ? 'Enviou um arquivo' : '');
  const onde = nomeDaConversa(conversa);
  const alvos = new Map<string, Alvo>();
  if (!r.raiz) {
    const todos = (await svc.destinatarios(conversa)).filter((id) => id !== remetente);
    const compartilhou = m.objects.length > 0;
    if (conversa.kind === 'direct') for (const id of todos) alvos.set(id, { type: compartilhou ? 'chat.shared' : 'chat.direct', title: compartilhou ? `${nome} compartilhou um item com você` : `${nome} enviou uma mensagem` });
    if (conversa.kind === 'group') for (const id of todos) alvos.set(id, { type: compartilhou ? 'chat.shared' : 'chat.group', title: `${nome} em ${onde}` });
    if (conversa.kind === 'channel' || conversa.kind === 'discussion') for (const id of todos) alvos.set(id, { type: 'chat.channel', title: `${nome} em ${onde}` });
  }
  for (const id of participantesDaThread) alvos.set(id, { type: 'chat.thread', title: `${nome} respondeu numa thread${onde ? ` em ${onde}` : ''}` });
  if (r.autorRespondido && r.autorRespondido !== remetente) alvos.set(r.autorRespondido, { type: 'chat.reply', title: `${nome} respondeu sua mensagem` });
  for (const id of r.mencionados) alvos.set(id, { type: 'chat.mention', title: `${nome} mencionou você${onde && conversa.kind !== 'direct' ? ` em ${onde}` : ''}` });
  const alvoDoLink = r.raiz ? `&t=${r.raiz.id}` : '';
  await notificarAlvos(conversa, alvos, trecho, `/comunicacao?c=${conversa.id}&m=${m.message.id}${alvoDoLink}`, `chat:${m.message.id}`);
}

function contexto(request: FastifyRequest): Contexto & { userId: string } {
  return { organizationId: request.tenantContext!.organizationId, userId: request.authUser!.id, user: request.authUser! };
}

const ehMaster = (request: FastifyRequest) => (request.authUser?.roles ?? []).includes('master');

function apresentarConversa(c: svc.LinhaDaLista, online: Set<string>) {
  const titulo = c.kind === 'general' ? 'Geral'
    : c.kind === 'direct' ? c.partner_name ?? 'Colaborador'
      : c.kind === 'group' ? c.title ?? (c.member_names ?? []).slice(0, 3).join(', ') + ((c.member_names?.length ?? 0) > 3 ? ` +${(c.member_names?.length ?? 0) - 3}` : '')
        : c.title ?? 'Conversa';
  return {
    id: c.id,
    kind: c.kind,
    title: titulo,
    description: c.description,
    visibility: c.visibility,
    entity: c.entity_type ? { type: c.entity_type, id: c.entity_id } : null,
    role: c.role,
    member_count: Number(c.member_count),
    partner: c.partner_id ? { id: c.partner_id, name: c.partner_name, avatar_url: c.partner_avatar, online: online.has(c.partner_id) } : null,
    last_message: c.last_message_at ? {
      content: c.last_deleted ? null : c.last_content,
      deleted: Boolean(c.last_deleted),
      has_attachment: Boolean(c.last_has_attachment),
      sender_id: c.last_sender_id,
      sender_name: c.last_sender_name,
      kind: c.last_kind,
      created_at: new Date(c.last_message_at).toISOString(),
    } : null,
    unread_count: Number(c.unread),
    mentions_unread: Number(c.mentions_unread),
    muted: Boolean(c.muted_at),
  };
}

/**
 * FAXINA DOS ANEXOS QUE NUNCA VIRARAM MENSAGEM. O arquivo sobe antes do envio
 * (é o que dá barra de progresso); se a pessoa remove da caixa ou fecha a aba,
 * ele ficava no disco e na quota da empresa para sempre. Roda na API porque é
 * ela que monta o volume dos arquivos.
 */
export async function faxinaDeAnexos(agora = new Date()): Promise<number> {
  const orfaos = await svc.anexosOrfaos(new Date(agora.getTime() - 24 * 60 * 60_000));
  const chaves = await svc.apagarOrfaos(orfaos.map((o) => o.id));
  await Promise.all(chaves.map((k) => apagarAnexo(k).catch(() => undefined)));
  return chaves.length;
}

let faxinaAgendada = false;
function agendarFaxina() {
  if (faxinaAgendada || process.env.VITEST) return;
  faxinaAgendada = true;
  const rodar = () => {
    faxinaDeAnexos()
      .then((n) => { if (n) logger.info({ removidos: n }, 'Faxina de anexos da Comunicação'); })
      .catch((error) => logger.warn({ error }, 'Faxina de anexos da Comunicação falhou'));
  };
  setTimeout(rodar, 5 * 60_000).unref();
  setInterval(rodar, 6 * 60 * 60_000).unref();
}

const paginaSchema = z.object({ before: z.string().uuid().optional(), after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });

export async function registerInternalChatRoutes(app: FastifyInstance): Promise<void> {
  agendarFaxina();
  await app.register(async (rotas) => {
    rotas.addHook('preHandler', async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent) return;
      await requireTenant(request, reply);
      if (reply.sent) return;
      await requireModule('comunicacao')(request, reply);
    });

    // ---------------- Lista, pessoas, preferências ----------------

    rotas.get('/internal-chat/conversations', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversas = await svc.listarConversas(organizationId, userId);
        void marcarPresenca(userId);
        const online = await presentes(conversas.map((c) => c.partner_id).filter((id): id is string => Boolean(id)));
        return { conversations: conversas.map((c) => apresentarConversa(c, online)) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/unread', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try { return { unread: await svc.totalNaoLidas(organizationId, userId) }; } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/members', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const membros = await svc.membrosAtivos(organizationId);
        // A própria pessoa está na lista se (e só se) o vínculo dela está ativo: uma consulta em vez de duas.
        if (!membros.some((m) => m.id === userId)) throw new svc.AcessoNegado();
        const estados = await estadosDePresenca(membros.map((m) => m.id));
        return { members: membros.map((m) => ({ id: m.id, name: m.name, avatar_url: m.avatarUrl, is_me: m.id === userId, online: estados.get(m.id) === 'online', presence: estados.get(m.id) ?? 'offline' })) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post('/internal-chat/presence', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { userId } = contexto(request);
      try {
        const body = z.object({ state: z.enum(['online', 'away']) }).parse(request.body);
        await marcarPresenca(userId, body.state);
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/preferences', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const p = await svc.preferencias(organizationId, userId);
        return { dnd_until: p.dndUntil?.toISOString() ?? null, notify_reactions: p.notifyReactions, notify_channel_messages: p.notifyChannelMessages };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.put('/internal-chat/preferences', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({
          dnd_until: z.string().datetime().nullable().optional(),
          notify_reactions: z.boolean().optional(),
          notify_channel_messages: z.boolean().optional(),
        }).parse(request.body);
        const p = await svc.salvarPreferencias(organizationId, userId, {
          dndUntil: body.dnd_until === undefined ? undefined : body.dnd_until ? new Date(body.dnd_until) : null,
          notifyReactions: body.notify_reactions,
          notifyChannelMessages: body.notify_channel_messages,
        });
        return { dnd_until: p.dndUntil?.toISOString() ?? null, notify_reactions: p.notifyReactions, notify_channel_messages: p.notifyChannelMessages };
      } catch (erro) { return falha(reply, erro); }
    });

    // ---------------- Criar conversas ----------------

    rotas.post('/internal-chat/conversations/direct', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ userId: z.string().uuid() }).parse(request.body);
        const conversa = await svc.abrirPrivada(organizationId, userId, body.userId);
        reply.code(201);
        return { id: conversa.id };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post('/internal-chat/channels', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({
          name: z.string().min(1).max(80),
          description: z.string().max(500).nullable().optional(),
          visibility: z.enum(['public', 'private']),
          memberIds: z.array(z.string().uuid()).max(200).optional(),
        }).parse(request.body);
        const { canal, adicionados } = await svc.criarCanal(organizationId, userId, body);
        if (adicionados.length) {
          await notificarAlvos(canal, new Map(adicionados.map((id) => [id, { type: 'chat.invite', title: `${request.authUser!.name ?? 'Alguém'} adicionou você ao #${canal.title}` }])), canal.description ?? '', `/comunicacao?c=${canal.id}`, `chat-invite:${canal.id}`);
          await avisar(adicionados, 'conversation.added', { conversation_id: canal.id });
        }
        await auditarAcao(request, { action: 'internal_chat.channel_created', resourceType: 'internal_conversation', resourceId: canal.id, metadata: { visibility: canal.visibility, members: adicionados.length + 1 } });
        reply.code(201);
        return { id: canal.id };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/channels/browse', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const canais = await svc.canaisPublicos(organizationId, userId);
        return { channels: canais.map((c) => ({ id: c.id, title: c.title, description: c.description, archived: Boolean(c.archived_at), member_count: Number(c.member_count), joined: Boolean(c.joined), last_message_at: c.last_message_at ? new Date(c.last_message_at).toISOString() : null })) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post('/internal-chat/groups', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ title: z.string().max(80).nullable().optional(), memberIds: z.array(z.string().uuid()).min(1).max(60) }).parse(request.body);
        const { grupo, adicionados } = await svc.criarGrupo(organizationId, userId, body);
        await notificarAlvos(grupo, new Map(adicionados.map((id) => [id, { type: 'chat.invite', title: `${request.authUser!.name ?? 'Alguém'} criou um grupo com você` }])), grupo.title ?? '', `/comunicacao?c=${grupo.id}`, `chat-invite:${grupo.id}`);
        await avisar(adicionados, 'conversation.added', { conversation_id: grupo.id });
        reply.code(201);
        return { id: grupo.id };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post('/internal-chat/discussions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ entity_type: z.enum(['client', 'demand']), entity_id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(request.body);
        const conversa = await svc.abrirDiscussao(organizationId, userId, body.entity_type, body.entity_id, body.title);
        return { id: conversa.id };
      } catch (erro) { return falha(reply, erro); }
    });

    // ---------------- Uma conversa ----------------

    rotas.get<{ Params: { id: string } }>('/internal-chat/conversations/:id', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const [pessoas, pins] = await Promise.all([
          conversa.kind === 'general' ? Promise.resolve([]) : svc.participantes(conversa),
          svc.fixadas(conversa, userId),
        ]);
        const estados = await estadosDePresenca(pessoas.map((p) => p.id));
        return {
          id: conversa.id,
          kind: conversa.kind,
          title: conversa.title,
          description: conversa.description,
          visibility: conversa.visibility,
          archived: Boolean(conversa.archivedAt),
          entity: conversa.entityType ? { type: conversa.entityType, id: conversa.entityId } : null,
          my_role: conversa.meuPapel,
          is_member: conversa.souMembro,
          can_manage: conversa.meuPapel === 'owner' || (ehMaster(request) && conversa.kind === 'channel' && conversa.visibility === 'public'),
          members: pessoas.map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatarUrl, role: p.role, last_read_at: p.lastReadAt?.toISOString() ?? null, presence: estados.get(p.id) ?? 'offline' })),
          pinned_count: pins.length,
        };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.patch<{ Params: { id: string } }>('/internal-chat/conversations/:id', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ name: z.string().min(1).max(80).optional(), title: z.string().max(80).nullable().optional(), description: z.string().max(500).nullable().optional() }).parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const nova = await svc.editarConversa(conversa, ehMaster(request), body);
        await avisar(await svc.destinatarios(nova), 'conversation.updated', { conversation_id: nova.id });
        return { id: nova.id, title: nova.title, description: nova.description };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/archive', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ archived: z.boolean() }).parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const nova = await svc.arquivarCanal(conversa, ehMaster(request), body.archived);
        await avisar(await svc.destinatarios(nova), 'conversation.updated', { conversation_id: nova.id });
        await auditarAcao(request, { action: body.archived ? 'internal_chat.channel_archived' : 'internal_chat.channel_unarchived', resourceType: 'internal_conversation', resourceId: nova.id });
        return { archived: Boolean(nova.archivedAt) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/join', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        if (conversa.kind !== 'channel' && conversa.kind !== 'discussion') throw new svc.DadoInvalido('Só se entra em canal público ou discussão.');
        await svc.garantirEscrita(conversa, userId);
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/leave', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        if (conversa.kind === 'general' || conversa.kind === 'direct') throw new svc.DadoInvalido('Do #Geral e da conversa privada não se sai; silencie se preferir.');
        if (conversa.kind === 'discussion') await svc.sairDaDiscussao(conversa, userId);
        else await svc.removerMembro(conversa, userId, userId, false);
        await avisar([userId], 'conversation.removed', { conversation_id: conversa.id });
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/members', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }).parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const adicionados = await svc.adicionarMembros(conversa, userId, body.userIds);
        if (adicionados.length) {
          const nomes = (await svc.membrosAtivos(organizationId)).filter((m) => adicionados.includes(m.id)).map((m) => m.name);
          const sistema = await svc.mensagemDeSistema(conversa, userId, `adicionou ${nomes.join(', ')}`);
          const [completa] = await svc.completar([sistema], userId);
          await avisar(await svc.destinatarios(conversa), 'message.created', { conversation_id: conversa.id, conversation_kind: conversa.kind, message: apresentarMensagem(completa!, null) });
          await notificarAlvos(conversa, new Map(adicionados.map((id) => [id, { type: 'chat.invite', title: `${request.authUser!.name ?? 'Alguém'} adicionou você a ${nomeDaConversa(conversa) || 'uma conversa'}` }])), '', `/comunicacao?c=${conversa.id}`, `chat-invite:${conversa.id}:${Date.now()}`);
          await avisar(adicionados, 'conversation.added', { conversation_id: conversa.id });
          await avisar(await svc.destinatarios(conversa), 'conversation.updated', { conversation_id: conversa.id });
        }
        return { added: adicionados };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.delete<{ Params: { id: string; userId: string } }>('/internal-chat/conversations/:id/members/:userId', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        if (!svc.UUID.test(request.params.userId)) throw new svc.AcessoNegado();
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        await svc.removerMembro(conversa, userId, request.params.userId, ehMaster(request));
        await avisar([request.params.userId], 'conversation.removed', { conversation_id: conversa.id });
        await avisar(await svc.destinatarios(conversa), 'conversation.updated', { conversation_id: conversa.id });
        await auditarAcao(request, { action: 'internal_chat.member_removed', resourceType: 'internal_conversation', resourceId: conversa.id, metadata: { target_user_id: request.params.userId } });
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    // ---------------- Mensagens ----------------

    rotas.get<{ Params: { id: string } }>('/internal-chat/conversations/:id/messages', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const q = paginaSchema.parse(request.query);
        // Acesso e página EM PARALELO (uma ida ao banco a menos). A página só lê
        // esta conversa e nada sai daqui se o acesso for negado.
        const [, pagina] = await Promise.all([
          svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id),
          svc.paginaDeMensagens({ id: request.params.id }, { antes: q.before, depois: q.after, limite: q.limit, viewerId: ctx.userId }),
        ]);
        return { messages: await apresentarParaLeitor(pagina.messages, ctx), has_more: pagina.hasMore };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/threads/:messageId', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const q = paginaSchema.parse(request.query);
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        const raiz = await svc.mensagemDaConversa(conversa, request.params.messageId);
        if (raiz.threadRootId) throw new svc.DadoInvalido('Esta mensagem é uma resposta; abra a thread da original.');
        const [raizCompleta, pagina] = await Promise.all([
          svc.completar([raiz], ctx.userId),
          svc.paginaDeMensagens(conversa, { antes: q.before, depois: q.after, limite: q.limit, threadRootId: raiz.id, viewerId: ctx.userId }),
        ]);
        const [root, ...replies] = await apresentarParaLeitor([...raizCompleta, ...pagina.messages], ctx);
        return { root, replies, has_more: pagina.hasMore };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      const ctx = contexto(request);
      const tempo = cronometro();
      try {
        const body = enviarSchema.parse(request.body);
        // Item compartilhado: a permissão de quem envia sobre o ITEM é conferida antes de qualquer gravação.
        const objetos = body.objects?.length ? await validarObjetos(ctx, body.objects as PedidoDeObjeto[]) : [];
        tempo.marca('itens');
        const rapido = await svc.enviarRapido(ctx.organizationId, request.params.id, ctx.userId, body, objetos);
        tempo.marca('gravacao');
        if (rapido) {
          // Gravou: a resposta sai agora. Eventos ao vivo e notificações vêm logo depois, fora do caminho
          // de quem enviou (a mensagem já está no banco; quem perder o evento recupera pelo refetch).
          void depoisDoEnvio(rapido.conversa, rapido).catch((error) => logger.warn({ error }, 'Falha ao avisar do envio na Comunicação'));
          reply.code(201);
          reply.header('server-timing', tempo.cabecalho());
          // Quem envia acabou de ter cada item validado com a própria permissão: vê o resumo de todos.
          return apresentarMensagem(rapido.mensagem, new Set(rapido.mensagem.objects.map((o) => o.id)));
        }
        // Caminho completo: anexo, discussão, repetição do mesmo clientMessageId — ou o erro certo (404/403/400).
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        await svc.garantirEscrita(conversa, ctx.userId);
        const resultado = await svc.enviarMensagem(conversa, ctx.userId, body, objetos);
        // A raiz que este caminho devolve é a de ANTES da resposta: o evento leva o contador já somado.
        const raizAtual = resultado.raiz ? { ...resultado.raiz, replyCount: resultado.raiz.replyCount + 1, lastReplyAt: resultado.mensagem.message.createdAt } : null;
        if (resultado.criada) void depoisDoEnvio(conversa, { ...resultado, raiz: raizAtual }).catch((error) => logger.warn({ error }, 'Falha ao avisar do envio na Comunicação'));
        reply.code(resultado.criada ? 201 : 200);
        const [apresentada] = await apresentarParaLeitor([resultado.mensagem], ctx);
        reply.header('server-timing', tempo.marca('completo').cabecalho());
        return apresentada;
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.patch<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const body = z.object({ content: z.string().max(svc.LIMITE_DE_TEXTO) }).parse(request.body);
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        const editada = await svc.editarMensagem(conversa, ctx.userId, request.params.messageId, body.content);
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: apresentarMensagem(editada, null) });
        return (await apresentarParaLeitor([editada], ctx))[0];
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.delete<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        const { mensagem, storageKeys } = await svc.excluirMensagem(conversa, ctx.userId, request.params.messageId);
        await Promise.all(storageKeys.map((k) => apagarAnexo(k).catch(() => undefined)));
        const apagada = apresentarMensagem(mensagem, null);
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: apagada });
        await auditarAcao(request, { action: 'internal_chat.message_deleted', resourceType: 'internal_message', resourceId: request.params.messageId, metadata: { conversation_id: conversa.id, attachments: storageKeys.length } });
        return apagada;
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId/reactions', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
      const ctx = contexto(request);
      try {
        const body = z.object({ emoji: z.string().min(1).max(16) }).parse(request.body);
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        const { mensagem, adicionou } = await svc.alternarReacao(conversa, ctx.userId, request.params.messageId, body.emoji);
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: apresentarMensagem(mensagem, null) });
        const autor = mensagem.message.senderId;
        if (adicionou && autor !== ctx.userId && mensagem.message.kind === 'user') {
          void notificarAlvos(conversa, new Map([[autor, { type: 'chat.reaction', title: `${request.authUser!.name ?? 'Alguém'} reagiu ${body.emoji} à sua mensagem` }]]), mensagem.message.content ?? '', `/comunicacao?c=${conversa.id}&m=${mensagem.message.id}`, `chat-reaction:${mensagem.message.id}:${ctx.userId}:${body.emoji}`).catch(() => undefined);
        }
        return (await apresentarParaLeitor([mensagem], ctx))[0];
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId/pin', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const body = z.object({ pinned: z.boolean() }).parse(request.body);
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        if (conversa.archivedAt) throw new svc.SemPermissao('Canal arquivado.');
        const m = await svc.fixarMensagem(conversa, ctx.userId, request.params.messageId, body.pinned);
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: apresentarMensagem(m, null) });
        await avisar(await svc.destinatarios(conversa), 'conversation.updated', { conversation_id: conversa.id });
        return (await apresentarParaLeitor([m], ctx))[0];
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get<{ Params: { id: string } }>('/internal-chat/conversations/:id/pins', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        return { messages: await apresentarParaLeitor(await svc.fixadas(conversa, ctx.userId), ctx) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId/save', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const body = z.object({ saved: z.boolean() }).parse(request.body);
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        await svc.salvarMensagem(conversa, ctx.userId, request.params.messageId, body.saved);
        return { saved: body.saved };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/read', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const quando = await svc.marcarComoLida(conversa, userId);
        // Outras abas da MESMA pessoa zeram o contador; nas privadas e grupos, os outros veem o "visto".
        const quem = conversa.kind === 'direct' || conversa.kind === 'group' ? await svc.destinatarios(conversa) : [userId];
        await avisar(quem, 'conversation.read', { conversation_id: conversa.id, user_id: userId, read_at: quando.toISOString() });
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/mute', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ muted: z.boolean() }).parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        await svc.silenciar(conversa, userId, body.muted);
        return { ok: true, muted: body.muted };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/typing', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ thread_root_id: z.string().uuid().nullable().optional() }).parse(request.body ?? {});
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        void marcarPresenca(userId);
        const outros = (await svc.destinatarios(conversa)).filter((id) => id !== userId);
        await avisar(outros, 'typing', { conversation_id: conversa.id, thread_root_id: body.thread_root_id ?? null, user_id: userId, user_name: request.authUser!.name ?? null });
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    // ---------------- Visões: busca, menções, salvos, arquivos ----------------

    rotas.get('/internal-chat/search', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const q = z.object({
          q: z.string().trim().max(100).optional(),
          sender_id: z.string().uuid().optional(),
          conversation_id: z.string().uuid().optional(),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
          attachment_kind: z.enum(['image', 'video', 'document', 'archive']).optional(),
          object_type: z.enum(TIPOS_DE_OBJETO as unknown as [string, ...string[]]).optional(),
          before: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(30),
        }).parse(request.query);
        const achadas = await svc.buscar(ctx.organizationId, ctx.userId, {
          q: q.q, senderId: q.sender_id, conversationId: q.conversation_id,
          from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined,
          attachmentKind: q.attachment_kind, objectType: q.object_type, before: q.before, limite: q.limit,
        });
        const rotulos = await svc.rotulosDasConversas(ctx.organizationId, ctx.userId, achadas.results.map((m) => m.message.conversationId));
        const apresentadas = await apresentarParaLeitor(achadas.results, ctx);
        return { results: apresentadas.map((m) => ({ ...m, conversation: rotulos.get(m.conversation_id) ?? null })), next_cursor: achadas.nextCursor };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/mentions', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const lista = await svc.listarMencoes(ctx.organizationId, ctx.userId);
        const rotulos = await svc.rotulosDasConversas(ctx.organizationId, ctx.userId, lista.map((m) => m.message.conversationId));
        return { messages: (await apresentarParaLeitor(lista, ctx)).map((m) => ({ ...m, conversation: rotulos.get(m.conversation_id) ?? null })) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/saved', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const lista = await svc.listarSalvas(ctx.organizationId, ctx.userId);
        const rotulos = await svc.rotulosDasConversas(ctx.organizationId, ctx.userId, lista.map((m) => m.message.conversationId));
        return { messages: (await apresentarParaLeitor(lista, ctx)).map((m) => ({ ...m, conversation: rotulos.get(m.conversation_id) ?? null })) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/files', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const q = z.object({
          kind: z.enum(['image', 'video', 'document', 'archive']).optional(),
          q: z.string().trim().max(100).optional(),
          sender_id: z.string().uuid().optional(),
          sort: z.enum(['recentes', 'nome', 'tamanho']).default('recentes'),
          limit: z.coerce.number().int().min(1).max(100).default(60),
          offset: z.coerce.number().int().min(0).max(100_000).default(0),
        }).parse(request.query);
        const r = await svc.arquivosAcessiveis(ctx.organizationId, ctx.userId, { kind: q.kind, q: q.q, senderId: q.sender_id, ordem: q.sort, limite: q.limit, offset: q.offset });
        const rotulos = await svc.rotulosDasConversas(ctx.organizationId, ctx.userId, r.files.map((f) => f.attachment.conversationId));
        return {
          files: r.files.map((f) => ({ ...apresentarAnexo(f.attachment), sender_name: f.senderName, thread_root_id: f.threadRootId, conversation: rotulos.get(f.attachment.conversationId) ?? null })),
          has_more: r.hasMore,
        };
      } catch (erro) { return falha(reply, erro); }
    });

    // ---------------- Objetos compartilhados, tarefa, agente ----------------

    rotas.get<{ Params: { objectId: string } }>('/internal-chat/objects/:objectId', async (request, reply) => {
      const ctx = contexto(request);
      try {
        const linha = await svc.objetoDaMensagem(ctx.organizationId, request.params.objectId);
        // Primeiro: quem pede pode ler a conversa onde o item foi compartilhado.
        await svc.conversaAcessivel(ctx.organizationId, ctx.userId, linha.conversationId);
        const atual = await estadoAtual(ctx, linha.objeto);
        return { id: linha.objeto.id, type: linha.objeto.objectType, provider: linha.objeto.provider, ...atual, ...(atual.state === 'ok' ? { object_id: linha.objeto.objectId, context: linha.objeto.context } : {}) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId/create-task', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
      const ctx = contexto(request);
      try {
        const body = z.object({
          idempotency_key: z.string().trim().min(8).max(80),
          title: z.string().trim().min(3).max(250),
          description: z.string().max(5000).nullable().optional(),
          client_id: z.string().uuid(),
          assignee_clickup_id: z.number().int().positive().nullable().optional(),
          due_date: z.number().int().positive().nullable().optional(),
          priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
        }).parse(request.body);
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, request.params.id);
        await svc.garantirEscrita(conversa, ctx.userId);
        const original = await svc.mensagemDaConversa(conversa, request.params.messageId);
        if (original.deletedAt) throw new svc.AcessoNegado('Mensagem não encontrada.');
        const origem = request.headers.origin ?? process.env.FRONTEND_URL?.split(',')[0] ?? '';
        const criada = await criarTarefaDaMensagem(ctx.user, conversa, original, {
          idempotencyKey: body.idempotency_key, title: body.title, description: body.description, clientId: body.client_id,
          assigneeClickupId: body.assignee_clickup_id, dueDate: body.due_date, priority: body.priority,
        }, `${origem}/comunicacao?c=${conversa.id}&m=${original.id}`);
        // O card só entra na conversa DEPOIS da confirmação do ClickUp, e uma vez só (mesma chave = mesmo card).
        const objetos = await validarObjetos(ctx, [{ type: 'task', id: criada.taskId }]).catch(() => [{
          objectType: 'task', objectId: criada.taskId, provider: 'clickup', context: {},
          snapshot: { name: body.title, client: { id: criada.clientId, name: criada.clientName }, url: criada.url, captured_at: new Date().toISOString() }, snapshotVersion: 1,
        }]);
        const resultado = await svc.enviarMensagem(conversa, ctx.userId, {
          content: 'criou uma tarefa a partir desta mensagem',
          clientMessageId: `tarefa-${body.idempotency_key}`,
          replyToId: original.threadRootId ? null : original.id,
          threadRootId: original.threadRootId,
        }, objetos);
        if (resultado.criada) {
          await avisar(await svc.destinatarios(conversa), 'message.created', { conversation_id: conversa.id, conversation_kind: conversa.kind, message: apresentarMensagem(resultado.mensagem, null) });
        }
        reply.code(criada.replay ? 200 : 201);
        return { task_id: criada.taskId, url: criada.url, replay: criada.replay, message: (await apresentarParaLeitor([resultado.mensagem], ctx))[0] };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post('/internal-chat/assist', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
      const ctx = contexto(request);
      try {
        const body = z.discriminatedUnion('action', [
          z.object({ action: z.literal('analyze_object'), object_id: z.string().uuid() }),
          z.object({ action: z.literal('summarize_conversation'), conversation_id: z.string().uuid(), thread_root_id: z.string().uuid().nullable().optional(), extra: z.string().max(500).optional() }),
        ]).parse(request.body);
        if (body.action === 'analyze_object') {
          const linha = await svc.objetoDaMensagem(ctx.organizationId, body.object_id);
          await svc.conversaAcessivel(ctx.organizationId, ctx.userId, linha.conversationId);
          const atual = await estadoAtual(ctx, linha.objeto);
          if (atual.state !== 'ok') throw new svc.DadoInvalido(atual.message);
          const cliente = (atual.data.client as { id?: string } | undefined)?.id ?? null;
          const r = await pedirAoAgente(ctx.user, { acao: 'analisar_objeto', tipo: linha.objeto.objectType, dados: { ...atual.data, context: linha.objeto.context }, clientId: cliente }, request.log);
          await auditarAcao(request, { action: 'internal_chat.agent_requested', resourceType: 'internal_message_object', resourceId: linha.objeto.id, metadata: { agent: r.agent, type: linha.objeto.objectType } });
          return { agent: r.agent.toLowerCase(), conversation_id: r.conversationId, execution_id: r.executionId };
        }
        const conversa = await svc.conversaAcessivel(ctx.organizationId, ctx.userId, body.conversation_id);
        // Só o que esta pessoa lê, e só porque ela pediu agora: as últimas 80 da linha (ou da thread).
        const pagina = await svc.paginaDeMensagens(conversa, { limite: 80, threadRootId: body.thread_root_id ?? undefined, viewerId: ctx.userId });
        const r = await pedirAoAgente(ctx.user, { acao: 'resumir_conversa', titulo: nomeDaConversa(conversa) || 'conversa privada', mensagens: pagina.messages, pedidoExtra: body.extra }, request.log);
        await auditarAcao(request, { action: 'internal_chat.agent_requested', resourceType: 'internal_conversation', resourceId: conversa.id, metadata: { agent: r.agent, messages: pagina.messages.length } });
        return { agent: r.agent.toLowerCase(), conversation_id: r.conversationId, execution_id: r.executionId };
      } catch (erro) { return falha(reply, erro); }
    });

    // ---------------- Arquivos ----------------

    rotas.get<{ Params: { id: string } }>('/internal-chat/conversations/:id/attachments', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const q = z.object({ kind: z.enum(['image', 'video', 'document', 'archive']).optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
        const [, arquivos] = await Promise.all([
          svc.conversaAcessivel(organizationId, userId, request.params.id),
          svc.arquivosDaConversa({ id: request.params.id }, { kind: q.kind, q: q.q, limite: q.limit }),
        ]);
        return { files: arquivos.map((a) => ({ ...apresentarAnexo(a.attachment), sender_name: a.senderName, thread_root_id: a.threadRootId })) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/attachment-policy', async () => {
      const politica = politicaDeAnexos();
      return { extensions: [...politica.permitidas], max_bytes: politica.limites };
    });

    /**
     * Upload em fluxo, direto para o armazenamento privado. Um arquivo por
     * requisição (a tela manda vários em paralelo, cada um com o próprio
     * progresso e botão de cancelar).
     */
    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/attachments', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const [conversa, usado] = await Promise.all([svc.conversaAcessivel(organizationId, userId, request.params.id), svc.espacoUsado(organizationId)]);
        await svc.garantirEscrita(conversa, userId);
        const politica = politicaDeAnexos();
        const file = await request.file({ limits: { fileSize: Math.max(...Object.values(politica.limites)) + 1 } });
        if (!file) { reply.code(400); return { error: 'Nenhum arquivo enviado.' }; }
        const gravado = await gravarAnexo({
          organizationId,
          conversationId: conversa.id,
          filename: file.filename,
          mimetype: file.mimetype,
          stream: file.file,
          usadoPelaOrganizacao: usado,
        });
        if (file.file.truncated) {
          await apagarAnexo(gravado.storageKey);
          throw new AnexoRecusado('Arquivo acima do limite.', 413);
        }
        const anexo = await svc.registrarAnexo({ conversa, uploaderId: userId, ...gravado, mimetype: gravado.servirComo });
        reply.code(201);
        return apresentarAnexo(anexo);
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get<{ Params: { attachmentId: string } }>('/internal-chat/attachments/:attachmentId', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const anexo = await svc.anexoAcessivel(organizationId, userId, request.params.attachmentId);
        const aberto = await abrirAnexo(anexo.storageKey, request.headers.range);
        const tipo = tipoParaServir(anexo.storageKey);
        // Inline só o que o navegador mostra sem executar nada (imagem, vídeo, PDF);
        // o resto sempre baixa. PDF inline vai com sandbox: sem script do documento.
        const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime|webm)|application\/pdf)$/.test(tipo) && (request.query as { download?: string }).download !== '1';
        reply.header('Content-Type', tipo);
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
        reply.header('Cache-Control', 'private, max-age=3600');
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(anexo.filename)}`);
        if (aberto.status === 416) { reply.code(416).header('Content-Range', `bytes */${aberto.size}`); return reply.send(); }
        if (aberto.status === 206) {
          reply.code(206).header('Content-Range', `bytes ${aberto.inicio}-${aberto.fim}/${aberto.size}`).header('Content-Length', aberto.fim - aberto.inicio + 1);
        } else {
          reply.header('Content-Length', aberto.size);
        }
        return reply.send(aberto.stream);
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') { reply.code(404); return { error: 'Arquivo não encontrado.' }; }
        return falha(reply, erro);
      }
    });
  });
}
