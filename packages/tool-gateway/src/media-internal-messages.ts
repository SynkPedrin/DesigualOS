import { formatMoney } from './media-templates';

/**
 * media-internal-messages.ts — as mensagens que o Bento manda PARA A EQUIPE
 * quando algo de mídia pede atenção.
 *
 * Destinatário é gente da agência (a Alicia, que gerencia as contas), nunca o
 * cliente: o tom é de colega avisando colega. Pessoal (saudação pelo horário e
 * pelo nome), com emoji que ajuda a bater o olho (a gravidade e o tipo) e um
 * próximo passo claro. Texto no formato do WhatsApp: *negrito*, _itálico_.
 *
 * REGRAS QUE NÃO SE NEGOCIAM:
 *  - Linha só existe se o dado existe. Nunca "R$ 0,00" no lugar de saldo
 *    desconhecido, nunca número inventado: mensagem financeira errada é pior
 *    que mensagem nenhuma (a mesma régua de media-templates.ts).
 *  - Saldo ESTIMADO é dito como estimativa, nunca como saldo da conta.
 *  - Sem travessão: é a regra de texto de produto da Desigual OS.
 *  - Pura: sem banco, sem relógio (o `now` entra de fora), testável.
 */

export interface InternalAlertInput {
  recipientName: string;
  now: Date;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  /** Título já formatado pelo motor de alertas (ex.: "Saldo em R$ 85,00"). */
  title: string;
  clientName: string | null;
  platform: string;
  accountName: string;
  currency: string | null;
  /** Investimento e resultados do período avaliado, quando existem. */
  spend: number | null;
  results: number | null;
  /** Nomes das campanhas envolvidas (pausadas ou reprovadas). */
  campaigns?: string[];
  /** O `detail` que o motor de alertas gravou no evento. */
  detail?: Record<string, unknown>;
  /** Link da tela de Mídia do cliente, quando a URL do app é conhecida. */
  link?: string | null;
}

const TIME_ZONE = 'America/Sao_Paulo';

export function saudacao(now: Date): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false }).format(now));
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

const GRAVIDADE: Record<InternalAlertInput['severity'], { emoji: string; rotulo: string; fecho: string }> = {
  critical: { emoji: '🔴', rotulo: 'URGENTE', fecho: '⚡ Isso pede ação agora.' },
  warning: { emoji: '🟠', rotulo: 'Atenção', fecho: '✅ Dá para resolver ainda hoje.' },
  info: { emoji: '🔵', rotulo: 'Aviso', fecho: '' },
};

const TIPO: Record<string, string> = {
  low_balance: '💸',
  budget_limit: '📊',
  cpl_above: '📈',
  cpa_above: '📈',
  leads_drop: '📉',
  campaign_paused: '⏸️',
  campaign_rejected: '🚫',
  sync_failed: '🔌',
  account_inactive: '⛔',
};

const PLATAFORMA: Record<string, { emoji: string; nome: string }> = {
  meta: { emoji: '📘', nome: 'Meta Ads' },
  google: { emoji: '🔎', nome: 'Google Ads' },
};

const numero = (valor: unknown): number | null => (typeof valor === 'number' && Number.isFinite(valor) ? valor : null);
const texto = (valor: unknown): string | null => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);

function proximoPasso(input: InternalAlertInput): string | null {
  switch (input.type) {
    case 'low_balance':
      return '👉 Vale recarregar a conta ou avisar o cliente antes dos anúncios pararem.';
    case 'budget_limit':
      return '👉 Confira se o limite de gastos vai segurar até o fim do período.';
    case 'cpl_above':
    case 'cpa_above':
      return '👉 Vale olhar os criativos e os públicos que estão puxando o custo.';
    case 'leads_drop':
      return '👉 Vale conferir se alguma campanha parou, mudou de verba ou reprovou.';
    case 'campaign_paused':
      return '👉 Veja se foi pausa intencional; se não foi, reative.';
    case 'campaign_rejected':
      return '👉 Abra a campanha na plataforma para ver o motivo e corrigir o anúncio.';
    case 'sync_failed':
      return '👉 Os números dessa conta podem estar desatualizados até a sincronização voltar.';
    case 'account_inactive':
      return '👉 Confira a conta na plataforma (pagamento, política ou bloqueio).';
    default:
      return null;
  }
}

