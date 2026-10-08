import { and, count, desc, eq, inArray, isNotNull, lt, ne, notInArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { BriefStatus, DemandStatus } from '@desigual-os/types';

/**
 * meeting-brief.ts — Meeting Prep (Parte L do prompt "CALENDAR + AUTOMATIONS
 * + BENTO V2", §51-53, 06/10/2026): o contexto que alguém quer ter na mão 15
 * minutos antes de uma reunião de cliente. Usado pela rota
 * `GET /calendar/events/:id/meeting-brief` e pelo worker
 * (`meeting-prep.ts`) — uma função só, pra tela e aviso nunca divergirem
 * sobre o que "contexto da reunião" significa.
 *
 * SÓ O QUE JÁ EXISTE DE VERDADE: nenhuma tabela de "ata de reunião" existe
 * neste banco ("After Meeting capture", Parte M, é feature futura, fora de
 * escopo aqui) — por isso `previous_meeting` reaproveita só a `description`
 * do evento anterior, nunca uma ata inventada. Alertas de mídia (Meta/Google
 * Ads) também ficam de fora desta primeira versão: o dado existe por conta
 * de anúncio, não por "evento preocupante", e cruzar os dois é escopo maior
 * do que o resto desta função.
 */

const DEMAND_STATUSES_ABERTOS: DemandStatus[] = ['new', 'briefing', 'in_production'];
const BRIEF_STATUSES_ABERTOS: BriefStatus[] = ['draft', 'in_review'];

export interface MeetingBrief {
  event: {
    id: string;
    title: string | null;
    description: string | null;
    start_at: string;
    end_at: string;
    location: string | null;
    meeting_url: string | null;
  };
  client: { id: string; name: string };
  participants: {
    internal: Array<{ user_id: string; name: string; response_status: string }>;
    external: Array<{ contact_id: string | null; name: string | null; email: string | null }>;
  };
  demands: {
    open_count: number;
    items: Array<{ id: string; title: string; status: string; due_date: string | null }>;
  };
  briefs: {
    open_count: number;
    items: Array<{ id: string; status: string; demand_title: string }>;
  };
  approvals: {
    pending_count: number;
    items: Array<{ id: string; resource_type: string; created_at: string }>;
  };
  last_conversation: { id: string; title: string | null; status: string; updated_at: string } | null;
  /** Último evento PASSADO deste mesmo cliente, visível (não privado) — não é uma ata, é o que o calendário já sabia. */
  previous_meeting: { id: string; title: string | null; description: string | null; start_at: string } | null;
}

/**
 * `null` quando o evento não existe, não pertence à organização, ou não tem
 * cliente vinculado (reunião sem cliente não tem "brief" — nunca inventa um).
 */
export async function buildMeetingBrief(eventId: string, organizationId: string): Promise<MeetingBrief | null> {
  const [evento] = await db.select().from(schema.calendarEvents).where(and(eq(schema.calendarEvents.id, eventId), eq(schema.calendarEvents.organizationId, organizationId)));
  if (!evento || !evento.clientId) return null;

  const [cliente] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, evento.clientId));
  if (!cliente) return null;

  const [participantes, demandasAbertas, briefsAbertos, aprovacoesPendentes, ultimaConversa, reuniaoAnterior] = await Promise.all([
    db
      .select({
        memberId: schema.calendarEventParticipants.memberId,
        contactId: schema.calendarEventParticipants.contactId,
        email: schema.calendarEventParticipants.email,
        responseStatus: schema.calendarEventParticipants.responseStatus,
        userName: schema.users.name,
        contactName: schema.contacts.name,
        contactEmail: schema.contacts.email,
      })
      .from(schema.calendarEventParticipants)
      .leftJoin(schema.users, eq(schema.users.id, schema.calendarEventParticipants.memberId))
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.calendarEventParticipants.contactId))
      .where(eq(schema.calendarEventParticipants.eventId, eventId)),
    db
      .select({ id: schema.demands.id, title: schema.demands.title, status: schema.demands.status, dueDate: schema.demands.dueDate })
      .from(schema.demands)
      .where(and(eq(schema.demands.clientId, cliente.id), inArray(schema.demands.status, DEMAND_STATUSES_ABERTOS)))
      .orderBy(desc(schema.demands.requestedAt))
      .limit(5),
    db
      .select({ id: schema.briefs.id, status: schema.briefs.status, demandTitle: schema.demands.title })
      .from(schema.briefs)
      .innerJoin(schema.demands, eq(schema.demands.id, schema.briefs.demandId))
      .where(and(eq(schema.briefs.clientId, cliente.id), inArray(schema.briefs.status, BRIEF_STATUSES_ABERTOS)))
      .orderBy(desc(schema.briefs.createdAt))
      .limit(5),
    db
      .select({ id: schema.approvalRequests.id, resourceType: schema.approvalRequests.resourceType, createdAt: schema.approvalRequests.createdAt })
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.clientId, cliente.id), eq(schema.approvalRequests.status, 'pending')))
      .orderBy(desc(schema.approvalRequests.createdAt))
      .limit(5),
    db
      .select({ id: schema.conversations.id, title: schema.conversations.title, status: schema.conversations.status, updatedAt: schema.conversations.updatedAt })
      .from(schema.conversations)
      .where(eq(schema.conversations.clientId, cliente.id))
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(1),
    db
      .select({ id: schema.calendarEvents.id, title: schema.calendarEvents.title, description: schema.calendarEvents.description, startAt: schema.calendarEvents.startAt })
      .from(schema.calendarEvents)
      .where(
        and(
          eq(schema.calendarEvents.clientId, cliente.id),
          eq(schema.calendarEvents.visibility, 'default'),
          ne(schema.calendarEvents.status, 'cancelled'),
          ne(schema.calendarEvents.id, eventId),
          lt(schema.calendarEvents.startAt, evento.startAt),
        ),
      )
      .orderBy(desc(schema.calendarEvents.startAt))
      .limit(1),
  ]);

  const [demandasAbertasCount, briefsAbertosCount, aprovacoesPendentesCount] = await Promise.all([
    countOpenDemands(cliente.id),
    countOpenBriefs(cliente.id),
    countPendingApprovals(cliente.id),
  ]);

  return {
    event: {
      id: evento.id,
      title: evento.title,
      description: evento.description,
      start_at: evento.startAt.toISOString(),
      end_at: evento.endAt.toISOString(),
      location: evento.location,
      meeting_url: evento.meetingUrl,
    },
    client: cliente,
    participants: {
      internal: participantes.filter((p) => p.memberId).map((p) => ({ user_id: p.memberId!, name: p.userName ?? 'Colaborador', response_status: p.responseStatus })),
      external: participantes
        .filter((p) => !p.memberId)
        .map((p) => ({ contact_id: p.contactId, name: p.contactName ?? null, email: p.contactEmail ?? p.email ?? null })),
    },
    demands: { open_count: demandasAbertasCount, items: demandasAbertas.map((d) => ({ id: d.id, title: d.title, status: d.status, due_date: d.dueDate?.toISOString() ?? null })) },
    briefs: { open_count: briefsAbertosCount, items: briefsAbertos.map((b) => ({ id: b.id, status: b.status, demand_title: b.demandTitle })) },
    approvals: { pending_count: aprovacoesPendentesCount, items: aprovacoesPendentes.map((a) => ({ id: a.id, resource_type: a.resourceType, created_at: a.createdAt.toISOString() })) },
    last_conversation: ultimaConversa[0] ? { id: ultimaConversa[0].id, title: ultimaConversa[0].title, status: ultimaConversa[0].status, updated_at: ultimaConversa[0].updatedAt.toISOString() } : null,
    previous_meeting: reuniaoAnterior[0] ? { id: reuniaoAnterior[0].id, title: reuniaoAnterior[0].title, description: reuniaoAnterior[0].description, start_at: reuniaoAnterior[0].startAt.toISOString() } : null,
  };
}

