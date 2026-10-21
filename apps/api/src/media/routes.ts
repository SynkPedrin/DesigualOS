import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  ALERT_TYPES,
  executeApprovedAction,
  mediaActionsEnabled,
  DEFAULT_TEMPLATES,
  MEDIA_SETTING_DEFS,
  MediaSettingError,
  getAccountSummary,
  getAgencyOverview,
  getHub,
  listAllCreatives,
  getMediaSettings,
  listCreatives,
  listEntities,
  listLinkedAccounts,
  listUnlinkedAccounts,
  providerOfAccount,
  renderTemplate,
  resolvePeriod,
  runAlertEvaluation,
  setMediaSetting,
  syncGoogleMedia,
  syncMediaForCentralConnection,
  validateTemplate,
  type MediaPeriod,
  type MediaScope,
} from '@desigual-os/tool-gateway';
import { hasPermission } from '@desigual-os/auth';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';

/**
 * media/routes.ts — API do Media Command Center.
 *
 * Toda rota passa por: autenticação → permissão de clientes → módulo meta_ads
 * no workspace da pessoa → tenant (a empresa de trabalho). O recorte por
 * empresa é aplicado DENTRO das funções de leitura (media-queries.ts), então
 * nenhuma rota consegue devolver conta de outra empresa por esquecimento.
 *
 * A leitura vem do banco (sincronizado pelo worker). Estas rotas não chamam o
 * Meta, exceto o botão de sincronizar.
 */

const PERIODS = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'] as const;
const periodParam = z.enum(PERIODS);
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const read = [requireAuth, requirePermission('clients', 'read'), requireModule('meta_ads'), requireTenant];
const write = [requireAuth, requirePermission('clients', 'write'), requireModule('meta_ads'), requireTenant];

function scopeOf(request: FastifyRequest): MediaScope {
  // Pertencer à organização dá acesso aos clientes dela (mesma regra de hasClientAccess).
  return { organizationId: request.tenantContext!.organizationId, clientIds: null };
}

function fail(reply: FastifyReply, code: number, error: string) {
  reply.code(code);
  return { error };
}

