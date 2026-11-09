import { and, asc, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import { completarTextoComSeguranca, completeTextSafely } from '@desigual-os/router';
import type { DocumentoLido } from './bento-documentos';
import { analisarDocumentos } from './jarbas-documentos';
import {
  getGoogleAdsAccountInsights,
  getGoogleAdsCampaigns,
  getGoogleAdsEnvConfig,
  getMetaAccountInsights,
  getMetaCampaigns,
  mediaContextForAgent,
  resolveGoogleAdsAccessByConnectionId,
  resolveMetaAccessByConnectionId,
} from '@desigual-os/tool-gateway';

/**
 * O JARBAS RESPONDE DO SERVIDOR (14/10/2026, pedido do Pedro: "religue o
 * Jarbas").
 *
 * O Jarbas morava num serviço do Mac Mini (agentes-desigual), que saiu de
 * operação. Sem ele, toda pergunta de tráfego caía em "fora do ar". Este
 * módulo responde do worker, como o Bento já faz: busca os números REAIS da
 * conta de anúncio vinculada ao cliente (as mesmas funções do relatório em
 * PDF) e o GPT escreve a análise em cima deles.
 *
 * As regras que não se negociam:
 * - todo número da resposta vem do bloco DADOS; a comparação é aritmética
 *   feita aqui, nunca conta do modelo;
 * - sem conta vinculada ou com conexão expirada, a resposta diz isso e como
 *   resolver — nunca zero no lugar de "não sei";
 * - só leitura: o escopo OAuth já é `ads_read`, e o texto não pode prometer
 *   alteração de campanha.
 *
 * `JARBAS_LOCAL_ENABLED=false` devolve o comportamento antigo (serviço
 * externo) sem deploy de código.
 */
export function jarbasLocalLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JARBAS_LOCAL_ENABLED !== 'false';
}

// ── Período ────────────────────────────────────────────────────────────────

export interface Janela {
  since: string;
  until: string;
}

export interface PeriodoDaPergunta {
  atual: Janela;
  anterior: Janela;
  rotulo: string;
}

const DIA_MS = 86_400_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "Hoje" no fuso da agência, como data UTC à meia-noite. */
function hojeEmSaoPaulo(agora: Date): Date {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora).split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!));
}

function janelaAnterior(atual: Janela): Janela {
  const ini = Date.parse(`${atual.since}T00:00:00Z`);
  const fim = Date.parse(`${atual.until}T00:00:00Z`);
  const dias = Math.round((fim - ini) / DIA_MS) + 1;
  return { since: ymd(new Date(ini - dias * DIA_MS)), until: ymd(new Date(ini - DIA_MS)) };
}

function dataBR(texto: string, anoPadrao: number): Date | null {
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : anoPadrao;
  const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * O período que a pessoa pediu, e o anterior do mesmo tamanho para comparar.
 * Sem período na frase, os últimos 7 dias — e o rótulo diz isso, para a
 * resposta não esconder a escolha.
 */
export function periodoDaPergunta(pergunta: string, agora: Date = new Date()): PeriodoDaPergunta {
  const texto = pergunta.toLowerCase();
  const hoje = hojeEmSaoPaulo(agora);
  const dia = (n: number) => ymd(new Date(hoje.getTime() + n * DIA_MS));

  const faixa = texto.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:a|até|-)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (faixa) {
    const ini = dataBR(faixa[1]!, hoje.getUTCFullYear());
    const fim = dataBR(faixa[2]!, hoje.getUTCFullYear());
    if (ini && fim && ini <= fim) {
      const atual = { since: ymd(ini), until: ymd(fim) };
      return { atual, anterior: janelaAnterior(atual), rotulo: `de ${faixa[1]} a ${faixa[2]}` };
    }
  }
  const com = (atual: Janela, rotulo: string): PeriodoDaPergunta => ({ atual, anterior: janelaAnterior(atual), rotulo });

  if (/\bontem\b/.test(texto)) return com({ since: dia(-1), until: dia(-1) }, 'ontem');
  if (/\bhoje\b/.test(texto)) return com({ since: dia(0), until: dia(0) }, 'hoje (parcial)');
  const ultimos = texto.match(/[úu]ltimos?\s+(\d{1,3})\s+dias/);
  if (ultimos) {
    const n = Math.min(Math.max(Number(ultimos[1]), 1), 365);
    return com({ since: dia(-n + 1), until: dia(0) }, `últimos ${n} dias`);
  }
  const diaDaSemana = (hoje.getUTCDay() + 6) % 7; // segunda = 0
  if (/semana passada|[úu]ltima semana/.test(texto)) {
    return com({ since: dia(-diaDaSemana - 7), until: dia(-diaDaSemana - 1) }, 'semana passada');
  }
  if (/\b(esta|essa|nesta|nessa)\s+semana\b/.test(texto)) {
    return com({ since: dia(-diaDaSemana), until: dia(0) }, 'esta semana');
  }
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth();
  if (/m[êe]s passado|[úu]ltimo m[êe]s/.test(texto)) {
    const atual = { since: ymd(new Date(Date.UTC(ano, mes - 1, 1))), until: ymd(new Date(Date.UTC(ano, mes, 0))) };
    const anterior = { since: ymd(new Date(Date.UTC(ano, mes - 2, 1))), until: ymd(new Date(Date.UTC(ano, mes - 1, 0))) };
    return { atual, anterior, rotulo: 'mês passado' };
  }
  if (/\b(este|esse|neste|nesse)\s+m[êe]s\b/.test(texto)) {
    const atual = { since: ymd(new Date(Date.UTC(ano, mes, 1))), until: dia(0) };
    return com(atual, 'este mês até hoje');
  }
  return com({ since: dia(-6), until: dia(0) }, 'últimos 7 dias (padrão, a pergunta não citou período)');
}

