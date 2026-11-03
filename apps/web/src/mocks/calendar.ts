import type { CalendarEventWire, MemberCalendarAccountWire } from '@/lib/api/contracts';

/** Fixture DEV/QA do Calendário (Fase 1 do redesenho de front, 06/10/2026) —
 *  `/calendar/events` nunca teve handler de mock, então nem a tela `/calendar`
 *  nem a agenda do dia em `/today` eram demonstráveis antes disto. Horários
 *  relativos a AGORA pra sempre cair "hoje" não importa quando o mock roda. */
function hoje(hora: number, minuto = 0): Date {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  return d;
}

function daqui(dias: number, hora: number, minuto = 0): Date {
  const d = hoje(hora, minuto);
  d.setDate(d.getDate() + dias);
  return d;
}

function iso(d: Date): string {
  return d.toISOString();
}

let proximoId = 1;
function nextEventId(): string {
  return `cal-event-mock-${proximoId++}`;
}

/** As agendas do Outlook do mock (03/11/2026): a da agência e a da Manada Filmes vinculadas, Feriados não. */
export const MOCK_AGENDA_DESIGUAL = 'pedro@agenciadesigual.com.br';
export const MOCK_AGENDA_MANADA = 'manada-filmes';
export const mockAgendasDaConta = [
  { id: MOCK_AGENDA_DESIGUAL, name: 'Calendário', is_default: true, can_edit: true },
  { id: MOCK_AGENDA_MANADA, name: 'Manada Filmes', is_default: false, can_edit: true },
  { id: 'feriados-brasil', name: 'Feriados no Brasil', is_default: false, can_edit: false },
];

/** Agendas vinculadas; o POST do "+ Agenda" acrescenta aqui. */
export const mockContasMicrosoft: MemberCalendarAccountWire[] = [
  { id: 'mscal-pedro', external_calendar_id: MOCK_AGENDA_DESIGUAL, is_primary: true, connected: true, last_synced_at: new Date(Date.now() - 15 * 60_000).toISOString() },
  { id: 'mscal-manada', external_calendar_id: MOCK_AGENDA_MANADA, is_primary: true, connected: true, last_synced_at: new Date(Date.now() - 15 * 60_000).toISOString() },
];

export const mockCalendarEvents: CalendarEventWire[] = [
  {
    id: nextEventId(),
    client_id: null,
    start_at: iso(hoje(9, 0)),
    end_at: iso(hoje(9, 30)),
    timezone: 'America/Sao_Paulo',
    status: 'confirmed',
    visible: true,
    title: 'Reunião interna, Atendimento',
    description: null,
    location: null,
    meeting_url: 'https://meet.google.com/mock-interna',
    source: 'desigual_os',
    created_by: 'user-admin-master',
  },
  {
    id: nextEventId(),
    client_id: 'client-cosentino',
    start_at: iso(hoje(10, 30)),
    end_at: iso(hoje(11, 0)),
    timezone: 'America/Sao_Paulo',
    status: 'confirmed',
    visible: true,
    title: 'Alinhamento, Cosentino',
    description: 'Revisão do direcionamento da campanha de outubro.',
    location: null,
    meeting_url: 'https://teams.microsoft.com/l/meetup-join/mock-cosentino',
    source: 'microsoft_calendar',
    created_by: 'user-admin-master',
    calendar_id: MOCK_AGENDA_DESIGUAL,
  },
  {
    id: nextEventId(),
    client_id: null,
    start_at: iso(hoje(14, 0)),
    end_at: iso(hoje(14, 45)),
    timezone: 'America/Sao_Paulo',
    status: 'confirmed',
    visible: true,
    title: 'Onboarding, Novo cliente',
    description: null,
    location: null,
    meeting_url: 'https://meet.google.com/mock-onboarding',
    source: 'desigual_os',
    created_by: 'user-admin-master',
  },
  {
    id: nextEventId(),
    client_id: 'client-g4-educacao',
    start_at: iso(hoje(16, 0)),
    end_at: iso(hoje(16, 30)),
    timezone: 'America/Sao_Paulo',
    status: 'confirmed',
    visible: true,
    title: 'Revisão de criativos, G4',
    description: null,
    location: 'Sala de criação',
    meeting_url: null,
    source: 'desigual_os',
    created_by: 'user-admin-master',
  },
  {
    id: nextEventId(),
    client_id: null,
    start_at: iso(hoje(11, 0)),
    end_at: iso(hoje(12, 30)),
    timezone: 'America/Sao_Paulo',
    status: 'confirmed',
    visible: true,
    title: 'Gravação, Manada Filmes',
    description: null,
    location: 'Estúdio',
    meeting_url: null,
    source: 'microsoft_calendar',
    created_by: 'user-admin-master',
    calendar_id: MOCK_AGENDA_MANADA,
  },
  {
    id: nextEventId(),
    client_id: null,
    start_at: iso(daqui(1, 15, 0)),
    end_at: iso(daqui(1, 16, 30)),
    timezone: 'America/Sao_Paulo',
    status: 'confirmed',
    visible: true,
    title: 'Pós-produção, Manada Filmes',
    description: null,
    location: null,
    meeting_url: null,
    source: 'microsoft_calendar',
    created_by: 'user-admin-master',
    calendar_id: MOCK_AGENDA_MANADA,
  },
];

/** Quem participa de cada evento (Calendário da Agência, §6-9 — sem isto
 *  `GET /calendar/events?member_id=X` não tinha como diferenciar a agenda de
 *  uma pessoa da de outra, e toda coluna mostrava os MESMOS 4 eventos). Só a
 *  reunião interna é de time inteiro; o resto é 1:1 do dono da conta. */
export const mockCalendarEventParticipants: Record<string, string[]> = {
  [mockCalendarEvents[0]!.id]: ['user-admin-master', 'user-colaborador-1', 'user-colaborador-2'], // Reunião interna — Atendimento
  [mockCalendarEvents[1]!.id]: ['user-admin-master'], // Alinhamento — Cosentino
  [mockCalendarEvents[2]!.id]: ['user-admin-master'], // Onboarding — Novo cliente
  [mockCalendarEvents[3]!.id]: ['user-admin-master'], // Revisão de criativos — G4
  [mockCalendarEvents[4]!.id]: ['user-admin-master'], // Gravação — Manada Filmes
  [mockCalendarEvents[5]!.id]: ['user-admin-master'], // Pós-produção — Manada Filmes
};
