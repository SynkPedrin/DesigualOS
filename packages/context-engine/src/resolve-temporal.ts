/**
 * resolve-temporal.ts — "amanhã" resolvido pelo RELÓGIO da aplicação, nunca pelo
 * conhecimento do modelo.
 *
 * Por que existe: uma pergunta como "quantas tasks vencem amanhã?" precisa virar uma
 * janela de epoch ms pra filtrar no ClickUp (`due_date_gt`/`due_date_lt`). Se essa
 * conta for deixada pro LLM, ele erra de duas formas conhecidas: usa a data de
 * treinamento dele, e ignora fuso (o ClickUp devolve/aceita ms em UTC, mas o dia útil
 * da agência é America/Sao_Paulo — "amanhã" começa 03:00 UTC, não 00:00 UTC).
 *
 * Toda a resolução aqui é determinística e testável com um `now` injetado.
 */

export const OPERATION_TIMEZONE = 'America/Sao_Paulo';

export interface TemporalRange {
  /** Início da janela, epoch ms (inclusivo no sentido humano do dia). */
  from: number;
  /** Fim da janela, epoch ms. */
  to: number;
  /** Rótulo curto pra log/observabilidade, nunca pra mostrar cru pro usuário. */
  label: 'hoje' | 'amanha' | 'ontem' | 'esta-semana' | 'semana-passada' | 'proximos-7-dias' | 'ultimos-7-dias' | 'atrasadas';
  /** true quando a intenção é "vencidas até agora", não uma janela de calendário. */
  overdue?: boolean;
}

/** Deslocamento do fuso (em ms) vigente NAQUELE instante — cobre horário de verão
 * sem tabela própria, usando só o Intl do runtime. */
function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Hora 24 aparece como "24" em alguns runtimes pra meia-noite; normaliza pra 0.
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - instant.getTime();
}

/** Componentes de calendário do instante NO fuso da operação. */
function zonedParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [year, month, day] = fmt.format(instant).split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * Instante (epoch ms) da MEIA-NOITE local do dia de `now` deslocado em `offsetDays`.
 * Resolve o offset duas vezes porque o próprio deslocamento pode mudar entre o
 * instante de referência e o dia-alvo (virada de horário de verão); a segunda
 * passada usa o offset vigente no dia certo.
 */
export function zonedDayStart(
  now: Date,
  offsetDays: number,
  timeZone: string = OPERATION_TIMEZONE,
): number {
  const { year, month, day } = zonedParts(now, timeZone);
  // Meio-dia UTC como âncora: longe o bastante das duas meia-noites pra que somar
  // dias nunca caia no dia errado por causa de fuso.
  const targetUtcNoon = Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0);
  const target = zonedParts(new Date(targetUtcNoon), timeZone);

  const naiveMidnight = Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0, 0);
  const offsetGuess = timezoneOffsetMs(new Date(naiveMidnight), timeZone);
  const offsetExact = timezoneOffsetMs(new Date(naiveMidnight - offsetGuess), timeZone);
  return naiveMidnight - offsetExact;
}

/**
 * Janela do dia local inteiro, em epoch ms.
 *
 * O fim é derivado do INÍCIO DO DIA SEGUINTE menos 1ms, e não de um
 * "23:59:59.999 + offset" calculado à parte. Motivo real (bug pego pelo próprio
 * teste desta função): `timezoneOffsetMs` se baseia em `formatToParts`, que não tem
 * campo de milissegundo — recalcular o offset em cima de um instante com `.999`
 * devolvia 999ms de erro e empurrava o fim da janela pra 00:00:00.998 do dia
 * seguinte, fazendo "amanhã" incluir um pedacinho de depois de amanhã. Derivar do
 * dia seguinte também acerta de graça os dias de 23h/25h na virada de horário de
 * verão, que um "+24h" fixo erraria.
 */