// ── Dados ─────────────────────────────────────────────────────────────────

export interface Totais {
  investimento: number | null;
  impressoes: number | null;
  cliques: number | null;
  ctr: number | null;
  cpc: number | null;
  resultados: number | null;
}

export interface Campanha {
  nome: string;
  status: string | null;
  investimento: number | null;
  cliques: number | null;
  ctr: number | null;
}

export interface Canal {
  canal: 'Meta Ads' | 'Google Ads';
  conectado: boolean;
  motivo?: string;
  atual?: Totais | null;
  anterior?: Totais | null;
  campanhas?: Campanha[];
}

async function lerMeta(clientId: string, p: PeriodoDaPergunta, logger: Logger): Promise<Canal> {
  const canal = 'Meta Ads' as const;
  const [vinculo] = await db
    .select()
    .from(schema.clientMetaAccounts)
    .where(eq(schema.clientMetaAccounts.clientId, clientId))
    .orderBy(desc(schema.clientMetaAccounts.isPrimary), asc(schema.clientMetaAccounts.createdAt))
    .limit(1);
  if (!vinculo) return { canal, conectado: false, motivo: 'nenhuma conta de anúncio do Meta vinculada a este cliente' };
  if (!vinculo.connectionId) return { canal, conectado: false, motivo: 'o vínculo do Meta está sem conexão; reconectar em Integrações' };
  const acesso = await resolveMetaAccessByConnectionId(vinculo.connectionId);
  if (!acesso) return { canal, conectado: false, motivo: 'a conexão do Meta usada neste cliente expirou ou foi desconectada; reconectar em Integrações' };
  try {
    const [a, b, campanhas] = await Promise.all([
      getMetaAccountInsights(acesso.token, vinculo.accountId, p.atual),
      getMetaAccountInsights(acesso.token, vinculo.accountId, p.anterior),
      getMetaCampaigns(acesso.token, vinculo.accountId, p.atual),
    ]);
    const totais = (i: typeof a): Totais | null =>
      i && { investimento: i.spend, impressoes: i.impressions, cliques: i.clicks, ctr: i.ctr, cpc: i.cpc, resultados: i.results };
    return {
      canal,
      conectado: true,
      atual: totais(a),
      anterior: totais(b),
      campanhas: campanhas.map((c) => ({ nome: c.name, status: c.status ?? null, investimento: c.spend, cliques: c.clicks, ctr: c.ctr })),
    };
  } catch (error) {
    logger.warn({ clientId, error: error instanceof Error ? error.message : String(error) }, '[jarbas-local] Meta falhou');
    return { canal, conectado: false, motivo: 'o Meta não respondeu agora; tentar de novo em instantes' };
  }
}