/** Linhas de contexto que dependem do tipo. Só entram quando o dado existe. */
function contexto(input: InternalAlertInput): string[] {
  const linhas: string[] = [];
  const d = input.detail ?? {};
  const moeda = (v: number | null) => formatMoney(v, input.currency);

  if (input.type === 'low_balance') {
    const limite = moeda(numero(d.threshold));
    if (limite) linhas.push(`🎯 Alerta configurado para ${limite}`);
    if (d.balanceKind && d.balanceKind !== 'ACTUAL_BALANCE') {
      linhas.push('ℹ️ _Valor estimado a partir do limite de gastos; não é o saldo real da conta._');
    }
  }
  if (input.type === 'budget_limit') {
    const gasto = moeda(numero(d.amountSpent));
    const teto = moeda(numero(d.spendCap));
    if (gasto && teto) linhas.push(`💰 Já gasto: ${gasto} de ${teto}`);
  }
  if (['cpl_above', 'cpa_above', 'leads_drop'].includes(input.type)) {
    const investido = moeda(input.spend);
    if (investido) linhas.push(`💰 Investido no período: ${investido}`);
    if (input.results !== null) linhas.push(`🎯 Resultados no período: ${input.results}`);
  }
  if (input.type === 'campaign_paused' || input.type === 'campaign_rejected') {
    const nomes = (input.campaigns ?? []).filter(Boolean);
    nomes.slice(0, 5).forEach((nome) => linhas.push(`• ${nome}`));
    if (nomes.length > 5) linhas.push(`• e mais ${nomes.length - 5}`);
  }
  if (input.type === 'sync_failed') {
    const erro = texto(d.error);
    if (erro) linhas.push(`🛠️ ${erro.slice(0, 140)}`);
  }
  return linhas;
}

export function buildInternalAlertMessage(input: InternalAlertInput): string {
  const g = GRAVIDADE[input.severity];
  const plataforma = PLATAFORMA[input.platform] ?? { emoji: '📣', nome: input.platform };
  const cabecalho = `${g.emoji} *${g.rotulo}* · ${saudacao(input.now)}, ${input.recipientName}!`;

  const blocos: string[] = [
    cabecalho,
    `${TIPO[input.type] ?? '🔔'} *${input.title}*`,
    [`${plataforma.emoji} ${input.clientName ?? 'Cliente sem nome'} · ${plataforma.nome}`, `🧾 Conta: ${input.accountName}`].join('\n'),
  ];
  const extra = contexto(input);
  if (extra.length > 0) blocos.push(extra.join('\n'));

  const rodape = [proximoPasso(input), g.fecho, input.link ? `🔗 ${input.link}` : null].filter((l): l is string => Boolean(l));
  if (rodape.length > 0) blocos.push(rodape.join('\n'));
  blocos.push('_Bento · Desigual OS_');
  return blocos.join('\n\n');
}

/** Aviso de relatório pronto para a equipe (ex.: o agendado da semana terminou de gerar). */
export function buildInternalReportMessage(input: { recipientName: string; now: Date; clientName: string; periodLabel: string; url: string }): string {
  return [
    `📄 *Relatório pronto* · ${saudacao(input.now)}, ${input.recipientName}!`,
    `📘🔎 ${input.clientName}\n🗓️ Período: ${input.periodLabel}`,
    `👉 Dá uma conferida e, se estiver tudo certo, é só enviar ao cliente.\n🔗 ${input.url}`,
    '_Bento · Desigual OS_',
  ].join('\n\n');
}

/**
 * Mensagem de TESTE: mostra à equipe como o aviso de verdade vai chegar, com um
 * exemplo claramente marcado como exemplo (nome de cliente e valores fictícios),
 * para ninguém confundir com um problema real numa conta.
 */
export function buildInternalTestMessage(input: { recipientName: string; now: Date }): string {
  const exemplo = buildInternalAlertMessage({
    recipientName: input.recipientName,
    now: input.now,
    type: 'low_balance',
    severity: 'warning',
    title: 'Saldo em R$ 85,00',
    clientName: 'Cliente de exemplo',
    platform: 'meta',
    accountName: 'Conta de exemplo',
    currency: 'BRL',
    spend: null,
    results: null,
    detail: { balanceKind: 'ACTUAL_BALANCE', threshold: 100 },
    link: null,
  });
  return `🧪 *Mensagem de teste*: é assim que os avisos de mídia vão chegar por aqui. Nada abaixo é real.\n\n${exemplo}`;
}
