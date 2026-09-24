/**
 * jarbas-date-guard.ts — SOURCE_RANGE_MISMATCH, aplicado na borda.
 *
 * Achado real (22/09/2026): a análise de tráfego pago do Jarbas é externa
 * (`callAgentesDesigual` -> JARBAS_ASK_URL, nenhum código de Meta Ads ou de
 * parsing de data vive neste repositório). Pedido:
 *
 *   "Jarbas, qual cliente apresentou melhor resultado entre 19 e 21 de
 *   setembro de 2026?"
 *
 * Resposta real observada:
 *
 *   "CARTEIRA, 2026-09-01 a 2026-09-30, fonte: Meta Ads
 *   ... Elite: R$ 3,15 por resultado ..."
 *
 * O serviço externo IGNOROU o range pedido (19-21) e consultou o MÊS INTEIRO
 * (01-30), sem qualquer aviso, e ainda assim produziu um ranking confiante.
 * É exatamente o `SOURCE_RANGE_MISMATCH` que a missão exige bloquear (seção
 * 2), só que o código que decide isso mora fora deste repositório — não dá
 * pra corrigir a causa raiz aqui.
 *
 * O que dá pra fazer, e é o que este módulo faz: o próprio serviço externo
 * já DECLARA o range que consultou (o cabeçalho "CARTEIRA/CLIENTE, <de> a
 * <até>, fonte: ..."), e o usuário declara o range que pediu, em português,
 * na própria mensagem. Comparando os dois NA BORDA — sem precisar entender
 * a análise em si — dá pra bloquear a resposta antes dela chegar no usuário
 * sempre que os dois não batem, com fail-open (deixa passar) quando não dá
 * pra extrair um dos dois com segurança: bloquear sem certeza inventaria um
 * segundo tipo de erro.
 */

export interface ParsedDateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

function pad2(n: string | number): string {
  return String(n).padStart(2, '0');
}

/**
 * Range EXPLÍCITO pedido pelo usuário, em português, com dia+mês+ano por
 * extenso ou numérico — deliberadamente estreito: só reconhece o que é
 * inequívoco (data completa dos dois lados). "essa semana", "ontem" etc NÃO
 * são reconhecidos aqui — não têm um valor único e canônico pra comparar
 * sem reimplementar o próprio resolvedor de datas relativas.
 */
export function extractRequestedRange(message: string): ParsedDateRange | null {
  // "entre 19 e 21 de setembro de 2026" / "do dia 19 ao dia 21 de setembro de 2026" / "de 19 a 21 de setembro de 2026"
  const porExtenso = message.match(
    /\b(?:entre|de|do dia)\s+(\d{1,2})\s+(?:e|a|ao dia|até)\s+(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/i,
  );
  if (porExtenso) {
    const [, d1, d2, mesNome, ano] = porExtenso;
    const mes = MESES[mesNome!.toLowerCase()];
    if (mes) return { start: `${ano}-${mes}-${pad2(d1!)}`, end: `${ano}-${mes}-${pad2(d2!)}` };
  }
  // "19/09/2026 a 21/09/2026" ou "19/09 a 21/09/2026"
  const numerico = message.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(?:a|até|ao)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numerico) {
    const [, d1, m1, y1, d2, m2, y2] = numerico;
    const ano1 = y1 ?? y2!;
    return { start: `${ano1}-${pad2(m1!)}-${pad2(d1!)}`, end: `${y2}-${pad2(m2!)}-${pad2(d2!)}` };
  }
  return null;
}

/**
 * Range CONSULTADO, declarado pelo próprio Jarbas no início da resposta:
 * "CARTEIRA, 2026-09-01 a 2026-09-30, fonte: Meta Ads" ou
 * "Cliente Teste 7, 2026-09-19 a 2026-09-21, fonte: Meta Ads".
 */