async function lerGoogle(clientId: string, p: PeriodoDaPergunta, logger: Logger): Promise<Canal> {
  const canal = 'Google Ads' as const;
  const [vinculo] = await db
    .select()
    .from(schema.clientGoogleAdsAccounts)
    .where(eq(schema.clientGoogleAdsAccounts.clientId, clientId))
    .orderBy(desc(schema.clientGoogleAdsAccounts.isPrimary), asc(schema.clientGoogleAdsAccounts.createdAt))
    .limit(1);
  if (!vinculo) return { canal, conectado: false, motivo: 'nenhuma conta do Google Ads vinculada a este cliente' };
  if (!vinculo.connectionId) return { canal, conectado: false, motivo: 'o vínculo do Google Ads está sem conexão; reconectar em Integrações' };
  const [acesso, config] = [await resolveGoogleAdsAccessByConnectionId(vinculo.connectionId), getGoogleAdsEnvConfig()];
  if (!acesso || !config) return { canal, conectado: false, motivo: 'a conexão do Google Ads expirou, foi desconectada ou não está configurada' };
  const cfg = vinculo.loginCustomerId ? { ...config, loginCustomerId: vinculo.loginCustomerId } : config;
  try {
    const [a, b, campanhas] = await Promise.all([
      getGoogleAdsAccountInsights(cfg, acesso.accessToken, vinculo.customerId, p.atual),
      getGoogleAdsAccountInsights(cfg, acesso.accessToken, vinculo.customerId, p.anterior),
      getGoogleAdsCampaigns(cfg, acesso.accessToken, vinculo.customerId, p.atual),
    ]);
    const totais = (i: typeof a): Totais | null =>
      i && { investimento: i.spend, impressoes: i.impressions, cliques: i.clicks, ctr: i.ctr, cpc: i.averageCpc, resultados: i.conversions };
    return {
      canal,
      conectado: true,
      atual: totais(a),
      anterior: totais(b),
      campanhas: campanhas.map((c) => ({ nome: c.name, status: c.status ?? null, investimento: c.spend, cliques: c.clicks, ctr: c.ctr })),
    };
  } catch (error) {
    logger.warn({ clientId, error: error instanceof Error ? error.message : String(error) }, '[jarbas-local] Google Ads falhou');
    return { canal, conectado: false, motivo: 'o Google Ads não respondeu agora; tentar de novo em instantes' };
  }
}

// ── Texto ─────────────────────────────────────────────────────────────────

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

function variacao(atual: number | null, anterior: number | null): string {
  if (atual == null || anterior == null) return 'sem comparação';
  if (anterior === 0) return atual === 0 ? 'igual' : 'antes era zero';
  const d = ((atual - anterior) / anterior) * 100;
  return `${d >= 0 ? '+' : ''}${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs período anterior`;
}

/** O bloco de fatos que o GPT lê. Todo número da resposta tem que estar aqui. */
export function dadosEmTexto(cliente: string, p: PeriodoDaPergunta, canais: Canal[]): string {
  const linhas = [
    `CLIENTE: ${cliente}`,
    `PERÍODO: ${p.atual.since} a ${p.atual.until} (${p.rotulo}). PERÍODO ANTERIOR, para comparar: ${p.anterior.since} a ${p.anterior.until}.`,
  ];
  for (const c of canais) {
    linhas.push('', `## ${c.canal}`);
    if (!c.conectado) {
      linhas.push(`SEM DADOS: ${c.motivo}.`);
      continue;
    }
    if (!c.atual) {
      linhas.push('Conta conectada, mas sem nenhuma veiculação no período.');
      continue;
    }
    const a = c.atual;
    const b = c.anterior ?? null;
    const metrica = (rotulo: string, va: number | null, vb: number | null, fmt: (v: number) => string) =>
      va == null ? null : `- ${rotulo}: ${fmt(va)} (${variacao(va, vb)}${vb != null ? `; anterior ${fmt(vb)}` : ''})`;
    linhas.push(
      ...[
        metrica('Investimento', a.investimento, b?.investimento ?? null, brl),
        metrica('Impressões', a.impressoes, b?.impressoes ?? null, num),
        metrica('Cliques', a.cliques, b?.cliques ?? null, num),
        metrica('CTR', a.ctr, b?.ctr ?? null, pct),
        metrica('Custo por clique', a.cpc, b?.cpc ?? null, brl),
        metrica(
          c.canal === 'Meta Ads' ? 'Resultados (soma de todas as ações registradas pelo Meta)' : 'Conversões',
          a.resultados,
          b?.resultados ?? null,
          num,
        ),
      ].filter((l): l is string => l !== null),
    );
    const top = [...(c.campanhas ?? [])].sort((x, y) => (y.investimento ?? 0) - (x.investimento ?? 0)).slice(0, 8);
    if (top.length > 0) {
      linhas.push('Campanhas com mais investimento no período:');
      for (const camp of top) {
        const partes = [camp.investimento != null ? brl(camp.investimento) : null, camp.cliques != null ? `${num(camp.cliques)} cliques` : null, camp.ctr != null ? `CTR ${pct(camp.ctr)}` : null]
          .filter(Boolean)
          .join(', ');
        linhas.push(`- ${camp.nome}${camp.status ? ` [${camp.status}]` : ''}: ${partes || 'sem números'}`);
      }
    }
  }
  return linhas.join('\n');
}

