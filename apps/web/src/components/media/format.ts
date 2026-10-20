export const dash = '—';

export function money(v: number | null | undefined, currency: string | null | undefined): string {
  if (v === null || v === undefined) return dash;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency ?? 'BRL' }).format(v);
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined) return dash;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return dash;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)}%`;
}

export function change(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'sem base';
  return `${v > 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Custo por resultado precisa dizer o que é "resultado": lead, conversa no WhatsApp, compra. */
export const RESULT_KIND_LABEL: Record<string, string> = {
  lead: 'leads',
  'onsite_conversion.lead_grouped': 'leads (formulário)',
  'offsite_conversion.fb_pixel_lead': 'leads (pixel)',
  'onsite_conversion.messaging_conversation_started_7d': 'conversas iniciadas',
  'offsite_conversion.fb_pixel_purchase': 'compras',
  purchase: 'compras',
  'offsite_conversion.fb_pixel_complete_registration': 'cadastros',
};

export function resultLabel(kinds: string[] | undefined): string {
  if (!kinds || kinds.length === 0) return 'Resultados';
  const names = kinds.map((k) => RESULT_KIND_LABEL[k] ?? k);
  return names.length === 1 ? names[0]!.replace(/^./, (c) => c.toUpperCase()) : 'Resultados (tipos mistos)';
}

export const STATUS_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'mute' }> = {
  ACTIVE: { text: 'Ativa', tone: 'ok' },
  PAUSED: { text: 'Pausada', tone: 'mute' },
  CAMPAIGN_PAUSED: { text: 'Campanha pausada', tone: 'mute' },
  ADSET_PAUSED: { text: 'Conjunto pausado', tone: 'mute' },
  DISAPPROVED: { text: 'Reprovada', tone: 'bad' },
  WITH_ISSUES: { text: 'Com problemas', tone: 'bad' },
  PENDING_REVIEW: { text: 'Em análise', tone: 'warn' },
  IN_PROCESS: { text: 'Em processamento', tone: 'warn' },
  ARCHIVED: { text: 'Arquivada', tone: 'mute' },
  DELETED: { text: 'Excluída', tone: 'mute' },
};

export const TONE_CLASS = {
  ok: 'bg-sinal/15 text-sinal',
  warn: 'bg-aviso/15 text-aviso',
  bad: 'bg-erro/15 text-erro',
  mute: 'bg-grafite-elevado text-nevoa',
} as const;