export function extractQueriedRange(answer: string): ParsedDateRange | null {
  const m = answer.match(/(\d{4})-(\d{2})-(\d{2})\s*a\s*(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y1, m1, d1, y2, m2, d2] = m;
  return { start: `${y1}-${m1}-${d1}`, end: `${y2}-${m2}-${d2}` };
}

export interface RangeGuardResult {
  ok: boolean;
  requested: ParsedDateRange | null;
  queried: ParsedDateRange | null;
}

/**
 * Compara os dois ranges. `ok: false` SÓ quando os dois foram extraídos com
 * segurança e DIVERGEM — nunca por causa de um range relativo ("essa
 * semana") que este parser não sabe ler.
 */
export function checkDateRangeMatch(message: string, answer: string): RangeGuardResult {
  const requested = extractRequestedRange(message);
  const queried = extractQueriedRange(answer);
  if (!requested || !queried) return { ok: true, requested, queried };
  const ok = requested.start === queried.start && requested.end === queried.end;
  return { ok, requested, queried };
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * NUNCA promete ação futura (seção 15 da missão: "se a consulta pode ser
 * feita, faça agora"; se não pode, explica a falha ATUAL). Este guard só
 * detecta a divergência depois que a chamada já voltou — não tem como
 * reconsultar sozinho dentro desta função — então a resposta correta é
 * honestidade sobre o que aconteceu AGORA, nunca uma promessa de retorno.
 */
export function sourceRangeMismatchMessage(result: RangeGuardResult): string {
  const req = result.requested!;
  const qry = result.queried!;
  return [
    `Você pediu o período de ${formatBR(req.start)} a ${formatBR(req.end)}, mas a fonte consultada trouxe dados de ${formatBR(qry.start)} a ${formatBR(qry.end)} — um período diferente do pedido.`,
    '',
    `Não vou apresentar esse resultado como se fosse do período de ${formatBR(req.start)} a ${formatBR(req.end)}: seria um dado de outro intervalo (SOURCE_RANGE_MISMATCH). Pergunte de novo especificando o período — às vezes reformular ajuda a fonte a entender o recorte certo.`,
  ].join('\n');
}

/**
 * Follow-up COMPARATIVO sem período próprio: "e comparado com o anterior?",
 * "e mês passado?", "compara com o anterior".
 *
 * Medido no front publicado em 23/09/2026: depois de "como tá a 3Net esse
 * mês?" (2026-09-01 a 2026-09-23), a pergunta "e comparado com o anterior?"
 * voltou com os MESMOS números, declarando "mes corrente ate hoje (nenhum
 * periodo citado na pergunta)" — e mesmo assim o texto afirmava "as
 * frequências estão mais altas agora" e "Streamings tá indo melhor do que
 * antes". Comparação narrada sobre um único dataset. Perguntado se era fato
 * ou hipótese, respondeu "Fato."
 *
 * O serviço do Jarbas é externo (JARBAS_ASK_URL) e não lê o histórico da
 * conversa: a pergunta elíptica chega sem período nenhum. O que dá pra
 * corrigir aqui é tornar o pedido EXPLÍCITO antes de mandar, e barrar o
 * resultado se mesmo assim só um período voltar.
 */
const COMPARATIVO_ELIPTICO =
  /\b(compar(?:a|ado|ando|e)|versus|\bvs\b|m[êe]s passado|per[ií]odo anterior|o anterior|antes)\b/i;

export function ehComparacaoComPeriodoAnterior(message: string): boolean {
  const t = message.trim();
  if (t.length > 120) return false;
  if (!COMPARATIVO_ELIPTICO.test(t)) return false;
  // Se a pessoa já citou as duas datas, não é elíptico: o guard normal cobre.
  return extractRequestedRange(t) === null;
}

/**
 * Período imediatamente anterior, de mesmo tamanho e ancorado no mês quando o
 * range cobre um mês. "01..23 de setembro" vira "01..31 de agosto" — mês
 * fechado, que é o que a pessoa quer dizer com "o anterior", e não uma janela
 * deslizante de 23 dias que não casa com nenhum relatório.
 */
export function periodoAnterior(range: ParsedDateRange): ParsedDateRange {
  const [y, m] = range.start.split('-').map(Number) as [number, number, number];
  const comecaNoDia1 = range.start.endsWith('-01');
  if (comecaNoDia1) {
    const anoAnt = m === 1 ? y - 1 : y;
    const mesAnt = m === 1 ? 12 : m - 1;
    const ultimoDia = new Date(Date.UTC(anoAnt, mesAnt, 0)).getUTCDate();
    return { start: `${anoAnt}-${pad2(mesAnt)}-01`, end: `${anoAnt}-${pad2(mesAnt)}-${pad2(ultimoDia)}` };
  }
  const inicio = new Date(`${range.start}T00:00:00Z`);
  const fim = new Date(`${range.end}T00:00:00Z`);
  const dias = Math.round((fim.getTime() - inicio.getTime()) / 86_400_000) + 1;
  const novoFim = new Date(inicio.getTime() - 86_400_000);
  const novoInicio = new Date(novoFim.getTime() - (dias - 1) * 86_400_000);
  return { start: novoInicio.toISOString().slice(0, 10), end: novoFim.toISOString().slice(0, 10) };
}

/** Pedido explícito, para o serviço externo não ter o que adivinhar. */
export function mensagemDeComparacao(atual: ParsedDateRange, anterior: ParsedDateRange, original: string): string {
  return [
    original,
    '',
    `Compare DOIS períodos e use os dois conjuntos de dados reais:`,
    `- período atual: ${atual.start} a ${atual.end}`,
    `- período anterior: ${anterior.start} a ${anterior.end}`,
    'Consulte os dois no Meta Ads antes de afirmar qualquer variação.',
    'Se não conseguir os dados do período anterior, diga isso e NÃO compare.',
  ].join('\n');
}

/**
 * Barra a comparação que não aconteceu. Fail-closed de propósito, ao
 * contrário do checkDateRangeMatch: aqui a pergunta É comparativa, então uma
 * resposta que declara um período só não pode passar afirmando variação.
 */
export function comparacaoNaoRealizada(answer: string, anterior: ParsedDateRange): boolean {
  const mencionaAnterior =
    answer.includes(anterior.start) ||
    answer.includes(anterior.end) ||
    answer.includes(`${anterior.start} a ${anterior.end}`);
  return !mencionaAnterior;
}

export function comparacaoIndisponivelMessage(atual: ParsedDateRange, anterior: ParsedDateRange): string {
  return [
    `Não consegui os dados do período anterior (${formatBR(anterior.start)} a ${formatBR(anterior.end)}) nesta consulta,`,
    `então não vou comparar: o que eu tenho aqui é só ${formatBR(atual.start)} a ${formatBR(atual.end)}.`,
    'Afirmar variação com um período só seria invenção. Pede de novo em instantes ou me diz as duas datas que eu busco.',
  ].join(' ');
}

/**
 * Métricas do bloco que o próprio Jarbas imprime. O bloco é gerado por CÓDIGO
 * no serviço (blocoDeNumerosReais), não pelo modelo — por isso o formato é
 * estável o bastante para ser lido de volta, e por isso o delta calculado aqui
 * é aritmética sobre número real, não interpretação.
 */
export interface MetricasDoPeriodo {
  investimento?: number;
  impressoes?: number;
  alcance?: number;
  cliques?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  frequencia?: number;
  leads?: number;
  conversas?: number;
}

function numeroBR(bruto: string | undefined): number | undefined {
  if (!bruto) return undefined;
  const limpo = bruto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : undefined;
}

const CAMPOS: Array<[keyof MetricasDoPeriodo, RegExp]> = [
  ['investimento', /Investimento:\s*R\$\s*([\d.,]+)/i],
  ['impressoes', /Impress[õo]es:\s*([\d.,]+)/i],
  ['alcance', /Alcance:\s*([\d.,]+)/i],
  ['cliques', /Cliques:\s*([\d.,]+)/i],
  ['ctr', /CTR:\s*([\d.,]+)\s*%/i],
  ['cpc', /CPC:\s*R\$\s*([\d.,]+)/i],
  ['cpm', /CPM:\s*R\$\s*([\d.,]+)/i],
  ['frequencia', /Frequ[êe]ncia:\s*([\d.,]+)/i],
  ['leads', /Leads:\s*([\d.,]+)/i],
  ['conversas', /Conversas no WhatsApp:\s*([\d.,]+)/i],
];

export function extrairMetricas(answer: string): MetricasDoPeriodo {
  const out: MetricasDoPeriodo = {};
  for (const [campo, re] of CAMPOS) {
    const v = numeroBR(re.exec(answer)?.[1]);
    if (v !== undefined) out[campo] = v;
  }
  return out;
}

const ROTULO: Record<keyof MetricasDoPeriodo, string> = {
  investimento: 'Investimento',
  impressoes: 'Impressões',
  alcance: 'Alcance',
  cliques: 'Cliques',
  ctr: 'CTR',
  cpc: 'CPC',
  cpm: 'CPM',
  frequencia: 'Frequência',
  leads: 'Leads',
  conversas: 'Conversas no WhatsApp',
};

function variacao(antes: number, agora: number): string {
  if (antes === 0) return agora === 0 ? 'estável' : 'sem base no período anterior';
  const pct = ((agora - antes) / Math.abs(antes)) * 100;
  const sinal = pct > 0 ? '+' : '';
  return `${sinal}${pct.toFixed(1)}%`;
}

/**
 * Delta A vs B. Só entra métrica presente nos DOIS períodos: comparar contra
 * ausência é a porta por onde entra número inventado.
 */
export function compararPeriodos(
  atual: MetricasDoPeriodo,
  anterior: MetricasDoPeriodo,
  rangeAtual: ParsedDateRange,
  rangeAnterior: ParsedDateRange,
): string {
  const linhas: string[] = [
    `Comparação — ${rangeAtual.start} a ${rangeAtual.end} contra ${rangeAnterior.start} a ${rangeAnterior.end}:`,
  ];
  let comparadas = 0;
  for (const campo of Object.keys(ROTULO) as Array<keyof MetricasDoPeriodo>) {
    const a = atual[campo];
    const b = anterior[campo];
    if (a === undefined || b === undefined) continue;
    comparadas += 1;
    linhas.push(`- ${ROTULO[campo]}: ${b} -> ${a} (${variacao(b, a)})`);
  }
  if (comparadas === 0) {
    return `Não consegui alinhar nenhuma métrica entre ${rangeAnterior.start} a ${rangeAnterior.end} e ${rangeAtual.start} a ${rangeAtual.end}, então não vou comparar.`;
  }
  return linhas.join('\n');
}