const PERSONA = [
  'Você é o Jarbas, o especialista em tráfego pago da Agência Desigual (Meta Ads e Google Ads).',
  'Fala como um gestor de tráfego sênior: direto, em português do Brasil, primeiro a leitura do que importa, depois os números que a sustentam, e uma recomendação prática quando houver base para isso.',
  'REGRAS QUE NÃO SE NEGOCIAM:',
  '- Todo número da resposta tem que estar no bloco DADOS, exatamente como está lá. Não calcule métrica nova, não estime, não arredonde para outro valor.',
  '- As variações contra o período anterior já estão calculadas no bloco; use-as como estão.',
  '- Canal marcado SEM DADOS: diga que não há dados e o motivo, e como resolver. Nunca trate ausência de dado como zero.',
  '- ROAS e CAC não estão disponíveis (não há dado de receita); se perguntarem, diga isso.',
  '- Você só lê. Não diga que pausou, alterou, ativou ou ajustou nada, nem ofereça fazer isso por aqui.',
  '- Diga o período analisado na primeira frase. Se ele for o padrão (a pergunta não citou período), mencione que dá para pedir outro.',
].join('\n');

export function montarPromptDoJarbas(pergunta: string, dados: string): string {
  return `${PERSONA}\n\nPERGUNTA:\n${pergunta}\n\nDADOS:\n${dados}`;
}

// ── Resposta ──────────────────────────────────────────────────────────────

function resposta(answer: string, sources: string[] = []): ExecuteResponse {
  return { execution_id: '', agent: 'jarbas', status: 'completed', answer, sources, tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 } };
}

/**
 * A pergunta pede para cruzar o documento com os números REAIS da conta?
 * Só então a conta é consultada: relatório de agosto comparado sem pedido com
 * "últimos 7 dias" da conta produziria divergência falsa, e cada consulta às
 * plataformas custa tempo do turno.
 */
export function pedeCruzarComAConta(pergunta: string): boolean {
  return /\b(compar|confront|cruz|bate|batem|confer|confira|valid|checa|chequ|verifi)|dados reais|n[úu]meros reais|da conta|na conta|ao vivo|plataforma/i.test(
    pergunta,
  );
}

async function clienteDoTurno(params: {
  clientId: string | null;
  clienteDoEscopo: string | null;
  organizationId: string | null;
}): Promise<{ id: string; name: string } | null> {
  if (params.clientId) {
    const [c] = await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.id, params.clientId))
      .limit(1);
    if (c) return c;
  }
  const nome = params.clienteDoEscopo?.trim();
  if (nome && params.organizationId) {
    const [c] = await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.organizationId, params.organizationId), ilike(schema.clients.name, nome), isNull(schema.clients.deletedAt)))
      .limit(1);
    if (c) return c;
  }
  return null;
}

/** Sem cliente no turno: quais clientes da empresa têm conta de anúncio vinculada. */
async function clientesComConta(organizationId: string | null): Promise<string[]> {
  if (!organizationId) return [];
  const doMeta = await db.select({ clientId: schema.clientMetaAccounts.clientId }).from(schema.clientMetaAccounts);
  const doGoogle = await db.select({ clientId: schema.clientGoogleAdsAccounts.clientId }).from(schema.clientGoogleAdsAccounts);
  const ids = [...new Set([...doMeta, ...doGoogle].map((r) => r.clientId))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ name: schema.clients.name })
    .from(schema.clients)
    .where(and(inArray(schema.clients.id, ids), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)))
    .orderBy(asc(schema.clients.name));
  return rows.map((r) => r.name);
}

/**
 * MODO DOCUMENTO (28/10/2026). Com anexo no turno, o Jarbas analisa o
 * material — ver jarbas-documentos.ts. Sem cliente selecionado ele analisa
 * mesmo assim (o documento diz de quem é); com cliente e pedido de
 * comparação, cruza com os números reais da conta.
 */
