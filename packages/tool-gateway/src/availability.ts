/**
 * availability.ts — Availability Engine (prompt "CALENDAR + AUTOMATIONS +
 * BENTO V2", Parte E, §15-21, 06/10/2026). DETERMINÍSTICO: nenhuma chamada a
 * LLM entra aqui — "LLM NÃO calcula disponibilidade" é a frase literal do
 * prompt (§16), e é a diferença entre "o Bento acha que está livre" e "o
 * Bento SABE que está livre".
 *
 * Entrada são intervalos já resolvidos pelo chamador (calendar_events do
 * banco — nunca deadline de demanda/task, que não ocupa horário, ver §17).
 * Este módulo não toca banco nem API externa: é puro, por isso é barato de
 * testar byte a byte (tenant isolation, fuso, hard vs soft) sem precisar de
 * Postgres nem Google.
 */

export interface BusyInterval {
  start: Date;
  end: Date;
  /** true = participante obrigatório num evento confirmado (hard). false = opcional/tentative (soft) — ver §20. */
  hard: boolean;
}

/** Funde intervalos sobrepostos/adjacentes da MESMA pessoa — "9h-10h" + "9h30-10h30" vira um bloco só de 9h-10h30. */
export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) return [];
  const ordenados = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const fundidos: BusyInterval[] = [ordenados[0]!];

  for (const atual of ordenados.slice(1)) {
    const ultimo = fundidos[fundidos.length - 1]!;
    if (atual.start.getTime() <= ultimo.end.getTime()) {
      if (atual.end.getTime() > ultimo.end.getTime()) ultimo.end = atual.end;
      ultimo.hard = ultimo.hard || atual.hard;
    } else {
      fundidos.push({ ...atual });
    }
  }
  return fundidos;
}

export interface ConflictCheckResult {
  conflict: boolean;
  /** Só preenchido quando há conflito — o horário ocupado, nunca o título (privacidade, §27 — quem decide mostrar o título é a camada de API, não este módulo). */
  busySlot: { start: Date; end: Date } | null;
  /** true = pelo menos um conflito é com participante OBRIGATÓRIO (hard) — bloqueia por padrão (§19/§20). */
  hard: boolean;
}

/**
 * Checa se [candidateStart, candidateEnd) colide com algum intervalo ocupado.
 * Overlap clássico de intervalos semiabertos: A começa antes de B terminar E
 * B começa antes de A terminar.
 */
export function checkConflict(busy: BusyInterval[], candidateStart: Date, candidateEnd: Date): ConflictCheckResult {
  const colisao = mergeIntervals(busy).find((intervalo) => candidateStart.getTime() < intervalo.end.getTime() && intervalo.start.getTime() < candidateEnd.getTime());
  if (!colisao) return { conflict: false, busySlot: null, hard: false };
  return { conflict: true, busySlot: { start: colisao.start, end: colisao.end }, hard: colisao.hard };
}

export interface BusinessHours {
  /** Hora local de início/fim do expediente (0-23). Default 9-18, mesma régua em todo lugar que chamar sem configurar. */
  startHour: number;
  endHour: number;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = { startHour: 9, endHour: 18 };

export interface FreeSlot {
  start: Date;
  end: Date;
}

/**
 * Janelas livres de UMA pessoa dentro do expediente, recortando os intervalos
 * ocupados (só os HARD contam pra "livre/ocupado" — soft não trava um slot,
 * §20). `slotMinutes` é o grão mínimo considerado (um buraco de 10min entre
 * duas reuniões não vira sugestão de slot de 30min).
 */
export function freeSlotsFor(busy: BusyInterval[], rangeStart: Date, rangeEnd: Date, businessHours: BusinessHours = DEFAULT_BUSINESS_HOURS, slotMinutes = 30): FreeSlot[] {
  const hardBusy = mergeIntervals(busy.filter((b) => b.hard));
  const slots: FreeSlot[] = [];
  const slotMs = slotMinutes * 60_000;

  for (let dia = new Date(rangeStart); dia.getTime() < rangeEnd.getTime(); dia.setDate(dia.getDate() + 1)) {
    const inicioExpediente = new Date(dia);
    inicioExpediente.setHours(businessHours.startHour, 0, 0, 0);
    const fimExpediente = new Date(dia);
    fimExpediente.setHours(businessHours.endHour, 0, 0, 0);

    const janelaInicio = inicioExpediente.getTime() < rangeStart.getTime() ? rangeStart : inicioExpediente;
    const janelaFim = fimExpediente.getTime() > rangeEnd.getTime() ? rangeEnd : fimExpediente;
    if (janelaInicio.getTime() >= janelaFim.getTime()) continue;

    let cursor = janelaInicio;
    const ocupadosNoDia = hardBusy.filter((b) => b.start.getTime() < janelaFim.getTime() && b.end.getTime() > janelaInicio.getTime());

    for (const bloco of ocupadosNoDia) {
      if (bloco.start.getTime() - cursor.getTime() >= slotMs) {
        slots.push({ start: new Date(cursor), end: new Date(bloco.start) });
      }
      if (bloco.end.getTime() > cursor.getTime()) cursor = new Date(bloco.end);
    }
    if (janelaFim.getTime() - cursor.getTime() >= slotMs) {
      slots.push({ start: new Date(cursor), end: new Date(janelaFim) });
    }
  }
  return slots;
}

/**
 * Slots livres EM COMUM entre várias pessoas, com duração mínima — a base de
 * "Find next slot"/"Bento, marca 30min comigo, Jamille e Alicia" (§21/§33).
 * Interseção de intervalos: um slot comum só existe onde TODO MUNDO tem
 * espaço ao mesmo tempo.
 */
export function findCommonAvailability(
  busyByMember: Record<string, BusyInterval[]>,
  rangeStart: Date,
  rangeEnd: Date,
  durationMinutes: number,
  businessHours: BusinessHours = DEFAULT_BUSINESS_HOURS,
): FreeSlot[] {
  const memberIds = Object.keys(busyByMember);
  if (memberIds.length === 0) return [];

  const livresPorPessoa = memberIds.map((id) => freeSlotsFor(busyByMember[id] ?? [], rangeStart, rangeEnd, businessHours, durationMinutes));

  let comuns = livresPorPessoa[0]!;
  for (const livres of livresPorPessoa.slice(1)) {
    const proximos: FreeSlot[] = [];
    for (const a of comuns) {
      for (const b of livres) {
        const inicio = a.start.getTime() > b.start.getTime() ? a.start : b.start;
        const fim = a.end.getTime() < b.end.getTime() ? a.end : b.end;
        if (fim.getTime() - inicio.getTime() >= durationMinutes * 60_000) proximos.push({ start: inicio, end: fim });
      }
    }
    comuns = proximos;
    if (comuns.length === 0) break;
  }

  return comuns
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((slot) => ({ start: slot.start, end: new Date(slot.start.getTime() + durationMinutes * 60_000) }));
}
