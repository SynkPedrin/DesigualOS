import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  buildMeetingBrief,
  checkConflict,
  findCommonAvailability,
  listGoogleCalendars,
  listMicrosoftCalendars,
  resolveGoogleCalendarAccess,
  resolveMicrosoftCalendarAccess,
  syncMemberGoogleCalendar,
  syncMemberMicrosoftCalendar,
  type BusyInterval,
} from '@desigual-os/tool-gateway';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import { hasClientAccess } from '../lib/access';
import { membersBelongToOrganization, participantMemberIdsByEvent, redactForViewer, type CalendarEventRow } from './access';

/**
 * calendar/routes.ts — Calendar Core (prompt "CALENDAR + AUTOMATIONS + BENTO
 * V2", Partes A/B/E, 06/10/2026). Só eventos NATIVOS por ora — sync do
 * Google (Parte F) é a próxima frente, combinada pelo usuário nesta ordem.
 *
 * Toda rota pré-carrega tenant (requireTenant, mesmo padrão de
 * clients/routes.ts) e módulo do Workspace Builder (requireModule
 * ('calendario')) — as duas perguntas são diferentes ("este papel mexe com
 * calendário" vs "o workspace DESTA pessoa inclui calendário") e as duas
 * precisam valer juntas (§79 do prompt de refinamento anterior, que esta
 * mesma régua já cobre).
 */
const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  timezone: z.string().trim().min(1).max(60).optional(),
  location: z.string().trim().max(300).nullable().optional(),
  meeting_url: z.string().trim().url().nullable().optional(),
  visibility: z.enum(['default', 'private']).optional(),
  participant_user_ids: z.array(z.string().uuid()).max(50).optional(),
  /** "Continuar mesmo assim" (§19) — grava mesmo com conflito HARD detectado. */
  force: z.boolean().optional(),
});