async function responderComDocumentos(params: {
  pergunta: string;
  documentos: DocumentoLido[];
  clientId: string | null;
  clienteDoEscopo: string | null;
  organizationId: string | null;
  logger: Logger;
  agora?: Date;
}): Promise<ExecuteResponse> {
  const { logger } = params;
  const cliente = await clienteDoTurno(params).catch(() => null);

  let dadosDaConta: string | null = null;
  if (cliente && pedeCruzarComAConta(params.pergunta)) {
    try {
      const permitido = params.organizationId
        ? (await mediaContextForAgent({ organizationId: params.organizationId, clientIds: null }, cliente.id)).allowed
        : true;
      if (permitido) {
        const periodo = periodoDaPergunta(params.pergunta, params.agora);
        const canais = await Promise.all([lerMeta(cliente.id, periodo, logger), lerGoogle(cliente.id, periodo, logger)]);
        dadosDaConta = dadosEmTexto(cliente.name, periodo, canais);
      }
    } catch (error) {
      logger.warn({ motivo: error instanceof Error ? error.message : String(error) }, '[jarbas-local] dados da conta indisponíveis para cruzar com o documento');
    }
  }

  const analise = await analisarDocumentos({
    pergunta: params.pergunta,
    documentos: params.documentos,
    cliente: cliente?.name ?? null,
    dadosDaConta,
    logger,
    completar: (prompt, opts) => completarTextoComSeguranca(prompt, logger, opts),
  });
  logger.info(
    { modo: analise.modo, lidos: analise.caracteresLidos, analisados: analise.caracteresAnalisados, cruzouComConta: Boolean(dadosDaConta) },
    '[jarbas-local] documento analisado',
  );
  return resposta(analise.texto, params.documentos.map((d) => d.filename));
}

export async function responderJarbasLocal(params: {
  pergunta: string;
  clientId: string | null;
  clienteDoEscopo: string | null;
  organizationId: string | null;
  logger: Logger;
  agora?: Date;
  /** Anexos do turno já lidos (modo estruturado). Com eles, o turno é de análise de documento. */
  documentos?: DocumentoLido[];
}): Promise<ExecuteResponse> {
  const { logger } = params;
  if (params.documentos?.length) return responderComDocumentos({ ...params, documentos: params.documentos });
  const cliente = await clienteDoTurno(params);

  if (!cliente) {
    const comConta = await clientesComConta(params.organizationId).catch(() => [] as string[]);
    if (comConta.length === 0) {
      return resposta(
        'Ainda não tenho nenhum cliente com conta de anúncio vinculada, então não há números de tráfego para ler. Quem cuida de tráfego conecta o Meta Ads ou o Google Ads em Integrações e vincula a conta de cada cliente na ficha dele. A partir daí eu respondo com os números reais.',
      );
    }
    return resposta(
      `De qual cliente? Tenho números para: ${comConta.join(', ')}. Escolha o cliente no topo do chat ou diga o nome na pergunta.`,
    );
  }

  const periodo = periodoDaPergunta(params.pergunta, params.agora);
  const canais = await Promise.all([lerMeta(cliente.id, periodo, logger), lerGoogle(cliente.id, periodo, logger)]);
  let dados = dadosEmTexto(cliente.name, periodo, canais);

  // MEDIA COMMAND CENTER: as MESMAS configurações e dados da tela de Mídia.
  // Se a análise por agente estiver desligada ali, o Jarbas respeita; se
  // estiver ligada, ele recebe também o que a sincronização guardou (contas,
  // criativos, alertas abertos). Falha aqui nunca derruba a resposta antiga.
  if (params.organizationId) {
    try {
      const ctx = await mediaContextForAgent({ organizationId: params.organizationId, clientIds: null }, cliente.id);
      if (!ctx.allowed) return resposta(`A análise de mídia por agentes está desligada para a ${cliente.name}. Quem administra liga em Mídia → Configurações → Agentes de IA.`);
      if (ctx.text) dados = `${dados}\n\n${ctx.text}`;
    } catch (error) {
      logger.warn({ clientId: cliente.id, motivo: error instanceof Error ? error.message : String(error) }, '[jarbas-local] contexto do Media Command Center indisponível');
    }
  }

  if (canais.every((c) => !c.conectado)) {
    const motivos = canais.map((c) => `${c.canal}: ${c.motivo}`).join('; ');
    return resposta(
      `Não tenho números de tráfego da ${cliente.name} agora. ${motivos}. Quando a conta estiver vinculada e conectada, eu respondo com os dados reais.`,
    );
  }

  const texto = await completeTextSafely(montarPromptDoJarbas(params.pergunta, dados), logger, { maxTokens: 1200 });
  if (!texto?.trim()) {
    // O GPT não respondeu: entrega os números crus em vez de nada. Eles são o
    // que importa, e nenhum deles foi escrito por modelo.
    return resposta(`Não consegui escrever a análise agora, mas estes são os números:\n\n${dados}`);
  }
  logger.info({ clientId: cliente.id, periodo: periodo.atual, conectados: canais.filter((c) => c.conectado).map((c) => c.canal) }, '[jarbas-local] respondido');
  return resposta(texto.trim());
}
