import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { organizacaoDaEscrita } from '@desigual-os/auth';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requirePermission, requireRole } from '../auth/middleware';
import { auditarAcao } from '../lib/auditoria';
import { uploadUserFile } from '../lib/storage';
import { brainPeloChat } from './brain';
import { bentoWhatsappConfig, pendenciasDeConfiguracao, type BentoWhatsappConfig } from './config';
import { GatewayDoBento } from './gateway';
import { gerarCodigoDeVinculo, telefoneLegivel, telefoneMascarado } from './identity';
import { OpenwaClient, OpenwaError } from './openwa/client';
import { OPENWA_SIGNATURE_HEADER, openwaWebhookEnvelopeSchema, type BentoWhatsappTransport } from './openwa/contract';
import { assinaturaOpenwaValida } from './openwa/signature';
import {
  armazemPostgres,
  codigoEmAndamento,
  codigosGeradosDesde,
  confirmarVinculo,
  criarCodigo,
  recusarCodigo,
  revogarVinculo,
  vinculoAtivoDoUsuario,
} from './store';
import { transcritorOpenAI } from './transcription';
import { carregarUsuarioDoCanal } from './usuario';

const logger = createLogger({ service: 'bento-whatsapp' });

const MAX_CODIGOS_POR_HORA = 5;

export interface OpcoesDasRotas {
  config?: BentoWhatsappConfig;
  transporte?: BentoWhatsappTransport;
  gateway?: GatewayDoBento;
  /** false nos testes: não roda a retomada de pendências na subida. */
  retomarNaSubida?: boolean;
}

function transporteDaConfig(config: BentoWhatsappConfig): BentoWhatsappTransport | null {
  if (!config.openwaBaseUrl || !config.openwaApiKey || !config.sessionId) return null;
  return new OpenwaClient({ baseUrl: config.openwaBaseUrl, apiKey: config.openwaApiKey, sessionId: config.sessionId });
}

function percentil(valores: number[], p: number): number | null {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length))]!;
}

/**
 * Rotas do Bento no WhatsApp.
 *
 *   POST /bento-whatsapp/webhook            público, assinado (OpenWA → Bento)
 *   GET  /bento-whatsapp/me                 meu vínculo / código em andamento
 *   POST /bento-whatsapp/me/link-code       gerar código de vínculo
 *   POST /bento-whatsapp/me/link-code/:id/confirm | /reject
 *   DELETE /bento-whatsapp/me/link          desvincular meu número
 *   GET  /bento-whatsapp/admin/status       painel (master)
 *   GET  /bento-whatsapp/admin/links        colaboradores vinculados (master)
 *   DELETE /bento-whatsapp/admin/links/:id  revogar (master)
 *   POST /bento-whatsapp/admin/session/start | GET /admin/session/qr (master)
 *
 * Não há rota de logout, exclusão ou criação de sessão: desconectar o número
 * do Bento ou abrir uma segunda sessão para ele é ato de quem tem o celular,
 * feito no próprio OpenWA — não um botão aqui.
 */
