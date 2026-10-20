/**
 * media-metrics.ts — cálculo PURO de métricas derivadas e janelas de período.
 *
 * Uma só implementação para tela, relatório, alerta e agente: o defeito que
 * esta equipe já caçou foi "duas disciplinas de número sobre o mesmo dado".
 * Divisão por zero devolve null, nunca 0 nem Infinity: ausência de dado não é
 * resultado zero.
 */

export interface RawTotals {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  results: number | null;
  conversionValue: number | null;
}

export interface DerivedMetrics extends RawTotals {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Custo por resultado (lead, conversa ou compra, conforme `resultsKind`). */
  costPerResult: number | null;
  roas: number | null;
}

const div = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);
const round = (v: number | null, d = 2): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

export function deriveMetrics(t: RawTotals): DerivedMetrics {
  return {
    ...t,
    ctr: round(div(t.clicks !== null && t.impressions !== null ? t.clicks * 100 : null, t.impressions), 2),
    cpc: round(div(t.spend, t.clicks), 2),
    cpm: round(div(t.spend !== null ? t.spend * 1000 : null, t.impressions), 2),
    costPerResult: round(div(t.spend, t.results), 2),
    roas: round(div(t.conversionValue, t.spend), 2),
  };
}

/** Variação percentual. Base zero/ausente = null ("sem base de comparação"), não +∞. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

export type MediaPeriod = 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month';

export interface DateRange {
  since: string; // YYYY-MM-DD inclusive
  until: string; // YYYY-MM-DD inclusive
}

const TZ = 'America/Sao_Paulo';

/** "Hoje" no fuso da agência, não em UTC: às 22h de Brasília UTC já virou o dia seguinte. */
export function todayIn(now: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function resolvePeriod(period: MediaPeriod, now = new Date(), timeZone = TZ): DateRange {
  const today = todayIn(now, timeZone);
  switch (period) {
    case 'today':
      return { since: today, until: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { since: y, until: y };
    }
    case 'last_7d':
      return { since: addDays(today, -6), until: today };
    case 'last_14d':
      return { since: addDays(today, -13), until: today };
    case 'last_30d':
      return { since: addDays(today, -29), until: today };
    case 'this_month':
      return { since: `${today.slice(0, 8)}01`, until: today };
    case 'last_month': {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev };
    }
  }
}

export function daysIn(range: DateRange): number {
  return Math.round((new Date(`${range.until}T00:00:00Z`).getTime() - new Date(`${range.since}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

/** Período anterior de MESMA duração, imediatamente antes. */
export function previousRange(range: DateRange): DateRange {
  const n = daysIn(range);
  return { since: addDays(range.since, -n), until: addDays(range.since, -1) };
}

/** Rótulo de aviso quando a janela pedida inclui o dia de hoje: o dia corrente ainda está incompleto. */
export function includesToday(range: DateRange, now = new Date(), timeZone = TZ): boolean {
  return range.until >= todayIn(now, timeZone);
}