export function zonedDayRange(
  now: Date,
  offsetDays: number,
  timeZone: string = OPERATION_TIMEZONE,
): { from: number; to: number } {
  const from = zonedDayStart(now, offsetDays, timeZone);
  const to = zonedDayStart(now, offsetDays + 1, timeZone) - 1;
  return { from, to };
}

/**
 * Padrões temporais em PT-BR. Ordem importa: o mais específico primeiro, senão
 * "semana passada" casaria em "semana". Cada entrada é uma função pra que a janela
 * seja calculada com o `now` real da chamada, nunca em tempo de import.
 */
const PATTERNS: Array<{ re: RegExp; build: (now: Date, tz: string) => TemporalRange }> = [
  {
    re: /\b(atrasad[oa]s?|vencid[oa]s?|em atraso|passou do prazo)\b/i,
    build: (now, tz) => {
      // "Atrasadas" não é janela de calendário: é tudo que venceu ANTES de hoje.
      const hoje = zonedDayRange(now, 0, tz);
      return { from: 0, to: hoje.from - 1, label: 'atrasadas', overdue: true };
    },
  },
  {
    re: /\b(semana passada|semana anterior)\b/i,
    build: (now, tz) => {
      const inicio = zonedDayRange(now, -7, tz);
      const fim = zonedDayRange(now, -1, tz);
      return { from: inicio.from, to: fim.to, label: 'semana-passada' };
    },
  },
  {
    re: /\b(ultim[oa]s?\s+7\s+dias|ultima semana|ultimos sete dias)\b/i,
    build: (now, tz) => {
      const inicio = zonedDayRange(now, -6, tz);
      const fim = zonedDayRange(now, 0, tz);
      return { from: inicio.from, to: fim.to, label: 'ultimos-7-dias' };
    },
  },
  {
    re: /\b(proxim[oa]s?\s+7\s+dias|proxima semana|proximos sete dias)\b/i,
    build: (now, tz) => {
      const inicio = zonedDayRange(now, 1, tz);
      const fim = zonedDayRange(now, 7, tz);
      return { from: inicio.from, to: fim.to, label: 'proximos-7-dias' };
    },
  },
  {
    re: /\b(esta semana|essa semana|nesta semana|da semana)\b/i,
    build: (now, tz) => {
      // Semana da operação = segunda a domingo (padrão BR de agência).
      const hojeParts = zonedParts(now, tz);
      const diaSemana = new Date(Date.UTC(hojeParts.year, hojeParts.month - 1, hojeParts.day)).getUTCDay();
      const desdeSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
      const inicio = zonedDayRange(now, -desdeSegunda, tz);
      const fim = zonedDayRange(now, 6 - desdeSegunda, tz);
      return { from: inicio.from, to: fim.to, label: 'esta-semana' };
    },
  },
  {
    re: /\bamanh[aã]\b/i,
    build: (now, tz) => ({ ...zonedDayRange(now, 1, tz), label: 'amanha' }),
  },
  {
    re: /\b(ontem|dia anterior)\b/i,
    build: (now, tz) => ({ ...zonedDayRange(now, -1, tz), label: 'ontem' }),
  },
  {
    re: /\b(hoje|de hoje|para hoje|pra hoje|do dia)\b/i,
    build: (now, tz) => ({ ...zonedDayRange(now, 0, tz), label: 'hoje' }),
  },
];

/** Tira acento pra que "amanhã"/"amanha" e "últimos"/"ultimos" casem no mesmo padrão. */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * @returns a janela temporal citada na mensagem, ou `null` quando a mensagem não
 *   cita tempo nenhum (o chamador decide o default — não inventamos "hoje" aqui,
 *   porque "quais tasks da 3net" NÃO é uma pergunta sobre hoje).
 */
export function resolveTemporalRange(
  message: string,
  now: Date = new Date(),
  timeZone: string = OPERATION_TIMEZONE,
): TemporalRange | null {
  const normalized = stripAccents(message);
  for (const { re, build } of PATTERNS) {
    if (re.test(normalized) || re.test(message)) {
      return build(now, timeZone);
    }
  }
  return null;
}