function rangeFrom(query: { period?: string | undefined; since?: string | undefined; until?: string | undefined }) {
  if (query.since && query.until) {
    const since = dateParam.safeParse(query.since);
    const until = dateParam.safeParse(query.until);
    if (!since.success || !until.success || query.since > query.until) return null;
    return { since: query.since, until: query.until };
  }
  const period = periodParam.safeParse(query.period ?? 'last_30d');
  return period.success ? resolvePeriod(period.data as MediaPeriod) : null;
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // ── Visão consolidada da agência ───────────────────────────────────────
  app.get<{ Querystring: { period?: string; since?: string; until?: string } }>('/media/overview-v3', { preHandler: read }, async (request, reply) => {
    const range = rangeFrom(request.query);
    if (!range) return fail(reply, 400, 'Período inválido.');
    return getAgencyOverview(scopeOf(request), range);
  });

  // ── Contas ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { client_id?: string } }>('/media/accounts', { preHandler: read }, async (request) => {
    const scope = scopeOf(request);
    const linked = await listLinkedAccounts(scope, request.query.client_id ? { clientId: request.query.client_id } : {});
    // Contas sem cliente só aparecem para quem pode vincular, e só na listagem geral.
    const canLink = hasPermission(request.authUser!.permissions, 'clients', 'write');
    const unlinked = request.query.client_id || !canLink ? [] : await listUnlinkedAccounts(scope.organizationId);
    return { linked, unlinked };
  });

  app.get<{ Params: { accountId: string }; Querystring: { period?: string; since?: string; until?: string; compare?: string } }>(
    '/media/accounts/:accountId/summary',
    { preHandler: read },
    async (request, reply) => {
      const range = rangeFrom(request.query);
      if (!range) return fail(reply, 400, 'Período inválido.');
      const summary = await getAccountSummary(scopeOf(request), request.params.accountId, range, request.query.compare !== 'false');
      if (!summary) return fail(reply, 404, 'Conta não encontrada para esta empresa.');
      return summary;
    },
  );

  const entityQuery = z.object({
    level: z.enum(['campaign', 'adset', 'ad']).default('campaign'),
    parent_id: z.string().optional(),
    search: z.string().max(100).optional(),
    status: z.string().max(40).optional(),
    sort: z.enum(['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'results', 'costPerResult', 'name']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    period: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  });

  app.get<{ Params: { accountId: string } }>('/media/accounts/:accountId/entities', { preHandler: read }, async (request, reply) => {
    const q = entityQuery.safeParse(request.query);
    if (!q.success) return fail(reply, 400, q.error.issues.map((i) => i.message).join(' '));
    const range = rangeFrom(q.data);
    if (!range) return fail(reply, 400, 'Período inválido.');
    const rows = await listEntities(scopeOf(request), request.params.accountId, {
      level: q.data.level,
      range,
      ...(q.data.parent_id ? { parentId: q.data.parent_id } : {}),
      ...(q.data.search ? { search: q.data.search } : {}),
      ...(q.data.status ? { status: q.data.status } : {}),
      ...(q.data.sort ? { sortBy: q.data.sort } : {}),
      ...(q.data.dir ? { sortDir: q.data.dir } : {}),
      ...(q.data.limit ? { limit: q.data.limit } : {}),
    });
    if (!rows) return fail(reply, 404, 'Conta não encontrada para esta empresa.');
    return { range, rows };
  });

  app.get<{ Params: { accountId: string } }>('/media/accounts/:accountId/creatives', { preHandler: read }, async (request, reply) => {
    const q = entityQuery.omit({ level: true }).safeParse(request.query);
    if (!q.success) return fail(reply, 400, q.error.issues.map((i) => i.message).join(' '));
    const range = rangeFrom(q.data);
    if (!range) return fail(reply, 400, 'Período inválido.');
    const rows = await listCreatives(scopeOf(request), request.params.accountId, {
      range,
      ...(q.data.parent_id ? { parentId: q.data.parent_id } : {}),
      ...(q.data.search ? { search: q.data.search } : {}),
      ...(q.data.status ? { status: q.data.status } : {}),
      ...(q.data.sort ? { sortBy: q.data.sort } : {}),
      ...(q.data.dir ? { sortDir: q.data.dir } : {}),
      limit: q.data.limit ?? 200,
    });
    if (!rows) return fail(reply, 404, 'Conta não encontrada para esta empresa.');
    return { range, rows };
  });

  // ── Sincronização ──────────────────────────────────────────────────────
  app.post<{ Params: { accountId: string } }>('/media/accounts/:accountId/sync', { preHandler: write }, async (request, reply) => {
    const scope = scopeOf(request);
    const accounts = await listLinkedAccounts(scope);
    if (!accounts.some((a) => a.accountId === request.params.accountId)) return fail(reply, 404, 'Conta não encontrada para esta empresa.');
    try {
      if (providerOfAccount(request.params.accountId) === 'google_ads') {
        const g = await syncGoogleMedia({ onlyCustomerId: request.params.accountId });
        await auditarAcao(request, { action: 'media.account.synced', organizationId: scope.organizationId, metadata: { accountId: request.params.accountId, provider: 'google_ads' } });
        if (g.accountsFailed.length > 0) return fail(reply, 502, g.accountsFailed[0]!.error);
        return g;
      }
      const report = await syncMediaForCentralConnection({ onlyAccountId: request.params.accountId });
      if ('status' in report) return fail(reply, 409, 'Conexão central do Meta não está ativa.');
      await auditarAcao(request, { action: 'media.account.synced', organizationId: scope.organizationId, metadata: { accountId: request.params.accountId } });
      return report;
    } catch (error) {
      return fail(reply, 502, error instanceof Error ? error.message : 'Falha ao sincronizar.');
    }
  });

  app.get('/media/sync-runs', { preHandler: read }, async (request) => {
    const rows = await db
      .select()
      .from(schema.mediaSyncRuns)
      .where(eq(schema.mediaSyncRuns.organizationId, scopeOf(request).organizationId))
      .orderBy(desc(schema.mediaSyncRuns.startedAt))
      .limit(50);
    return { runs: rows };
  });

  // ── Configurações (fonte única) ────────────────────────────────────────
  app.get<{ Querystring: { client_id?: string; account_id?: string } }>('/media/settings', { preHandler: read }, async (request) => {
    const accountKey = request.query.account_id ? `${providerOfAccount(request.query.account_id)}:${request.query.account_id}` : null;
    const resolved = await getMediaSettings(scopeOf(request).organizationId, request.query.client_id ?? null, accountKey);
    return { ...resolved, keys: Object.keys(MEDIA_SETTING_DEFS) };
  });

  const settingBody = z.object({
    key: z.string(),
    value: z.unknown(),
    client_id: z.string().uuid().nullish(),
    account_id: z.string().nullish(),
    reset: z.boolean().optional(),
  });
  app.put('/media/settings', { preHandler: write }, async (request, reply) => {
    const body = settingBody.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const scope = scopeOf(request);
    if (body.data.client_id) {
      const ok = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, body.data.client_id), eq(schema.clients.organizationId, scope.organizationId)));
      if (ok.length === 0) return fail(reply, 404, 'Cliente não encontrado nesta empresa.');
    }
    try {
      await setMediaSetting({
        organizationId: scope.organizationId,
        clientId: body.data.client_id ?? null,
        accountKey: body.data.account_id ? `${providerOfAccount(body.data.account_id)}:${body.data.account_id}` : null,
        key: body.data.key,
        value: body.data.reset ? undefined : body.data.value,
        userId: request.authUser!.id,
      });
    } catch (error) {
      if (error instanceof MediaSettingError) return fail(reply, 400, error.message);
      throw error;
    }
    return getMediaSettings(scope.organizationId, body.data.client_id ?? null, body.data.account_id ? `${providerOfAccount(body.data.account_id)}:${body.data.account_id}` : null);
  });

  // ── Regras de alerta ───────────────────────────────────────────────────
  const destinationSchema = z.object({ kind: z.enum(['group', 'contact']), externalId: z.string().min(1), label: z.string().min(1) }).nullable();
  const ruleBody = z.object({
    client_id: z.string().uuid(),
    account_id: z.string().min(1),
    type: z.enum(ALERT_TYPES),
    threshold: z.number().nullable().optional(),
    window_days: z.number().int().min(1).max(30).optional(),
    cooldown_hours: z.number().int().min(1).max(720).optional(),
    destination: destinationSchema.optional(),
    template_id: z.string().uuid().nullable().optional(),
    send_window: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
    send_enabled: z.boolean().optional(),
    enabled: z.boolean().optional(),
  });

  app.get<{ Querystring: { client_id?: string } }>('/media/alert-rules', { preHandler: read }, async (request) => {
    const org = scopeOf(request).organizationId;
    const rules = await db
      .select()
      .from(schema.mediaAlertRules)
      .where(request.query.client_id ? and(eq(schema.mediaAlertRules.organizationId, org), eq(schema.mediaAlertRules.clientId, request.query.client_id)) : eq(schema.mediaAlertRules.organizationId, org))
      .orderBy(desc(schema.mediaAlertRules.createdAt));
    return { rules, types: ALERT_TYPES };
  });

  async function accountBelongsToClient(org: string, clientId: string, accountId: string): Promise<boolean> {
    const rows = await listLinkedAccounts({ organizationId: org, clientIds: [clientId] }, { clientId });
    return rows.some((r) => r.accountId === accountId);
  }

  app.post('/media/alert-rules', { preHandler: write }, async (request, reply) => {
    const body = ruleBody.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const org = scopeOf(request).organizationId;
    if (!(await accountBelongsToClient(org, body.data.client_id, body.data.account_id))) return fail(reply, 400, 'Esta conta não está vinculada a este cliente.');
    const settings = await getMediaSettings(org, body.data.client_id, `${providerOfAccount(body.data.account_id)}:${body.data.account_id}`);
    const [rule] = await db
      .insert(schema.mediaAlertRules)
      .values({
        organizationId: org,
        clientId: body.data.client_id,
        provider: providerOfAccount(body.data.account_id),
        accountExternalId: body.data.account_id,
        type: body.data.type,
        threshold: body.data.threshold === null || body.data.threshold === undefined ? null : String(body.data.threshold),
        windowDays: body.data.window_days ?? 1,
        cooldownHours: body.data.cooldown_hours ?? settings.values['alerts.defaultCooldownHours'],
        destination: body.data.destination ?? null,
        templateId: body.data.template_id ?? null,
        sendWindow: body.data.send_window ?? null,
        // Envio real nasce DESLIGADO, mesmo que o corpo peça: ligar é um PATCH explícito e auditado.
        sendEnabled: false,
        enabled: body.data.enabled ?? true,
        createdBy: request.authUser!.id,
      })
      .returning();
    await auditarAcao(request, { action: 'media.alert_rule.created', organizationId: org, clientId: body.data.client_id, metadata: { ruleId: rule!.id, type: body.data.type } });
    return rule;
  });

  app.patch<{ Params: { id: string } }>('/media/alert-rules/:id', { preHandler: write }, async (request, reply) => {
    const body = ruleBody.partial().safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const org = scopeOf(request).organizationId;
    const [current] = await db.select().from(schema.mediaAlertRules).where(and(eq(schema.mediaAlertRules.id, request.params.id), eq(schema.mediaAlertRules.organizationId, org)));
    if (!current) return fail(reply, 404, 'Regra não encontrada.');
    const patch: Partial<typeof schema.mediaAlertRules.$inferInsert> = {};
    if (body.data.threshold !== undefined) patch.threshold = body.data.threshold === null ? null : String(body.data.threshold);
    if (body.data.window_days !== undefined) patch.windowDays = body.data.window_days;
    if (body.data.cooldown_hours !== undefined) patch.cooldownHours = body.data.cooldown_hours;
    if (body.data.destination !== undefined) patch.destination = body.data.destination;
    if (body.data.template_id !== undefined) patch.templateId = body.data.template_id;
    if (body.data.send_window !== undefined) patch.sendWindow = body.data.send_window;
    if (body.data.enabled !== undefined) patch.enabled = body.data.enabled;
    if (body.data.send_enabled !== undefined) {
      const dest = body.data.destination !== undefined ? body.data.destination : current.destination;
      if (body.data.send_enabled && !dest) return fail(reply, 400, 'Escolha um destino antes de ligar o envio.');
      patch.sendEnabled = body.data.send_enabled;
    }
    const [rule] = await db.update(schema.mediaAlertRules).set(patch).where(eq(schema.mediaAlertRules.id, current.id)).returning();
    await auditarAcao(request, { action: 'media.alert_rule.updated', organizationId: org, clientId: current.clientId, metadata: { ruleId: current.id, changes: Object.keys(patch), sendEnabled: patch.sendEnabled } });
    return rule;
  });

  app.delete<{ Params: { id: string } }>('/media/alert-rules/:id', { preHandler: write }, async (request, reply) => {
    const org = scopeOf(request).organizationId;
    const deleted = await db.delete(schema.mediaAlertRules).where(and(eq(schema.mediaAlertRules.id, request.params.id), eq(schema.mediaAlertRules.organizationId, org))).returning({ id: schema.mediaAlertRules.id });
    if (deleted.length === 0) return fail(reply, 404, 'Regra não encontrada.');
    await auditarAcao(request, { action: 'media.alert_rule.deleted', organizationId: org, metadata: { ruleId: request.params.id } });
    return { ok: true };
  });

  // ── Central de alertas ─────────────────────────────────────────────────
  app.get<{ Querystring: { status?: string; client_id?: string; limit?: string } }>('/media/alerts', { preHandler: read }, async (request) => {
    const org = scopeOf(request).organizationId;
    const conds = [eq(schema.mediaAlertEvents.organizationId, org)];
    if (request.query.status) conds.push(eq(schema.mediaAlertEvents.status, request.query.status));
    if (request.query.client_id) conds.push(eq(schema.mediaAlertEvents.clientId, request.query.client_id));
    const events = await db
      .select({ event: schema.mediaAlertEvents, clientName: schema.clients.name })
      .from(schema.mediaAlertEvents)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.mediaAlertEvents.clientId))
      .where(and(...conds))
      .orderBy(desc(schema.mediaAlertEvents.firedAt))
      .limit(Math.min(Number(request.query.limit ?? 100) || 100, 300));
    return { alerts: events.map((e) => ({ ...e.event, clientName: e.clientName })) };
  });

  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/media/alerts/:id', { preHandler: write }, async (request, reply) => {
    const status = z.enum(['open', 'resolved', 'ignored']).safeParse(request.body?.status);
    if (!status.success) return fail(reply, 400, 'status deve ser open, resolved ou ignored.');
    const org = scopeOf(request).organizationId;
    const updated = await db
      .update(schema.mediaAlertEvents)
      .set({ status: status.data, resolvedAt: status.data === 'open' ? null : new Date() })
      .where(and(eq(schema.mediaAlertEvents.id, request.params.id), eq(schema.mediaAlertEvents.organizationId, org)))
      .returning({ id: schema.mediaAlertEvents.id });
    if (updated.length === 0) return fail(reply, 404, 'Alerta não encontrado.');
    await auditarAcao(request, { action: 'media.alert.status_changed', organizationId: org, metadata: { alertId: request.params.id, status: status.data } });
    return { ok: true };
  });

  /** Avalia agora, só as regras desta empresa. Não reenvia o que já foi enviado: a deduplicação vale igual. */
  app.post('/media/alerts/evaluate', { preHandler: write }, async (request) => {
    return runAlertEvaluation({ organizationId: scopeOf(request).organizationId });
  });

  // ── Templates de mensagem ──────────────────────────────────────────────
  app.get('/media/templates', { preHandler: read }, async (request) => {
    const custom = await db.select().from(schema.mediaMessageTemplates).where(eq(schema.mediaMessageTemplates.organizationId, scopeOf(request).organizationId));
    const overridden = new Set(custom.map((c) => c.code).filter(Boolean));
    return { templates: [...custom.map((c) => ({ id: c.id, code: c.code, name: c.name, body: c.body, enabled: c.enabled, isDefault: false })), ...DEFAULT_TEMPLATES.filter((d) => !overridden.has(d.code)).map((d) => ({ id: null, code: d.code, name: d.name, body: d.body, enabled: true, isDefault: true }))] };
  });

  const templateBody = z.object({ code: z.string().nullish(), name: z.string().min(1).max(80), body: z.string().min(1).max(1000), enabled: z.boolean().optional() });
  app.post('/media/templates', { preHandler: write }, async (request, reply) => {
    const body = templateBody.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const v = validateTemplate(body.data.body);
    if (!v.ok) return fail(reply, 400, v.unknown.length ? `Variáveis desconhecidas: ${v.unknown.join(', ')}` : 'Mensagem vazia.');
    const org = scopeOf(request).organizationId;
    const [row] = await db.insert(schema.mediaMessageTemplates).values({ organizationId: org, code: body.data.code ?? null, name: body.data.name, body: body.data.body, enabled: body.data.enabled ?? true, updatedBy: request.authUser!.id }).returning();
    await auditarAcao(request, { action: 'media.template.created', organizationId: org, metadata: { templateId: row!.id } });
    return row;
  });

  app.put<{ Params: { id: string } }>('/media/templates/:id', { preHandler: write }, async (request, reply) => {
    const body = templateBody.partial().safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    if (body.data.body !== undefined) {
      const v = validateTemplate(body.data.body);
      if (!v.ok) return fail(reply, 400, v.unknown.length ? `Variáveis desconhecidas: ${v.unknown.join(', ')}` : 'Mensagem vazia.');
    }
    const org = scopeOf(request).organizationId;
    const [row] = await db
      .update(schema.mediaMessageTemplates)
      .set({ ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(body.data.body !== undefined ? { body: body.data.body } : {}), ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}), updatedBy: request.authUser!.id })
      .where(and(eq(schema.mediaMessageTemplates.id, request.params.id), eq(schema.mediaMessageTemplates.organizationId, org)))
      .returning();
    if (!row) return fail(reply, 404, 'Template não encontrado.');
    await auditarAcao(request, { action: 'media.template.updated', organizationId: org, metadata: { templateId: row.id } });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/media/templates/:id', { preHandler: write }, async (request, reply) => {
    const org = scopeOf(request).organizationId;
    const gone = await db.delete(schema.mediaMessageTemplates).where(and(eq(schema.mediaMessageTemplates.id, request.params.id), eq(schema.mediaMessageTemplates.organizationId, org))).returning({ id: schema.mediaMessageTemplates.id });
    if (gone.length === 0) return fail(reply, 404, 'Template não encontrado.');
    await auditarAcao(request, { action: 'media.template.deleted', organizationId: org, metadata: { templateId: request.params.id } });
    return { ok: true };
  });

  /** Pré-visualização com valores de exemplo marcados como exemplo. Nunca envia nada. */
  app.post<{ Body: { body?: string; values?: Record<string, string> } }>('/media/templates/preview', { preHandler: read }, async (request, reply) => {
    const body = z.object({ body: z.string().min(1).max(1000), values: z.record(z.string()).optional() }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Informe a mensagem.');
    const sample = { cliente: 'Cliente Exemplo', plataforma: 'Meta Ads', conta: 'Conta Exemplo', saldo: 'R$ 100,00', orcamento: 'R$ 1.000,00', investimento: 'R$ 250,00', cpl: 'R$ 12,50', cpa: 'R$ 40,00', leads: '20', periodo: 'últimos 7 dias', data: '20/10/2026', link_relatorio: 'https://exemplo.invalid/relatorio' };
    const result = renderTemplate(body.data.body, { ...sample, ...(body.data.values ?? {}) });
    return result.ok ? { ok: true, text: result.text, isSample: !body.data.values } : { ok: false, reason: result.reason, variables: result.variables };
  });

  // ── Destinos de WhatsApp (reais, da sessão conectada) ──────────────────
  app.get('/media/whatsapp/destinations', { preHandler: read }, async (request) => {
    const org = scopeOf(request).organizationId;
    const sessions = await db
      .select({ id: schema.whatsappSessions.id, status: schema.whatsappSessions.status, name: schema.whatsappSessions.externalName })
      .from(schema.whatsappSessions)
      .where(eq(schema.whatsappSessions.organizationId, org));
    const ready = sessions.filter((s) => s.status === 'ready');
    const groups = ready.length
      ? await db
          .select({ id: schema.whatsappGroups.externalGroupId, name: schema.whatsappGroups.name, sessionId: schema.whatsappGroups.sessionId })
          .from(schema.whatsappGroups)
          .where(and(eq(schema.whatsappGroups.organizationId, org), inArray(schema.whatsappGroups.sessionId, ready.map((s) => s.id))))
          .orderBy(schema.whatsappGroups.name)
      : [];
    const contacts = ready.length
      ? await db
          .select({ id: schema.contacts.id, name: schema.contacts.name, phone: schema.contacts.phone, externalIds: schema.contacts.externalIds })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.organizationId, org), sql`${schema.contacts.externalIds} ? 'whatsapp'`))
          .orderBy(schema.contacts.name)
          .limit(500)
      : [];
    return {
      sessions: sessions.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      // O envio automático só considera sessão 'ready'. Sem ela, a lista vem vazia e a tela explica por quê.
      groups: groups.map((g) => ({ kind: 'group' as const, externalId: g.id, label: g.name, sessionId: g.sessionId })),
      contacts: contacts.map((c) => ({ kind: 'contact' as const, externalId: (c.externalIds as Record<string, string>).whatsapp!, label: c.name ?? c.phone ?? 'Sem nome', phone: c.phone })),
      sendConfigured: await db.select({ id: schema.organizationConnectors.id }).from(schema.organizationConnectors).where(and(eq(schema.organizationConnectors.organizationId, org), eq(schema.organizationConnectors.provider, 'whatsapp'))).then((r) => r.length > 0),
    };
  });

  // ── Agendamento de relatórios ──────────────────────────────────────────
  const scheduleBody = z.object({
    client_id: z.string().uuid(),
    frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
    day_of_week: z.number().int().min(0).max(6).nullable().optional(),
    day_of_month: z.number().int().min(1).max(28).nullable().optional(),
    hour: z.number().int().min(0).max(23).optional(),
    channels: z.array(z.enum(['meta', 'google_ads'])).min(1).optional(),
    period_days: z.number().int().min(1).max(90).optional(),
    destination: destinationSchema.optional(),
    template_id: z.string().uuid().nullable().optional(),
    enabled: z.boolean().optional(),
  });

  app.get<{ Querystring: { client_id?: string } }>('/media/report-schedules', { preHandler: read }, async (request) => {
    const org = scopeOf(request).organizationId;
    const rows = await db
      .select()
      .from(schema.mediaReportSchedules)
      .where(request.query.client_id ? and(eq(schema.mediaReportSchedules.organizationId, org), eq(schema.mediaReportSchedules.clientId, request.query.client_id)) : eq(schema.mediaReportSchedules.organizationId, org))
      .orderBy(desc(schema.mediaReportSchedules.createdAt));
    return { schedules: rows };
  });

  function scheduleShapeError(b: z.infer<typeof scheduleBody>): string | null {
    if ((b.frequency === 'weekly' || b.frequency === 'biweekly') && (b.day_of_week === null || b.day_of_week === undefined)) return 'Escolha o dia da semana.';
    if (b.frequency === 'monthly' && (b.day_of_month === null || b.day_of_month === undefined)) return 'Escolha o dia do mês (1 a 28).';
    return null;
  }

  app.post('/media/report-schedules', { preHandler: write }, async (request, reply) => {
    const body = scheduleBody.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const problem = scheduleShapeError(body.data);
    if (problem) return fail(reply, 400, problem);
    const org = scopeOf(request).organizationId;
    const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, body.data.client_id), eq(schema.clients.organizationId, org)));
    if (!client) return fail(reply, 404, 'Cliente não encontrado nesta empresa.');
    const [row] = await db
      .insert(schema.mediaReportSchedules)
      .values({
        organizationId: org,
        clientId: body.data.client_id,
        frequency: body.data.frequency,
        dayOfWeek: body.data.day_of_week ?? null,
        dayOfMonth: body.data.day_of_month ?? null,
        hour: body.data.hour ?? 9,
        channels: body.data.channels ?? ['meta'],
        periodDays: body.data.period_days ?? 7,
        destination: body.data.destination ?? null,
        templateId: body.data.template_id ?? null,
        // O envio do relatório por WhatsApp não nasce ligado: gerar é seguro, mandar para cliente é decisão explícita.
        sendEnabled: false,
        enabled: body.data.enabled ?? true,
        createdBy: request.authUser!.id,
      })
      .returning();
    await auditarAcao(request, { action: 'media.report_schedule.created', organizationId: org, clientId: body.data.client_id, metadata: { scheduleId: row!.id, frequency: body.data.frequency } });
    return row;
  });

  app.patch<{ Params: { id: string } }>('/media/report-schedules/:id', { preHandler: write }, async (request, reply) => {
    const body = z.object({ enabled: z.boolean().optional(), hour: z.number().int().min(0).max(23).optional(), period_days: z.number().int().min(1).max(90).optional() }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const org = scopeOf(request).organizationId;
    const [row] = await db
      .update(schema.mediaReportSchedules)
      .set({ ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}), ...(body.data.hour !== undefined ? { hour: body.data.hour } : {}), ...(body.data.period_days !== undefined ? { periodDays: body.data.period_days } : {}) })
      .where(and(eq(schema.mediaReportSchedules.id, request.params.id), eq(schema.mediaReportSchedules.organizationId, org)))
      .returning();
    if (!row) return fail(reply, 404, 'Agendamento não encontrado.');
    await auditarAcao(request, { action: 'media.report_schedule.updated', organizationId: org, metadata: { scheduleId: row.id, changes: Object.keys(body.data) } });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/media/report-schedules/:id', { preHandler: write }, async (request, reply) => {
    const org = scopeOf(request).organizationId;
    const gone = await db.delete(schema.mediaReportSchedules).where(and(eq(schema.mediaReportSchedules.id, request.params.id), eq(schema.mediaReportSchedules.organizationId, org))).returning({ id: schema.mediaReportSchedules.id });
    if (gone.length === 0) return fail(reply, 404, 'Agendamento não encontrado.');
    await auditarAcao(request, { action: 'media.report_schedule.deleted', organizationId: org, metadata: { scheduleId: request.params.id } });
    return { ok: true };
  });

  // ── Ações em campanha: pedido → aprovação humana → execução ────────────
  const actionBody = z.object({
    client_id: z.string().uuid(),
    account_id: z.string().min(1),
    action: z.enum(['pause_campaign', 'resume_campaign', 'set_budget']),
    campaign_id: z.string().min(1),
    daily_budget: z.number().positive().optional(),
  });

  app.get('/media/actions', { preHandler: read }, async (request) => {
    const rows = await db
      .select({ action: schema.mediaActionRequests, clientName: schema.clients.name })
      .from(schema.mediaActionRequests)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.mediaActionRequests.clientId))
      .where(eq(schema.mediaActionRequests.organizationId, scopeOf(request).organizationId))
      .orderBy(desc(schema.mediaActionRequests.createdAt))
      .limit(100);
    return { executionEnabled: mediaActionsEnabled(), actions: rows.map((r) => ({ ...r.action, clientName: r.clientName })) };
  });

  app.post('/media/actions', { preHandler: write }, async (request, reply) => {
    const body = actionBody.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    if (providerOfAccount(body.data.account_id) !== 'meta') return fail(reply, 400, 'Ações em campanha só estão disponíveis para o Meta Ads por enquanto.');
    if (body.data.action === 'set_budget' && body.data.daily_budget === undefined) return fail(reply, 400, 'Informe o orçamento diário.');
    const org = scopeOf(request).organizationId;
    if (!(await accountBelongsToClient(org, body.data.client_id, body.data.account_id))) return fail(reply, 400, 'Esta conta não está vinculada a este cliente.');
    const [row] = await db
      .insert(schema.mediaActionRequests)
      .values({
        organizationId: org,
        clientId: body.data.client_id,
        provider: providerOfAccount(body.data.account_id),
        accountExternalId: body.data.account_id,
        action: body.data.action,
        targetExternalId: body.data.campaign_id,
        payload: body.data.daily_budget !== undefined ? { dailyBudget: body.data.daily_budget } : {},
        requestedBy: request.authUser!.id,
        requestedVia: 'web',
      })
      .returning();
    await auditarAcao(request, { action: 'media.action.requested', organizationId: org, clientId: body.data.client_id, metadata: { actionId: row!.id, action: body.data.action, campaignId: body.data.campaign_id } });
    return row;
  });

  /** Decisão humana. `confirm: true` é exigido na aprovação: ninguém aprova sem o gesto explícito. */
  app.post<{ Params: { id: string } }>('/media/actions/:id/decision', { preHandler: write }, async (request, reply) => {
    const body = z.object({ decision: z.enum(['approve', 'reject']), confirm: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Decisão inválida.');
    if (body.data.decision === 'approve' && body.data.confirm !== true) return fail(reply, 400, 'Aprovar exige confirmação explícita.');
    const org = scopeOf(request).organizationId;
    const [current] = await db.select().from(schema.mediaActionRequests).where(and(eq(schema.mediaActionRequests.id, request.params.id), eq(schema.mediaActionRequests.organizationId, org)));
    if (!current) return fail(reply, 404, 'Pedido não encontrado.');
    if (current.status !== 'pending') return fail(reply, 409, `Este pedido já está ${current.status}.`);
    // Quem decide é sempre uma pessoa autenticada: agente não tem token de usuário e não alcança esta rota.
    await db
      .update(schema.mediaActionRequests)
      .set({ status: body.data.decision === 'approve' ? 'approved' : 'rejected', decidedBy: request.authUser!.id, decidedAt: new Date() })
      .where(eq(schema.mediaActionRequests.id, current.id));
    await auditarAcao(request, { action: `media.action.${body.data.decision}d`, organizationId: org, clientId: current.clientId, metadata: { actionId: current.id } });
    if (body.data.decision === 'reject') return { status: 'rejected' };
    const outcome = await executeApprovedAction(current.id);
    await auditarAcao(request, { action: 'media.action.executed', result: outcome.status, organizationId: org, clientId: current.clientId, metadata: { actionId: current.id, outcome: outcome.status, reason: 'reason' in outcome ? outcome.reason : undefined } });
    return outcome;
  });

  // ── Associação MANUAL de conta a cliente ────────────────────────────────
  // Só contas JÁ descobertas pela conexão central (catálogo da empresa) podem ser vinculadas, e só a clientes
  // da mesma empresa. Nada é vinculado por nome parecido: quem chama escolhe o cliente.
  app.post('/media/accounts/link', { preHandler: write }, async (request, reply) => {
    const body = z.object({ client_id: z.string().uuid(), account_id: z.string().min(1), make_primary: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues.map((i) => i.message).join(' '));
    const org = scopeOf(request).organizationId;
    const provider = providerOfAccount(body.data.account_id);

    const [client] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(and(eq(schema.clients.id, body.data.client_id), eq(schema.clients.organizationId, org)));
    if (!client) return fail(reply, 404, 'Cliente não encontrado nesta empresa.');
    const [account] = await db
      .select()
      .from(schema.mediaAdAccounts)
      .where(and(eq(schema.mediaAdAccounts.organizationId, org), eq(schema.mediaAdAccounts.provider, provider), eq(schema.mediaAdAccounts.externalId, body.data.account_id)));
    if (!account) return fail(reply, 404, 'Esta conta não foi descoberta pela conexão da agência. Sincronize as contas antes.');
    if (!account.connectionId) return fail(reply, 409, 'A conta não tem conexão associada; reconecte a integração.');

    if (provider === 'meta') {
      const existing = await db.select({ id: schema.clientMetaAccounts.id }).from(schema.clientMetaAccounts).where(eq(schema.clientMetaAccounts.clientId, client.id));
      await db
        .insert(schema.clientMetaAccounts)
        .values({ clientId: client.id, accountId: account.externalId, businessId: account.businessId, connectionId: account.connectionId, isPrimary: body.data.make_primary ?? existing.length === 0, label: account.name })
        .onConflictDoNothing();
    } else {
      const existing = await db.select({ id: schema.clientGoogleAdsAccounts.id }).from(schema.clientGoogleAdsAccounts).where(eq(schema.clientGoogleAdsAccounts.clientId, client.id));
      await db
        .insert(schema.clientGoogleAdsAccounts)
        .values({ clientId: client.id, customerId: account.externalId, loginCustomerId: account.businessId, connectionId: account.connectionId, isPrimary: body.data.make_primary ?? existing.length === 0, label: account.name })
        .onConflictDoNothing();
    }
    await auditarAcao(request, { action: 'media.account.linked', organizationId: org, clientId: client.id, metadata: { provider, accountId: account.externalId, accountName: account.name, manual: true } });
    return { ok: true, client: client.name, provider, accountId: account.externalId };
  });

  app.delete<{ Params: { accountId: string }; Querystring: { client_id?: string } }>('/media/accounts/:accountId/link', { preHandler: write }, async (request, reply) => {
    const org = scopeOf(request).organizationId;
    const clientId = request.query.client_id;
    if (!clientId) return fail(reply, 400, 'Informe o cliente.');
    const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, org)));
    if (!client) return fail(reply, 404, 'Cliente não encontrado nesta empresa.');
    const provider = providerOfAccount(request.params.accountId);
    const gone =
      provider === 'meta'
        ? await db.delete(schema.clientMetaAccounts).where(and(eq(schema.clientMetaAccounts.clientId, clientId), eq(schema.clientMetaAccounts.accountId, request.params.accountId))).returning({ id: schema.clientMetaAccounts.id })
        : await db.delete(schema.clientGoogleAdsAccounts).where(and(eq(schema.clientGoogleAdsAccounts.clientId, clientId), eq(schema.clientGoogleAdsAccounts.customerId, request.params.accountId))).returning({ id: schema.clientGoogleAdsAccounts.id });
    if (gone.length === 0) return fail(reply, 404, 'Vínculo não encontrado.');
    await auditarAcao(request, { action: 'media.account.unlinked', organizationId: org, clientId, metadata: { provider, accountId: request.params.accountId } });
    return { ok: true };
  });

  // ── Tela inicial de Mídias: carteira inteira ────────────────────────────
  app.get<{ Querystring: { period?: string; since?: string; until?: string; compare?: string; currency?: string } }>('/media/hub', { preHandler: read }, async (request, reply) => {
    const range = rangeFrom(request.query);
    if (!range) return fail(reply, 400, 'Período inválido.');
    const currency = /^[A-Z]{3}$/.test(request.query.currency ?? '') ? request.query.currency! : 'BRL';
    return getHub(scopeOf(request), range, { compare: request.query.compare !== 'false', currency });
  });

  const hubCreativesQuery = z.object({
    provider: z.enum(['meta', 'google_ads']).optional(),
    account_id: z.string().max(64).optional(),
    client_id: z.string().uuid().optional(),
    q: z.string().max(100).optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'DISAPPROVED', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']).optional(),
    objective: z.string().max(60).optional(),
    with_spend: z.enum(['true', 'false']).optional(),
    sort: z.enum(['spend', 'results', 'ctr', 'costPerResult', 'active']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(100000).optional(),
    period: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  });

  app.get('/media/hub/creatives', { preHandler: read }, async (request, reply) => {
    const q = hubCreativesQuery.safeParse(request.query);
    if (!q.success) return fail(reply, 400, q.error.issues.map((i) => i.message).join(' '));
    const range = rangeFrom(q.data);
    if (!range) return fail(reply, 400, 'Período inválido.');
    return listAllCreatives(scopeOf(request), {
      range,
      ...(q.data.provider ? { provider: q.data.provider } : {}),
      ...(q.data.account_id ? { accountId: q.data.account_id } : {}),
      ...(q.data.client_id ? { clientId: q.data.client_id } : {}),
      ...(q.data.q ? { search: q.data.q } : {}),
      ...(q.data.status ? { status: q.data.status } : {}),
      ...(q.data.objective ? { objective: q.data.objective } : {}),
      withSpend: q.data.with_spend !== 'false',
      ...(q.data.sort ? { sort: q.data.sort } : {}),
      ...(q.data.limit ? { limit: q.data.limit } : {}),
      ...(q.data.offset ? { offset: q.data.offset } : {}),
    });
  });
}
