import type { CalendarEventWire } from '@/lib/api/contracts';

/** Fixture DEV/QA do Calendário (Fase 1 do redesenho de front, 06/10/2026) —
 *  `/calendar/events` nunca teve handler de mock, então nem a tela `/calendar`
 *  nem a agenda do dia em `/today` eram demonstráveis antes disto. Horários
 *  relativos a AGORA pra sempre cair "hoje" não importa quando o mock roda. */
function hoje(hora: number, minuto = 0): Date {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  return d;
}

function iso(d: Date): string {
  return d.toISOString();
}

let proximoId = 1;
function nextEventId(): string {
  return `cal-event-mock-${proximoId++}`;
}

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
    meeting_url: 'https://meet.google.com/mock-cosentino',
    source: 'desigual_os',
    created_by: 'user-admin-master',
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
};