export async function registerBentoWhatsappRoutes(app: FastifyInstance, opcoes: OpcoesDasRotas = {}): Promise<void> {
  const config = opcoes.config ?? bentoWhatsappConfig();
  const transporte = opcoes.transporte ?? transporteDaConfig(config);
  const gateway =
    opcoes.gateway ??
    (transporte
      ? new GatewayDoBento({
          config,
          transporte,
          armazem: armazemPostgres,
          brain: brainPeloChat(logger),
          carregarUsuario: carregarUsuarioDoCanal,
          transcritor: config.transcriptionProvider === 'openai' ? transcritorOpenAI() : null,
          guardarAnexo: async ({ userId, filename, mimetype, bytes }) => {
            const enviado = await uploadUserFile(`bento-whatsapp/${userId}/${randomUUID()}/${filename}`, bytes, mimetype);
            return { url: enviado.url, filename, contentType: mimetype };
          },
          log: logger,
        })
      : null);

  if (config.enabled && gateway && opcoes.retomarNaSubida !== false) {
    setImmediate(() => {
      gateway
        .retomar()
        .then((r) => logger.info(r, '[bento-whatsapp] retomada na subida'))
        .catch((error: unknown) => logger.error({ error }, '[bento-whatsapp] retomada na subida falhou'));
    });
  }

  /* ---------------------------------------------------------------- */
  /* Webhook                                                            */
  /* ---------------------------------------------------------------- */

  await app.register(async (webhook) => {
    // Corpo cru SÓ neste escopo (mesmo motivo do webhook do ClickUp: parser
    // global quebrou outras rotas em 11/09/2026).
    webhook.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

    webhook.post(
      '/bento-whatsapp/webhook',
      { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
      async (request, reply) => {
        // Desligado: 200 e nada mais. Não grava, não processa, não responde no
        // WhatsApp. 200 para o OpenWA não ficar re-tentando à toa.
        if (!config.enabled) return { ok: true, ignored: 'disabled' };
        if (!config.webhookSecret || !gateway) {
          reply.code(503);
          return { error: 'Bento no WhatsApp sem configuração completa' };
        }
        const corpo = typeof request.body === 'string' ? request.body : '';
        const assinatura = request.headers[OPENWA_SIGNATURE_HEADER];
        if (!assinaturaOpenwaValida(corpo, typeof assinatura === 'string' ? assinatura : undefined, config.webhookSecret)) {
          request.log.warn({ ip: request.ip }, '[bento-whatsapp] webhook com assinatura inválida');
          reply.code(401);
          return { error: 'Invalid signature' };
        }
        let envelope;
        try {
          envelope = openwaWebhookEnvelopeSchema.parse(JSON.parse(corpo));
        } catch {
          reply.code(400);
          return { error: 'Invalid payload' };
        }
        // Evento de teste do próprio OpenWA (POST .../webhooks/:id/test).
        if (envelope.event === 'test') return { ok: true };
        try {
          const resultado = await gateway.receber(envelope);
          return { ok: true, ...resultado };
        } catch (error) {
          // Falha ao GRAVAR (banco fora): 503 faz o OpenWA re-tentar, e o
          // dedupe garante que o retry não vira resposta duplicada.
          request.log.error({ error }, '[bento-whatsapp] falha ao registrar mensagem recebida');
          reply.code(503);
          return { error: 'Falha temporária ao registrar a mensagem' };
        }
      },
    );
  });

  /* ---------------------------------------------------------------- */
  /* Vínculo (colaborador autenticado)                                  */
  /* ---------------------------------------------------------------- */

  app.get('/bento-whatsapp/me', { preHandler: [requireAuth] }, async (request) => {
    const user = request.authUser!;
    const agora = new Date();
    const [vinculo, codigo] = await Promise.all([vinculoAtivoDoUsuario(user.id), codigoEmAndamento(user.id, agora)]);
    return {
      enabled: config.enabled,
      bot_phone: config.botPhone ? telefoneLegivel(config.botPhone) : null,
      link: vinculo
        ? { id: vinculo.id, phone: telefoneLegivel(vinculo.phone), linked_at: vinculo.createdAt.toISOString() }
        : null,
      pending_code: codigo
        ? {
            id: codigo.id,
            status: codigo.status,
            expires_at: codigo.expiresAt.toISOString(),
            claimed_phone: codigo.claimedPhone ? telefoneLegivel(codigo.claimedPhone) : null,
          }
        : null,
    };
  });

  app.post(
    '/bento-whatsapp/me/link-code',
    {
      preHandler: [requireAuth, requirePermission('chat', 'write')],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!config.enabled) {
        reply.code(409);
        return { error: 'O Bento no WhatsApp ainda não está ativo.' };
      }
      const user = request.authUser!;
      const agora = new Date();
      const gerados = await codigosGeradosDesde(user.id, new Date(agora.getTime() - 60 * 60_000));
      if (gerados >= MAX_CODIGOS_POR_HORA) {
        reply.code(429);
        return { error: 'Muitos códigos gerados na última hora. Tente de novo mais tarde.' };
      }
      const organizationId = await organizacaoDaEscrita({ userId: user.id, clientId: null });
      const codigo = gerarCodigoDeVinculo();
      const { id, expiresAt } = await criarCodigo({ userId: user.id, organizationId, codigo, agora });
      await auditarAcao(request, {
        action: 'bento_whatsapp.link_code_created',
        organizationId,
        resourceType: 'bento_whatsapp_link_code',
        resourceId: id,
      });
      // O código volta UMA vez, só nesta resposta. No banco fica o hash.
      return {
        id,
        code: codigo,
        expires_at: expiresAt.toISOString(),
        bot_phone: config.botPhone ? telefoneLegivel(config.botPhone) : null,
        wa_link: config.botPhone ? `https://wa.me/${config.botPhone}?text=${encodeURIComponent(codigo)}` : null,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/bento-whatsapp/me/link-code/:id/confirm',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const user = request.authUser!;
      const agora = new Date();
      const organizationId = await organizacaoDaEscrita({ userId: user.id, clientId: null });
      const resultado = await confirmarVinculo({ userId: user.id, organizationId, codeId: request.params.id, agora });
      if (resultado.tipo === 'sem_codigo') {
        reply.code(404);
        return { error: 'Não há código aguardando confirmação. Gere um novo e envie ao Bento.' };
      }
      if (resultado.tipo === 'numero_ja_vinculado') {
        reply.code(409);
        return { error: 'Este número já está vinculado a outra pessoa. Um administrador precisa revogar o vínculo antigo.' };
      }
      await auditarAcao(request, {
        action: 'bento_whatsapp.linked',
        organizationId,
        resourceType: 'bento_whatsapp_link',
        resourceId: resultado.linkId,
        newValue: { phone: telefoneMascarado(resultado.phone) },
        ...(resultado.substituiu ? { oldValue: { phone: telefoneMascarado(resultado.substituiu) } } : {}),
      });
      if (transporte) {
        void transporte
          .sendText({
            chatId: (await vinculoAtivoDoUsuario(user.id))?.chatId ?? `${resultado.phone}@c.us`,
            text: `Pronto, ${user.name.split(' ')[0]}! Seu WhatsApp está vinculado. Pode me perguntar o que precisar — mande /ajuda para ver exemplos.`,
            idempotencyKey: `bento-whatsapp:vinculo:${resultado.linkId}`,
          })
          .catch((error: unknown) => logger.warn({ error }, '[bento-whatsapp] aviso de vínculo não saiu'));
      }
      return { ok: true, phone: telefoneLegivel(resultado.phone) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/bento-whatsapp/me/link-code/:id/reject',
    { preHandler: [requireAuth] },
    async (request) => {
      const recusado = await recusarCodigo(request.authUser!.id, request.params.id);
      if (recusado) {
        await auditarAcao(request, {
          action: 'bento_whatsapp.link_code_rejected',
          resourceType: 'bento_whatsapp_link_code',
          resourceId: request.params.id,
        });
      }
      return { ok: true };
    },
  );

  app.delete('/bento-whatsapp/me/link', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.authUser!;
    const vinculo = await vinculoAtivoDoUsuario(user.id);
    if (!vinculo) {
      reply.code(404);
      return { error: 'Nenhum WhatsApp vinculado.' };
    }
    await revogarVinculo({ linkId: vinculo.id, porUserId: user.id, motivo: 'user', agora: new Date(), somenteDoUsuario: user.id });
    await auditarAcao(request, {
      action: 'bento_whatsapp.unlinked',
      organizationId: vinculo.organizationId,
      resourceType: 'bento_whatsapp_link',
      resourceId: vinculo.id,
      oldValue: { phone: telefoneMascarado(vinculo.phone) },
    });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- */
  /* Painel administrativo (master)                                     */
  /* ---------------------------------------------------------------- */

  const soMaster = { preHandler: [requireAuth, requireRole('master')] };

  app.get('/bento-whatsapp/admin/status', soMaster, async () => {
    const agora = new Date();
    const desde = new Date(agora.getTime() - 24 * 60 * 60_000);
    const t = schema.bentoWhatsappInbound;

    let sessao: Record<string, unknown> = { status: 'not_configured' };
    if (transporte) {
      try {
        const s = await transporte.getSession();
        sessao = {
          status: s.status,
          phone: s.phone ? telefoneLegivel(s.phone) : null,
          connected_at: s.connectedAt ?? null,
          last_active: s.lastActive ?? null,
          last_error: s.lastError ?? null,
        };
      } catch (error) {
        sessao = {
          status: 'unreachable',
          error: error instanceof OpenwaError ? error.message : 'OpenWA inacessível',
        };
      }
    }

    const [porStatus, latencias, falhas, ultimaResposta, vinculados] = await Promise.all([
      db
        .select({ status: t.status, n: sql<number>`count(*)::int` })
        .from(t)
        .where(gte(t.createdAt, desde))
        .groupBy(t.status),
      db
        .select({ latencyMs: t.latencyMs })
        .from(t)
        .where(and(gte(t.createdAt, desde), sql`${t.latencyMs} is not null`, sql`${t.conversationId} is not null`)),
      // Estado, tempo e motivo. O TEXTO da mensagem não sai daqui.
      db
        .select({ id: t.id, createdAt: t.createdAt, status: t.status, reason: t.reason, error: t.error })
        .from(t)
        .where(sql`${t.status} in ('failed','send_failed') or ${t.reason} in ('brain_failed','brain_unavailable','brain_timeout')`)
        .orderBy(desc(t.createdAt))
        .limit(20),
      db
        .select({ repliedAt: t.repliedAt })
        .from(t)
        .where(and(eq(t.status, 'replied'), sql`${t.reason} is null`))
        .orderBy(desc(t.repliedAt))
        .limit(1),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bentoWhatsappLinks)
        .where(eq(schema.bentoWhatsappLinks.status, 'active')),
    ]);
    const valores = latencias.map((l) => l.latencyMs!).filter((v) => Number.isFinite(v));
    return {
      enabled: config.enabled,
      missing_config: pendenciasDeConfiguracao(config),
      bot_phone: config.botPhone ? telefoneLegivel(config.botPhone) : null,
      transcription: config.transcriptionProvider,
      documents: config.documentsEnabled,
      allowed_groups: config.allowedGroups.length,
      session: sessao,
      gateway: { ready: Boolean(gateway) },
      brain: { last_reply_at: ultimaResposta[0]?.repliedAt?.toISOString() ?? null },
      last_24h: {
        by_status: Object.fromEntries(porStatus.map((linha) => [linha.status, Number(linha.n)])),
        latency_ms: { p50: percentil(valores, 50), p95: percentil(valores, 95), samples: valores.length },
      },
      recent_failures: falhas.map((f) => ({
        id: f.id,
        at: f.createdAt.toISOString(),
        status: f.status,
        reason: f.reason,
        error: f.error,
      })),
      linked_users: Number(vinculados[0]?.n ?? 0),
    };
  });

  app.get('/bento-whatsapp/admin/links', soMaster, async () => {
    const v = schema.bentoWhatsappLinks;
    const linhas = await db
      .select({
        id: v.id,
        phone: v.phone,
        createdAt: v.createdAt,
        lastInboundAt: v.lastInboundAt,
        userId: v.userId,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(v)
      .innerJoin(schema.users, eq(schema.users.id, v.userId))
      .where(eq(v.status, 'active'))
      .orderBy(desc(v.createdAt));
    return {
      links: linhas.map((l) => ({
        id: l.id,
        user: { id: l.userId, name: l.name, email: l.email },
        phone: telefoneMascarado(l.phone),
        linked_at: l.createdAt.toISOString(),
        last_inbound_at: l.lastInboundAt?.toISOString() ?? null,
      })),
    };
  });

  app.delete<{ Params: { id: string } }>('/bento-whatsapp/admin/links/:id', soMaster, async (request, reply) => {
    const revogado = await revogarVinculo({
      linkId: request.params.id,
      porUserId: request.authUser!.id,
      motivo: 'admin',
      agora: new Date(),
    });
    if (!revogado) {
      reply.code(404);
      return { error: 'Vínculo não encontrado ou já revogado.' };
    }
    await auditarAcao(request, {
      action: 'bento_whatsapp.link_revoked_by_admin',
      organizationId: revogado.organizationId,
      resourceType: 'bento_whatsapp_link',
      resourceId: revogado.id,
      oldValue: { user_id: revogado.userId, phone: telefoneMascarado(revogado.phone) },
    });
    return { ok: true };
  });

  app.post('/bento-whatsapp/admin/session/start', soMaster, async (request, reply) => {
    if (!transporte) {
      reply.code(409);
      return { error: 'OpenWA não configurado', missing_config: pendenciasDeConfiguracao(config) };
    }
    try {
      const sessao = await transporte.startSession();
      await auditarAcao(request, { action: 'bento_whatsapp.session_started', metadata: { status: sessao.status } });
      return { status: sessao.status };
    } catch (error) {
      reply.code(error instanceof OpenwaError && error.status && error.status < 500 ? 409 : 502);
      return { error: error instanceof Error ? error.message : 'Falha ao iniciar a sessão' };
    }
  });

  app.get('/bento-whatsapp/admin/session/qr', soMaster, async (request, reply) => {
    if (!transporte) {
      reply.code(409);
      return { error: 'OpenWA não configurado', missing_config: pendenciasDeConfiguracao(config) };
    }
    try {
      const qr = await transporte.getQr();
      // Ver o QR é poder conectar o número do Bento: fica no rastro.
      await auditarAcao(request, { action: 'bento_whatsapp.session_qr_viewed', metadata: { status: qr.status } });
      return { qr_code: qr.qrCode, status: qr.status };
    } catch (error) {
      reply.code(error instanceof OpenwaError && error.status && error.status < 500 ? 409 : 502);
      return { error: error instanceof Error ? error.message : 'QR indisponível' };
    }
  });
}
