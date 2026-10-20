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
import { marcarPresenca, presentes } from './presenca';

/**
 * Comunicação interna — rotas. Todas exigem login, organização de trabalho e o
 * módulo 'comunicacao' no workspace; toda leitura/escrita passa por
 * `conversaAcessivel` (membro ativo; na privada, participante). Ids vindos do
 * cliente nunca bastam: trocar o id na URL de uma conversa alheia devolve 404.
 */

const logger = createLogger({ service: 'internal-chat' });

const enviarSchema = z.object({
  content: z.string().max(svc.LIMITE_DE_TEXTO).optional().nullable(),
  clientMessageId: z.string().trim().min(8).max(80),
  replyToId: z.string().uuid().optional().nullable(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  mentions: z.array(z.string().uuid()).max(50).optional(),
});

type Mensagem = svc.MensagemCompleta;

function apresentarMensagem(m: Mensagem) {
  return {
    id: m.message.id,
    conversation_id: m.message.conversationId,
    sender_id: m.message.senderId,
    sender_name: m.sender?.name ?? null,
    sender_avatar_url: m.sender?.avatarUrl ?? null,
    content: m.message.content,
    client_message_id: m.message.clientMessageId,
    reply_to: m.replyTo ? { id: m.replyTo.id, sender_name: m.replyTo.senderName, content: m.replyTo.content, deleted: m.replyTo.deleted } : null,
    mentions: m.message.mentions,
    created_at: m.message.createdAt.toISOString(),
    edited_at: m.message.editedAt?.toISOString() ?? null,
    deleted: Boolean(m.message.deletedAt),
    attachments: m.attachments.map(apresentarAnexo),
    reactions: m.reactions.map((r) => ({ emoji: r.emoji, user_ids: r.userIds })),
  };
}

function apresentarAnexo(a: typeof schema.internalMessageAttachments.$inferSelect) {
  return {
    id: a.id,
    message_id: a.messageId,
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

function falha(reply: FastifyReply, erro: unknown) {
  if (erro instanceof svc.AcessoNegado) { reply.code(404); return { error: erro.message }; }
  if (erro instanceof svc.DadoInvalido) { reply.code(400); return { error: erro.message }; }
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

/**
 * Notificação no sino para: privada nova, menção e resposta. Não notifica quem
 * silenciou a conversa nem quem está olhando para ela agora (leu nos últimos
 * 20 s — a tela marca como lida enquanto a conversa está aberta).
 */
async function notificar(conversa: Awaited<ReturnType<typeof svc.conversaAcessivel>>, mensagem: Mensagem, mencionados: string[], autorRespondido: string | null) {
  const remetente = mensagem.message.senderId;
  const nome = mensagem.sender?.name ?? 'Alguém';
  const trecho = (mensagem.message.content ?? (mensagem.attachments.length ? 'Enviou um arquivo' : '')).slice(0, 140);
  const alvos = new Map<string, { type: string; title: string }>();
  if (conversa.kind === 'direct') {
    for (const id of await svc.destinatarios(conversa)) if (id !== remetente) alvos.set(id, { type: 'chat.direct', title: `${nome} enviou uma mensagem` });
  }
  for (const id of mencionados) alvos.set(id, { type: 'chat.mention', title: `${nome} mencionou você${conversa.kind === 'general' ? ' no #Geral' : ''}` });
  if (autorRespondido && autorRespondido !== remetente) alvos.set(autorRespondido, { type: 'chat.reply', title: `${nome} respondeu sua mensagem` });
  if (alvos.size === 0) return;
  const estado = await svc.estadoDosMembros(conversa, [...alvos.keys()]);
  const agora = Date.now();
  const linhas = [...alvos].filter(([userId, alvo]) => {
    const e = estado.get(userId);
    if (e?.lastReadAt && agora - e.lastReadAt.getTime() < 20_000) return false;
    // Silenciar a conversa cala o recado comum; menção e resposta direta ainda chegam.
    if (e?.mutedAt && alvo.type === 'chat.direct') return false;
    return true;
  }).map(([userId, alvo]) => ({
    userId,
    organizationId: conversa.organizationId,
    type: alvo.type,
    title: alvo.title,
    body: trecho,
    link: `/comunicacao?c=${conversa.id}&m=${mensagem.message.id}`,
    dedupeKey: `chat:${mensagem.message.id}:${userId}`,
  }));
  if (linhas.length) await db.insert(schema.notifications).values(linhas).onConflictDoNothing();
}

function contexto(request: FastifyRequest) {
  return { organizationId: request.tenantContext!.organizationId, userId: request.authUser!.id };
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

    rotas.get('/internal-chat/conversations', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversas = await svc.listarConversas(organizationId, userId);
        void marcarPresenca(userId);
        const online = await presentes(conversas.map((c) => c.partner_id).filter((id): id is string => Boolean(id)));
        return {
          conversations: conversas.map((c) => ({
            id: c.id,
            kind: c.kind,
            title: c.kind === 'general' ? 'Geral' : c.partner_name ?? 'Colaborador',
            partner: c.partner_id ? { id: c.partner_id, name: c.partner_name, avatar_url: c.partner_avatar, online: online.has(c.partner_id) } : null,
            last_message: c.last_message_at ? {
              content: c.last_deleted ? null : c.last_content,
              deleted: Boolean(c.last_deleted),
              has_attachment: Boolean(c.last_has_attachment),
              sender_id: c.last_sender_id,
              created_at: new Date(c.last_message_at).toISOString(),
            } : null,
            unread_count: Number(c.unread),
            muted: Boolean(c.muted_at),
          })),
        };
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
        const online = await presentes(membros.map((m) => m.id));
        return { members: membros.map((m) => ({ id: m.id, name: m.name, avatar_url: m.avatarUrl, is_me: m.id === userId, online: online.has(m.id) })) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post('/internal-chat/conversations/direct', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ userId: z.string().uuid() }).parse(request.body);
        const conversa = await svc.abrirPrivada(organizationId, userId, body.userId);
        reply.code(201);
        return { id: conversa.id };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get<{ Params: { id: string } }>('/internal-chat/conversations/:id/messages', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const q = z.object({ before: z.string().uuid().optional(), after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }).parse(request.query);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const pagina = await svc.paginaDeMensagens(conversa, { antes: q.before, depois: q.after, limite: q.limit });
        return { messages: pagina.messages.map(apresentarMensagem), has_more: pagina.hasMore };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = enviarSchema.parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const resultado = await svc.enviarMensagem(conversa, userId, body);
        const mensagem = apresentarMensagem(resultado.mensagem);
        if (resultado.criada) {
          const quem = await svc.destinatarios(conversa);
          await avisar(quem, 'message.created', { conversation_id: conversa.id, conversation_kind: conversa.kind, message: mensagem });
          void notificar(conversa, resultado.mensagem, resultado.mencionados, resultado.autorRespondido).catch((error) => logger.warn({ error }, 'Falha ao criar notificação da Comunicação'));
        }
        reply.code(resultado.criada ? 201 : 200);
        return mensagem;
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.patch<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ content: z.string().max(svc.LIMITE_DE_TEXTO) }).parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const editada = apresentarMensagem(await svc.editarMensagem(conversa, userId, request.params.messageId, body.content));
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: editada });
        return editada;
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.delete<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const { mensagem, storageKeys } = await svc.excluirMensagem(conversa, userId, request.params.messageId);
        await Promise.all(storageKeys.map((k) => apagarAnexo(k).catch(() => undefined)));
        const apagada = apresentarMensagem(mensagem);
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: apagada });
        await auditarAcao(request, { action: 'internal_chat.message_deleted', resourceType: 'internal_message', resourceId: request.params.messageId, metadata: { conversation_id: conversa.id, attachments: storageKeys.length } });
        return apagada;
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string; messageId: string } }>('/internal-chat/conversations/:id/messages/:messageId/reactions', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const body = z.object({ emoji: z.string().min(1).max(16) }).parse(request.body);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const reagida = apresentarMensagem(await svc.alternarReacao(conversa, userId, request.params.messageId, body.emoji));
        await avisar(await svc.destinatarios(conversa), 'message.updated', { conversation_id: conversa.id, message: reagida });
        return reagida;
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.post<{ Params: { id: string } }>('/internal-chat/conversations/:id/read', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const quando = await svc.marcarComoLida(conversa, userId);
        // Outras abas da MESMA pessoa zeram o contador junto.
        await avisar([userId], 'conversation.read', { conversation_id: conversa.id, read_at: quando.toISOString() });
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
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        void marcarPresenca(userId);
        const outros = (await svc.destinatarios(conversa)).filter((id) => id !== userId);
        await avisar(outros, 'typing', { conversation_id: conversa.id, user_id: userId, user_name: request.authUser!.name ?? null });
        return { ok: true };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get('/internal-chat/search', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const q = z.object({ q: z.string().trim().min(2).max(100) }).parse(request.query);
        const achadas = await svc.buscar(organizationId, userId, q.q);
        return { results: achadas.map(apresentarMensagem) };
      } catch (erro) { return falha(reply, erro); }
    });

    rotas.get<{ Params: { id: string } }>('/internal-chat/conversations/:id/attachments', async (request, reply) => {
      const { organizationId, userId } = contexto(request);
      try {
        const q = z.object({ kind: z.enum(['image', 'video', 'document', 'archive']).optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const arquivos = await svc.arquivosDaConversa(conversa, { kind: q.kind, q: q.q, limite: q.limit });
        return { files: arquivos.map((a) => ({ ...apresentarAnexo(a.attachment), sender_name: a.senderName })) };
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
        const conversa = await svc.conversaAcessivel(organizationId, userId, request.params.id);
        const politica = politicaDeAnexos();
        const file = await request.file({ limits: { fileSize: Math.max(...Object.values(politica.limites)) + 1 } });
        if (!file) { reply.code(400); return { error: 'Nenhum arquivo enviado.' }; }
        const gravado = await gravarAnexo({
          organizationId,
          conversationId: conversa.id,
          filename: file.filename,
          mimetype: file.mimetype,
          stream: file.file,
          usadoPelaOrganizacao: await svc.espacoUsado(organizationId),
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
        const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime)|application\/pdf)$/.test(tipo) && (request.query as { download?: string }).download !== '1';
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
