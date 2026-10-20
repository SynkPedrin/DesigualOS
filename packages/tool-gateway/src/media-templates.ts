/**
 * media-templates.ts — modelos de mensagem de Mídia (alertas e relatórios).
 *
 * Duas regras duras:
 *  1. Variável desconhecida é erro, não texto literal "{saldoo}" indo para o
 *     grupo de um cliente.
 *  2. Variável usada cujo valor NÃO existe (saldo indisponível, CPL sem
 *     resultados) bloqueia o envio. Nunca se preenche com 0, "-" ou "N/D":
 *     mensagem financeira com número inventado é pior que mensagem nenhuma.
 */

export const TEMPLATE_VARIABLES = [
  'cliente',
  'plataforma',
  'conta',
  'saldo',
  'orcamento',
  'investimento',
  'cpl',
  'cpa',
  'leads',
  'periodo',
  'data',
  'link_relatorio',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export type TemplateValues = Partial<Record<TemplateVariable, string | null>>;

export interface DefaultTemplate {
  code: string;
  name: string;
  body: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  { code: 'low_balance', name: 'Saldo baixo', body: 'Olá! Aqui é a Agência Desigual. A conta de anúncios {conta} ({plataforma}) de {cliente} está com saldo de {saldo}. Para os anúncios não pararem, vale providenciar a recarga.' },
  { code: 'budget_limit', name: 'Orçamento próximo do limite', body: 'Atenção: a conta {conta} ({plataforma}) de {cliente} já usou {investimento} do limite de gastos de {orcamento}. Vamos alinhar o próximo passo?' },
  { code: 'weekly_report', name: 'Relatório semanal', body: 'Olá! Segue o relatório semanal de mídia de {cliente} ({periodo}): investimento de {investimento}, {leads} resultados. Relatório completo: {link_relatorio}' },
  { code: 'monthly_report', name: 'Relatório mensal', body: 'Olá! Segue o relatório mensal de mídia de {cliente} ({periodo}): investimento de {investimento}, {leads} resultados. Relatório completo: {link_relatorio}' },
  { code: 'campaign_stopped', name: 'Campanha interrompida', body: 'Aviso de {data}: identificamos que uma campanha de {cliente} em {plataforma} (conta {conta}) deixou de veicular. Já estamos verificando.' },
  { code: 'results_drop', name: 'Queda de resultados', body: 'Aviso de {data}: os resultados de {cliente} em {plataforma} caíram no período {periodo} ({leads} resultados, custo por resultado {cpl}). Estamos analisando as campanhas.' },
  { code: 'executive_summary', name: 'Resumo executivo', body: 'Resumo de {cliente} em {plataforma} ({periodo}): investimento {investimento}, {leads} resultados, custo por resultado {cpl}.' },
];

const VAR_PATTERN = /\{([a-z_]+)\}/g;

export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_PATTERN)].map((m) => m[1]!))];
}

export interface TemplateValidation {
  ok: boolean;
  unknown: string[];
}

export function validateTemplate(body: string): TemplateValidation {
  const unknown = extractVariables(body).filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v));
  return { ok: unknown.length === 0 && body.trim().length > 0, unknown };
}

export type RenderResult = { ok: true; text: string } | { ok: false; reason: 'unknown_variables' | 'missing_values' | 'empty'; variables: string[] };

export function renderTemplate(body: string, values: TemplateValues): RenderResult {
  if (body.trim().length === 0) return { ok: false, reason: 'empty', variables: [] };
  const { unknown } = validateTemplate(body);
  if (unknown.length > 0) return { ok: false, reason: 'unknown_variables', variables: unknown };
  const missing = extractVariables(body).filter((v) => {
    const value = values[v as TemplateVariable];
    return value === null || value === undefined || value === '';
  });
  if (missing.length > 0) return { ok: false, reason: 'missing_values', variables: missing };
  return { ok: true, text: body.replace(VAR_PATTERN, (_m, v: string) => values[v as TemplateVariable] as string) };
}

export const formatMoney = (value: number | null, currency: string | null): string | null =>
  value === null ? null : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency ?? 'BRL' }).format(value);