async function countOpenDemands(clientId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(schema.demands).where(and(eq(schema.demands.clientId, clientId), inArray(schema.demands.status, DEMAND_STATUSES_ABERTOS)));
  return row?.value ?? 0;
}

async function countOpenBriefs(clientId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(schema.briefs).where(and(eq(schema.briefs.clientId, clientId), inArray(schema.briefs.status, BRIEF_STATUSES_ABERTOS)));
  return row?.value ?? 0;
}

async function countPendingApprovals(clientId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.clientId, clientId), eq(schema.approvalRequests.status, 'pending')));
  return row?.value ?? 0;
}

/**
 * Candidatos a Meeting Prep: eventos de cliente, confirmados, começando nos
 * próximos `janelaMinutos` minutos, que ainda NÃO geraram notificação
 * `meeting_prep` (dedup por link, mesmo padrão de `aviso-de-conexao-mcp.ts`
 * — existir a notificação É o estado de "já avisado", não uma marca d'água
 * em memória que reinicia com o worker).
 */
export async function proximasReunioesDeCliente(agora: Date, janelaMinutos: number): Promise<Array<{ id: string; organizationId: string }>> {
  const limite = new Date(agora.getTime() + janelaMinutos * 60_000);
  const jaAvisados = await db
    .selectDistinct({ link: schema.notifications.link })
    .from(schema.notifications)
    .where(eq(schema.notifications.type, 'meeting_prep'));
  const idsAvisados = jaAvisados.map((n) => n.link?.match(/evento=([0-9a-f-]{36})/i)?.[1]).filter((id): id is string => Boolean(id));

  const condicoes = [
    eq(schema.calendarEvents.status, 'confirmed'),
    isNotNull(schema.calendarEvents.clientId),
    lt(schema.calendarEvents.startAt, limite),
  ];
  const linhas = await db
    .select({ id: schema.calendarEvents.id, organizationId: schema.calendarEvents.organizationId, startAt: schema.calendarEvents.startAt, clientId: schema.calendarEvents.clientId })
    .from(schema.calendarEvents)
    .where(idsAvisados.length > 0 ? and(...condicoes, notInArray(schema.calendarEvents.id, idsAvisados)) : and(...condicoes));

  return linhas.filter((l) => l.clientId !== null && l.startAt.getTime() > agora.getTime()).map((l) => ({ id: l.id, organizationId: l.organizationId }));
}
