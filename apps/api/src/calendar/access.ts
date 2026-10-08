import { and, eq, or } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AuthenticatedUser } from '../auth/middleware';

/**
 * calendar/access.ts — quem pode ver a agenda de quem (§68 do prompt
 * "CALENDAR + AUTOMATIONS + BENTO V2": calendar.read.own/team/agency).
 *
 * SIMPLIFICAÇÃO DELIBERADA: o RBAC de hoje não tem conceito de "equipe"
 * (nenhuma tabela de time/departamento existe — só client_users.responsibility,
 * que é pessoa↔CLIENTE, não pessoa↔pessoa). Por isso esta v1 não distingue
 * "team" de "agency": qualquer membro ATIVO da mesma organização pode VER a
 * agenda de qualquer colega da mesma organização — mesma régua que a tela de
 * Equipe (`/people`) já aplica hoje, sem capability própria. A fronteira que
 * REALMENTE importa (nunca ver agenda de OUTRA organização, nunca ver
 * detalhe de evento privado) está em `redactForViewer` abaixo, aplicada
 * sempre, para qualquer leitor.
 */
export async function membersBelongToOrganization(userIds: string[], organizationId: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), or(...userIds.map((id) => eq(schema.organizationMembers.userId, id)))));
  return new Set(rows.map((r) => r.userId));
}

export interface CalendarEventRow {
  id: string;
  organizationId: string;
  clientId: string | null;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location: string | null;
  meetingUrl: string | null;
  source: string;
  visibility: string;
  status: string;
  createdBy: string;
}

export interface RedactedEvent {
  id: string;
  client_id: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: string;
  /** false = evento privado de outra pessoa — só isto é mostrado, nunca o resto (§27). */
  visible: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  source: string;
  created_by: string;
}

/**
 * PRIVACIDADE (§27): evento privado só mostra título/descrição/local/link
 * pra quem CRIOU ou é PARTICIPANTE. Qualquer outro leitor da mesma
 * organização vê só "ocupado, dessa hora até essa hora" — nunca o motivo.
 * `participantUserIds` é resolvido pelo chamador (join em
 * calendar_event_participants) pra esta função continuar pura/testável.
 */
export function redactForViewer(event: CalendarEventRow, viewerId: string, participantUserIds: Set<string>): RedactedEvent {
  const podeVerDetalhe = event.visibility !== 'private' || event.createdBy === viewerId || participantUserIds.has(viewerId);
  return {
    id: event.id,
    client_id: event.clientId,
    start_at: event.startAt.toISOString(),
    end_at: event.endAt.toISOString(),
    timezone: event.timezone,
    status: event.status,
    visible: podeVerDetalhe,
    title: podeVerDetalhe ? event.title : null,
    description: podeVerDetalhe ? event.description : null,
    location: podeVerDetalhe ? event.location : null,
    meeting_url: podeVerDetalhe ? event.meetingUrl : null,
    source: event.source,
    created_by: event.createdBy,
  };
}

/** Participantes (memberId) de um conjunto de eventos, de uma vez — evita N+1 ao redigir uma lista inteira. */
export async function participantMemberIdsByEvent(eventIds: string[]): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  if (eventIds.length === 0) return mapa;
  const linhas = await db
    .select({ eventId: schema.calendarEventParticipants.eventId, memberId: schema.calendarEventParticipants.memberId })
    .from(schema.calendarEventParticipants)
    .where(or(...eventIds.map((id) => eq(schema.calendarEventParticipants.eventId, id))));
  for (const linha of linhas) {
    if (!linha.memberId) continue;
    const atual = mapa.get(linha.eventId) ?? new Set<string>();
    atual.add(linha.memberId);
    mapa.set(linha.eventId, atual);
  }
  return mapa;
}

export type { AuthenticatedUser };
