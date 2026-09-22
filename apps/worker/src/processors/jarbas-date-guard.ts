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