async function loadBusyIntervals(memberIds: string[], organizationId: string, rangeStart: Date, rangeEnd: Date, excludeEventId?: string): Promise<Record<string, BusyInterval[]>> {
  if (memberIds.length === 0) return {};

  const linhas = await db
    .select({
      memberId: schema.calendarEventParticipants.memberId,
      required: schema.calendarEventParticipants.required,
      responseStatus: schema.calendarEventParticipants.responseStatus,
      startAt: schema.calendarEvents.startAt,
      endAt: schema.calendarEvents.endAt,
      status: schema.calendarEvents.status,
    })
    .from(schema.calendarEventParticipants)
    .innerJoin(schema.calendarEvents, eq(schema.calendarEvents.id, schema.calendarEventParticipants.eventId))
    .where(
      and(
        inArray(schema.calendarEventParticipants.memberId, memberIds),
        eq(schema.calendarEvents.organizationId, organizationId),
        ne(schema.calendarEvents.status, 'cancelled'),
        lt(schema.calendarEvents.startAt, rangeEnd),
        gt(schema.calendarEvents.endAt, rangeStart),
        excludeEventId ? ne(schema.calendarEvents.id, excludeEventId) : undefined,
      ),
    );

  const porMembro: Record<string, BusyInterval[]> = Object.fromEntries(memberIds.map((id) => [id, []]));
  for (const linha of linhas) {
    if (!linha.memberId || linha.responseStatus === 'declined') continue;
    porMembro[linha.memberId]!.push({ start: linha.startAt, end: linha.endAt, hard: linha.required });
  }
  return porMembro;
}

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
  });

  app.get<{ Querystring: { from?: string; to?: string; member_id?: string; client_id?: string } }>(
    '/calendar/events',
    { preHandler: [requirePermission('calendar', 'read'), requireModule('calendario')] },
    async (request, reply) => {
      const { from, to, member_id, client_id } = request.query;
      if (!from || !to) {
        reply.code(400);
        return { error: 'from e to são obrigatórios (ISO 8601).' };
      }
      const organizationId = request.tenantContext!.organizationId;
      const rangeStart = new Date(from);
      const rangeEnd = new Date(to);

      let eventIds: string[] | null = null;
      if (member_id) {
        const participando = await db
          .select({ eventId: schema.calendarEventParticipants.eventId })
          .from(schema.calendarEventParticipants)
          .where(eq(schema.calendarEventParticipants.memberId, member_id));
        eventIds = participando.map((p) => p.eventId);
        if (eventIds.length === 0) return { events: [] };
      }

      const condicoes = [eq(schema.calendarEvents.organizationId, organizationId), lt(schema.calendarEvents.startAt, rangeEnd), gt(schema.calendarEvents.endAt, rangeStart)];
      if (client_id) condicoes.push(eq(schema.calendarEvents.clientId, client_id));
      if (eventIds) condicoes.push(inArray(schema.calendarEvents.id, eventIds));

      const eventos = (await db.select().from(schema.calendarEvents).where(and(...condicoes))) as unknown as Array<CalendarEventRow & { id: string }>;
      const participantesPorEvento = await participantMemberIdsByEvent(eventos.map((e) => e.id));
      const viewerId = request.authUser!.id;

      return { events: eventos.map((e) => redactForViewer(e, viewerId, participantesPorEvento.get(e.id) ?? new Set())) };
    },
  );

  app.post<{ Body: unknown }>(
    '/calendar/events',
    { preHandler: [requirePermission('calendar', 'write'), requireModule('calendario')] },
    async (request, reply) => {
      const body = eventInputSchema.safeParse(request.body);
      if (!body.success) {
        reply.code(400);
        return { error: body.error.issues.map((i) => i.message).join(' ') };
      }
      const data = body.data;
      const startAt = new Date(data.start_at);
      const endAt = new Date(data.end_at);
      if (endAt.getTime() <= startAt.getTime()) {
        reply.code(400);
        return { error: 'end_at precisa ser depois de start_at.' };
      }

      const organizationId = request.tenantContext!.organizationId;
      const callerId = request.authUser!.id;
      const participantes = [...new Set([...(data.participant_user_ids ?? []), callerId])];

      const pertencem = await membersBelongToOrganization(participantes, organizationId);
      const foraDaOrg = participantes.filter((id) => !pertencem.has(id));
      if (foraDaOrg.length > 0) {
        reply.code(400);
        return { error: `Participante(s) fora desta organização: ${foraDaOrg.join(', ')}` };
      }

      if (data.client_id) {
        const [cliente] = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, data.client_id), eq(schema.clients.organizationId, organizationId)));
        if (!cliente) {
          reply.code(404);
          return { error: `Client '${data.client_id}' not found` };
        }
      }

      if (!data.force) {
        const ocupados = await loadBusyIntervals(participantes, organizationId, startAt, endAt);
        const conflitos: Array<{ member_id: string; busy_slot: { start: string; end: string } }> = [];
        for (const [memberId, intervalos] of Object.entries(ocupados)) {
          const resultado = checkConflict(intervalos, startAt, endAt);
          if (resultado.conflict && resultado.hard) conflitos.push({ member_id: memberId, busy_slot: { start: resultado.busySlot!.start.toISOString(), end: resultado.busySlot!.end.toISOString() } });
        }
        if (conflitos.length > 0) {
          const sugestoesFim = new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
          const sugeridos = findCommonAvailability(ocupados, startAt, sugestoesFim, Math.round((endAt.getTime() - startAt.getTime()) / 60_000)).slice(0, 3);
          reply.code(409);
          return {
            error: 'Conflito de agenda.',
            conflicts: conflitos,
            suggested_slots: sugeridos.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
          };
        }
      }

      const [criado] = await db
        .insert(schema.calendarEvents)
        .values({
          organizationId,
          clientId: data.client_id ?? null,
          title: data.title,
          description: data.description ?? null,
          startAt,
          endAt,
          timezone: data.timezone ?? 'America/Sao_Paulo',
          location: data.location ?? null,
          meetingUrl: data.meeting_url ?? null,
          visibility: data.visibility ?? 'default',
          source: 'native',
          createdBy: callerId,
        })
        .returning();

      if (participantes.length > 0) {
        await db.insert(schema.calendarEventParticipants).values(
          participantes.map((memberId) => ({ eventId: criado!.id, memberId, required: true, responseStatus: memberId === callerId ? 'accepted' : 'needsAction' })),
        );
      }

      await auditarAcao(request, { action: 'calendar.event_created', resourceType: 'calendar_event', resourceId: criado!.id, metadata: { client_id: data.client_id ?? null, participants: participantes.length } });

      return reply.code(201).send(redactForViewer(criado! as unknown as CalendarEventRow, callerId, new Set(participantes)));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/calendar/events/:id',
    { preHandler: [requirePermission('calendar', 'write'), requireModule('calendario')] },
    async (request, reply) => {
      const organizationId = request.tenantContext!.organizationId;
      const [evento] = await db.select().from(schema.calendarEvents).where(and(eq(schema.calendarEvents.id, request.params.id), eq(schema.calendarEvents.organizationId, organizationId)));
      if (!evento) {
        reply.code(404);
        return { error: 'Event not found' };
      }
      if (evento.createdBy !== request.authUser!.id) {
        reply.code(403);
        return { error: 'Só quem criou o evento pode cancelá-lo.' };
      }

      await db.update(schema.calendarEvents).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(schema.calendarEvents.id, evento.id));
      await auditarAcao(request, { action: 'calendar.event_cancelled', resourceType: 'calendar_event', resourceId: evento.id });
      return { ok: true };
    },
  );

  /**
   * Meeting Prep (§51-53, 06/10/2026): o mesmo contexto que a notificação do
   * worker aponta (`buildMeetingBrief`) — uma função só, chamada tanto daqui
   * quanto de `apps/worker/src/scheduler/meeting-prep.ts` indiretamente (o
   * worker só decide QUEM avisar; o que mostrar é sempre esta rota).
   */
  app.get<{ Params: { id: string } }>(
    '/calendar/events/:id/meeting-brief',
    { preHandler: [requirePermission('calendar', 'read'), requireModule('calendario')] },
    async (request, reply) => {
      const organizationId = request.tenantContext!.organizationId;
      const brief = await buildMeetingBrief(request.params.id, organizationId);
      if (!brief) {
        reply.code(404);
        return { error: 'Evento não encontrado ou sem cliente vinculado, Meeting Brief só existe para reunião de cliente.' };
      }
      if (!(await hasClientAccess(request.authUser!, brief.client.id))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }
      return brief;
    },
  );

  app.get<{ Querystring: { member_ids?: string; from?: string; to?: string; duration_minutes?: string } }>(
    '/calendar/availability',
    { preHandler: [requirePermission('calendar', 'read'), requireModule('calendario')] },
    async (request, reply) => {
      const { member_ids, from, to, duration_minutes } = request.query;
      if (!member_ids || !from || !to) {
        reply.code(400);
        return { error: 'member_ids, from e to são obrigatórios.' };
      }
      const organizationId = request.tenantContext!.organizationId;
      const ids = member_ids.split(',').map((s) => s.trim()).filter(Boolean);
      const pertencem = await membersBelongToOrganization(ids, organizationId);
      const foraDaOrg = ids.filter((id) => !pertencem.has(id));
      if (foraDaOrg.length > 0) {
        reply.code(400);
        return { error: `Fora desta organização: ${foraDaOrg.join(', ')}` };
      }

      const rangeStart = new Date(from);
      const rangeEnd = new Date(to);
      const duracao = duration_minutes ? Number(duration_minutes) : 30;
      const ocupados = await loadBusyIntervals(ids, organizationId, rangeStart, rangeEnd);
      const slots = findCommonAvailability(ocupados, rangeStart, rangeEnd, duracao);

      return { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
    },
  );

  /**
   * Google Calendar — vínculo + sync manual (Parte F, §24-25). O MESMO
   * desenho de client_meta_accounts: a rota valida que a agenda escolhida
   * está entre as que a conexão do próprio colaborador enxerga antes de
   * gravar (nunca aceita um calendarId que a pessoa não comprovou ser dela).
   */
  /**
   * FILTRADO POR PROVIDER via join (07/10/2026, ao introduzir o Microsoft
   * Calendar): sem isso, `/calendar/google/accounts` devolveria TAMBÉM as
   * contas Microsoft da pessoa — mesma tabela `member_calendar_accounts`
   * pros dois providers, só `integration_connections.provider` distingue.
   */
  app.get('/calendar/google/accounts', { preHandler: [requirePermission('calendar', 'read'), requireModule('calendario')] }, async (request) => {
    const rows = await db
      .select({ id: schema.memberCalendarAccounts.id, externalCalendarId: schema.memberCalendarAccounts.externalCalendarId, isPrimary: schema.memberCalendarAccounts.isPrimary, connectionId: schema.memberCalendarAccounts.connectionId, lastSyncedAt: schema.memberCalendarAccounts.lastSyncedAt })
      .from(schema.memberCalendarAccounts)
      .innerJoin(schema.integrationConnections, eq(schema.integrationConnections.id, schema.memberCalendarAccounts.connectionId))
      .where(and(eq(schema.memberCalendarAccounts.userId, request.authUser!.id), eq(schema.integrationConnections.provider, 'google_calendar')));
    return {
      accounts: rows.map((r) => ({
        id: r.id,
        external_calendar_id: r.externalCalendarId,
        is_primary: r.isPrimary,
        connected: r.connectionId !== null,
        last_synced_at: r.lastSyncedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post<{ Body: { external_calendar_id?: string } }>(
    '/calendar/google/accounts',
    { preHandler: [requirePermission('calendar', 'write'), requireModule('calendario')] },
    async (request, reply) => {
      const externalCalendarId = request.body?.external_calendar_id;
      if (!externalCalendarId) {
        reply.code(400);
        return { error: 'external_calendar_id é obrigatório.' };
      }
      const callerId = request.authUser!.id;
      const access = await resolveGoogleCalendarAccess(callerId);
      if (!access) {
        reply.code(409);
        return { error: 'Conecte o Google Calendar em Integrações antes de vincular uma agenda.' };
      }

      const acessiveis = await listGoogleCalendars(access.accessToken);
      if (!acessiveis.some((c) => c.id === externalCalendarId)) {
        reply.code(400);
        return { error: `A agenda "${externalCalendarId}" não está entre as acessíveis pela sua conexão Google.` };
      }

      const [criado] = await db
        .insert(schema.memberCalendarAccounts)
        .values({ userId: callerId, organizationId: request.tenantContext!.organizationId, connectionId: access.connectionId, externalCalendarId, isPrimary: true })
        .onConflictDoUpdate({
          target: [schema.memberCalendarAccounts.userId, schema.memberCalendarAccounts.externalCalendarId],
          set: { connectionId: access.connectionId, updatedAt: new Date() },
        })
        .returning();

      await auditarAcao(request, { action: 'calendar.google_account_linked', metadata: { external_calendar_id: externalCalendarId } });
      return reply.code(201).send({ id: criado!.id, external_calendar_id: criado!.externalCalendarId });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/calendar/google/accounts/:id/sync',
    { preHandler: [requirePermission('calendar', 'write'), requireModule('calendario')] },
    async (request, reply) => {
      const [conta] = await db.select().from(schema.memberCalendarAccounts).where(and(eq(schema.memberCalendarAccounts.id, request.params.id), eq(schema.memberCalendarAccounts.userId, request.authUser!.id)));
      if (!conta) {
        reply.code(404);
        return { error: 'Calendar account not found' };
      }
      try {
        const resultado = await syncMemberGoogleCalendar(conta.id);
        return { ok: true, events_upserted: resultado.upserted, full_sync: resultado.fullSync };
      } catch (error) {
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Google Calendar sync failed' };
      }
    },
  );

  /**
   * Microsoft 365/Outlook Calendar — vínculo + sync manual (07/10/2026).
   * MESMO desenho do bloco Google acima, inclusive o filtro por provider via
   * join — reaproveita `member_calendar_accounts` sem um schema novo.
   */
  app.get('/calendar/microsoft/accounts', { preHandler: [requirePermission('calendar', 'read'), requireModule('calendario')] }, async (request) => {
    const rows = await db
      .select({ id: schema.memberCalendarAccounts.id, externalCalendarId: schema.memberCalendarAccounts.externalCalendarId, isPrimary: schema.memberCalendarAccounts.isPrimary, connectionId: schema.memberCalendarAccounts.connectionId, lastSyncedAt: schema.memberCalendarAccounts.lastSyncedAt })
      .from(schema.memberCalendarAccounts)
      .innerJoin(schema.integrationConnections, eq(schema.integrationConnections.id, schema.memberCalendarAccounts.connectionId))
      .where(and(eq(schema.memberCalendarAccounts.userId, request.authUser!.id), eq(schema.integrationConnections.provider, 'microsoft_calendar')));
    return {
      accounts: rows.map((r) => ({
        id: r.id,
        external_calendar_id: r.externalCalendarId,
        is_primary: r.isPrimary,
        connected: r.connectionId !== null,
        last_synced_at: r.lastSyncedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post<{ Body: { external_calendar_id?: string } }>(
    '/calendar/microsoft/accounts',
    { preHandler: [requirePermission('calendar', 'write'), requireModule('calendario')] },
    async (request, reply) => {
      const externalCalendarId = request.body?.external_calendar_id;
      if (!externalCalendarId) {
        reply.code(400);
        return { error: 'external_calendar_id é obrigatório.' };
      }
      const callerId = request.authUser!.id;
      const access = await resolveMicrosoftCalendarAccess(callerId);
      if (!access) {
        reply.code(409);
        return { error: 'Conecte o Microsoft Calendar em Integrações antes de vincular uma agenda.' };
      }

      const acessiveis = await listMicrosoftCalendars(access.accessToken);
      if (!acessiveis.some((c) => c.id === externalCalendarId)) {
        reply.code(400);
        return { error: `A agenda "${externalCalendarId}" não está entre as acessíveis pela sua conexão Microsoft.` };
      }

      const [criado] = await db
        .insert(schema.memberCalendarAccounts)
        .values({ userId: callerId, organizationId: request.tenantContext!.organizationId, connectionId: access.connectionId, externalCalendarId, isPrimary: true })
        .onConflictDoUpdate({
          target: [schema.memberCalendarAccounts.userId, schema.memberCalendarAccounts.externalCalendarId],
          set: { connectionId: access.connectionId, updatedAt: new Date() },
        })
        .returning();

      await auditarAcao(request, { action: 'calendar.microsoft_account_linked', metadata: { external_calendar_id: externalCalendarId } });
      return reply.code(201).send({ id: criado!.id, external_calendar_id: criado!.externalCalendarId });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/calendar/microsoft/accounts/:id/sync',
    { preHandler: [requirePermission('calendar', 'write'), requireModule('calendario')] },
    async (request, reply) => {
      const [conta] = await db.select().from(schema.memberCalendarAccounts).where(and(eq(schema.memberCalendarAccounts.id, request.params.id), eq(schema.memberCalendarAccounts.userId, request.authUser!.id)));
      if (!conta) {
        reply.code(404);
        return { error: 'Calendar account not found' };
      }
      try {
        const resultado = await syncMemberMicrosoftCalendar(conta.id);
        return { ok: true, events_upserted: resultado.upserted, events_cancelled: resultado.cancelled };
      } catch (error) {
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Microsoft Calendar sync failed' };
      }
    },
  );
}
