export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'Agora mesmo';
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `Há ${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  return `Há ${diffDays}d`;
}

export function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const diffSeconds = Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  if (diffSeconds < 60) return `${Math.round(diffSeconds)}s`;
  return `${Math.round(diffSeconds / 60)}min`;
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

/** Real costs are fractions of a cent (LLM token pricing), 2-decimal USD formatting would
 * round everything to $0.00. Shows more precision for sub-cent values. */
export function formatUsd(value: number): string {
  const decimals = value !== 0 && Math.abs(value) < 0.01 ? 6 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
