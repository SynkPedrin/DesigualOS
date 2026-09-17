import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createHash } from 'node:crypto';

/**
 * episodic-memory.ts — L1: o que ACONTECEU, e quando.
 *
 * A memória que existia respondia "o que é verdade sobre este cliente" (L2) e
 * "o que a operação registra" (L3). Nenhuma das duas responde "o que a gente
 * conversou ontem", porque nenhuma tem eixo de tempo nem noção de episódio.
 *
 * Duas decisões que definem este módulo:
 *
 * 1. CONVERSA NÃO É VERDADE. Nada vira episódio automaticamente por ter sido
 *    dito. O candidato é extraído por forma explícita, escopado, deduplicado e
 *    só então persistido. Guardar toda mensagem foi descartado: é assim que
 *    memória vira ruído e que papo de teste reaparece como decisão de cliente.
 *
 * 2. ESCOPO É PARTE DO FATO. Cliente, usuário e AMBIENTE viajam com o episódio.
 *    Episódio de QA não é recuperável em produção, e episódio do cliente A não
 *    aparece no turno do cliente B.
 */

export type TipoDeEpisodio =
  | 'decision'
  | 'feedback'
  | 'preference'
  | 'delivery'
  | 'operational_change'
  | 'question';

export interface CandidatoAEpisodio {
  eventType: TipoDeEpisodio;
  summary: string;
  facts?: string[];
  decisions?: string[];
  feedback?: string[];
  importance: number;
}

/**
 * Forma que denuncia cada tipo de episódio. Determinístico de propósito: o que
 * define se algo merece ser lembrado não pode depender do humor do modelo, ou a
 * memória fica diferente a cada execução do MESMO turno.
 */
const FORMAS: Array<{ tipo: TipoDeEpisodio; re: RegExp; peso: number }> = [
  // Decisão: alguém fechou uma questão.
  { tipo: 'decision', re: /\b(decidimos|decidi|ficou (definido|decidido|acertado)|vamos (seguir|com)|aprovad[oa]|fechado|optamos por|escolhemos)\b/i, peso: 0.9 },
  // Feedback: julgamento sobre entrega.
  { tipo: 'feedback', re: /\b(reprovad[oa]|refaz|refaça|não gostei|nao gostei|ficou (ruim|genérico|generico|fraco)|muito bom|gostei|ajusta|corrige|troca)\b/i, peso: 0.8 },
  // Preferência: regra durável declarada.
  { tipo: 'preference', re: /\b(prefir[ao]|sempre|nunca|daqui pra frente|de agora em diante|a partir de agora|padr[ãa]o|regra)\b/i, peso: 0.85 },
  // Mudança operacional: estado da operação mudou.
  { tipo: 'operational_change', re: /\b(mudou|alterad[oa]|adiad[oa]|antecipad[oa]|entrou|saiu|assumiu|passou a|virou)\b/i, peso: 0.7 },
];

/** Enunciado que denuncia intenção de registrar, reaproveitado do fluxo de fatos. */
const PEDIU_PRA_REGISTRAR = /\b(anot[ae]|registr[ae]|guard[ae]|grav[ae]|lembr[ae]|fica registrado|para constar)\b/i;

function limparFrase(f: string): string {
  return f.replace(/^\s*[-*•]?\s*(?:usu[áa]rio|assistente|agente|bento|otto)\s*:\s*/i, '').trim();
}

/**
 * Extrai candidatos a episódio de um turno. Devolve vazio na esmagadora
 * maioria dos turnos — e isso é o comportamento certo.
 */
export function extractEpisodeCandidates(mensagem: string): CandidatoAEpisodio[] {
  if (!mensagem || mensagem.trim().length === 0) return [];

  const frases = mensagem
    .split(/(?<!\b[A-ZÀ-Ý]\.)(?<=[.!?\n])\s+|\n+/)
    .map(limparFrase)
    .filter((f) => f.length >= 12);

  const saida: CandidatoAEpisodio[] = [];
  const vistos = new Set<string>();

  for (const frase of frases) {
    // Pergunta não é episódio: quem pergunta não está registrando nada.
    if (frase.trimEnd().endsWith('?')) continue;

    const forma = FORMAS.find((f) => f.re.test(frase));
    const pediu = PEDIU_PRA_REGISTRAR.test(frase);
    if (!forma && !pediu) continue;

    const tipo: TipoDeEpisodio = forma?.tipo ?? 'decision';
    const chave = `${tipo}|${frase.toLowerCase()}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    saida.push({
      eventType: tipo,
      summary: frase.slice(0, 400),
      ...(tipo === 'decision' ? { decisions: [frase.slice(0, 400)] } : {}),
      ...(tipo === 'feedback' ? { feedback: [frase.slice(0, 400)] } : {}),
      importance: forma?.peso ?? 0.75,
    });
  }
  return saida;
}

export interface EscopoDoEpisodio {
  clientId?: string | null;
  campaignId?: string | null;
  userId?: string | null;
  agent?: string | null;
  conversationId?: string | null;
  executionId?: string | null;
  sourceRefs?: string[];
  environment?: string;
}

/** Grava os candidatos. Idempotente: o mesmo acontecimento não vira dois episódios. */
export async function recordEpisodes(
  candidatos: CandidatoAEpisodio[],
  escopo: EscopoDoEpisodio,
): Promise<number> {
  let gravados = 0;
  for (const c of candidatos) {
    const dedupeKey = createHash('sha256')
      .update([escopo.clientId ?? '', escopo.userId ?? '', c.eventType, c.summary.toLowerCase().trim()].join('|'))
      .digest('hex');
    const r = await db
      .insert(schema.agentEpisodes)
      .values({
        occurredAt: new Date(),
        clientId: escopo.clientId ?? null,
        campaignId: escopo.campaignId ?? null,
        userId: escopo.userId ?? null,
        agent: escopo.agent ?? null,
        conversationId: escopo.conversationId ?? null,
        executionId: escopo.executionId ?? null,
        eventType: c.eventType,
        summary: c.summary,
        facts: c.facts ?? [],
        decisions: c.decisions ?? [],
        feedback: c.feedback ?? [],
        sourceRefs: escopo.sourceRefs ?? [],
        importance: c.importance.toFixed(3),
        environment: escopo.environment ?? 'production',
        dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: schema.agentEpisodes.id })
      .catch(() => []);
    if (r.length > 0) gravados += 1;
  }
  return gravados;
}

export interface EpisodioRecuperado {
  occurredAt: Date;
  eventType: string;
  summary: string;
  clientId: string | null;
  agent: string | null;
  sourceRefs: string[];
}

/**
 * Recupera episódios por JANELA DE TEMPO e escopo. É o que sustenta "o que
 * conversamos ontem": não devolve a conversa inteira, devolve o que aconteceu.
 */
export async function recallEpisodes(params: {
  userId?: string | null;
  clientId?: string | null;
  desde: Date;
  ate?: Date;
  limit?: number;
  environment?: string;
}): Promise<EpisodioRecuperado[]> {
  const condicoes = [
    gte(schema.agentEpisodes.occurredAt, params.desde),
    // Isolamento duro: produção nunca lê episódio de QA.
    eq(schema.agentEpisodes.environment, params.environment ?? 'production'),
  ];
  if (params.ate) condicoes.push(lte(schema.agentEpisodes.occurredAt, params.ate));
  if (params.userId) condicoes.push(eq(schema.agentEpisodes.userId, params.userId));
  // Cliente pedido: episódio daquele cliente OU sem cliente (contexto geral do
  // usuário). Nunca de OUTRO cliente — isso seria vazamento entre contas.
  if (params.clientId) {
    condicoes.push(
      or(eq(schema.agentEpisodes.clientId, params.clientId), isNull(schema.agentEpisodes.clientId))!,
    );
  }

  const rows = await db
    .select({
      occurredAt: schema.agentEpisodes.occurredAt,
      eventType: schema.agentEpisodes.eventType,
      summary: schema.agentEpisodes.summary,
      clientId: schema.agentEpisodes.clientId,
      agent: schema.agentEpisodes.agent,
      sourceRefs: schema.agentEpisodes.sourceRefs,
    })
    .from(schema.agentEpisodes)
    .where(and(...condicoes))
    // CAST EXPLÍCITO. `importance` é text (o driver devolve numeric como string);
    // o COALESCE com 0.5 numérico fazia o Postgres recusar a query inteira, e o
    // `.catch` abaixo engolia o erro — o recall devolvia lista vazia como se
    // não houvesse episódio, com o episódio gravado no banco. Silêncio de query
    // é pior que erro: parece ausência de dado.
    .orderBy(
      sql`COALESCE(NULLIF(${schema.agentEpisodes.importance}, '')::numeric, 0.5) DESC`,
      desc(schema.agentEpisodes.occurredAt),
    )
    .limit(params.limit ?? 12)
    .catch((erro: unknown) => {
      // Não engole em silêncio: sem este log o mesmo defeito volta invisível.
      console.error('[episodic-memory] recall falhou', erro);
      return [];
    });

  return rows.map((r) => ({ ...r, sourceRefs: r.sourceRefs ?? [] }));
}

/** Janela temporal pedida em linguagem natural. Null quando o turno não cita tempo. */
export function janelaDoTexto(mensagem: string, agora = new Date()): { desde: Date; ate?: Date; rotulo: string } | null {
  const t = mensagem
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const dia = 86_400_000;

  if (/\bontem\b/.test(t)) {
    const inicio = new Date(agora.getTime() - dia);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio.getTime() + dia);
    return { desde: inicio, ate: fim, rotulo: 'ontem' };
  }
  if (/\b(hoje|agora pouco|mais cedo)\b/.test(t)) {
    const inicio = new Date(agora);
    inicio.setHours(0, 0, 0, 0);
    return { desde: inicio, rotulo: 'hoje' };
  }
  if (/\b(essa|esta|nesta|na)\s+semana\b|\bultimos?\s+dias\b|\bdesde\s+ontem\b/.test(t)) {
    return { desde: new Date(agora.getTime() - 7 * dia), rotulo: 'os últimos 7 dias' };
  }
  if (/\b(conversamos|falamos|combinamos|discutimos|te (falei|disse|pedi))\b/.test(t)) {
    // Referência a conversa passada sem marcador explícito: uma semana é a
    // janela que cobre "o que a gente combinou" sem virar despejo de histórico.
    return { desde: new Date(agora.getTime() - 7 * dia), rotulo: 'os últimos dias' };
  }
  return null;
}

/** Bloco pro prompt. Vazio quando não há episódio — nunca inventa histórico. */
export function formatEpisodeBlock(episodios: EpisodioRecuperado[], rotulo: string): string {
  if (episodios.length === 0) {
    return [
      `MEMÓRIA DE ${rotulo.toUpperCase()}: nenhum episódio registrado nesta janela.`,
      'Diga isso com clareza. NÃO reconstrua de memória o que não está aqui.',
    ].join('\n');
  }
  const linhas = [`O QUE FICOU REGISTRADO EM ${rotulo.toUpperCase()} (memória episódica, com data):`];
  for (const e of episodios) {
    const quando = e.occurredAt.toISOString().slice(0, 16).replace('T', ' ');
    linhas.push(`- [${quando}] (${e.eventType}) ${e.summary}`);
  }
  linhas.push('', 'Use isto como o que REALMENTE aconteceu. Se algo não está aqui, não aconteceu no registro.');
  return linhas.join('\n');
}

/**
 * Tipos que carregam FATO EXPLÍCITO ensinado por gente. `question` fica de fora
 * (quem pergunta não registra) e `delivery` também: entrega é evento, não
 * afirmação sobre o mundo.
 */
const TIPOS_DE_FATO_EXPLICITO = ['decision', 'preference', 'operational_change', 'feedback'] as const;

/**
 * Palavras que não discriminam nada. Só função gramatical e verbo de pergunta —
 * a lista é curta de propósito: uma lista longa de "palavras genéricas" já
 * matou 287 campanhas reais neste repositório quando incluiu "dia".
 */
const PALAVRA_SEM_VALOR = new Set([
  'quem', 'qual', 'quais', 'quando', 'onde', 'como', 'porque', 'quanto', 'quantos', 'quantas',
  'para', 'pela', 'pelo', 'pelos', 'pelas', 'esse', 'essa', 'esses', 'essas', 'isso', 'aquilo',
  'este', 'esta', 'estes', 'estas', 'sobre', 'entre', 'ainda', 'depois', 'antes', 'agora',
  'nosso', 'nossa', 'seu', 'sua', 'meu', 'minha', 'dele', 'dela', 'mesmo', 'mesma',
  'tem', 'tinha', 'ter', 'foi', 'era', 'ser', 'está', 'esta', 'estao', 'estão', 'sao', 'são',
  'com', 'sem', 'que', 'dos', 'das', 'nos', 'nas', 'por', 'uma', 'uns', 'umas',
  // Sem conteúdo nenhum: como termo de busca casariam com qualquer episódio.
  // A lista para por aqui de propósito — palavra que descreve alguma coisa do
  // negócio fica de fora dela, mesmo parecendo comum.
  'tudo', 'nada', 'algo', 'coisa', 'favor', 'obrigado', 'obrigada',
]);

/**
 * Termos pelos quais vale procurar um episódio. Sem isto, recall factual viraria
 * "devolve os últimos episódios do cliente em todo turno" — que é despejo de
 * histórico, não memória.
 */
export function termosDeConsulta(mensagem: string): string[] {
  const t = mensagem
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const vistos = new Set<string>();
  const termos: string[] = [];
  for (const palavra of t.split(/\s+/)) {
    if (palavra.length < 4) continue;
    if (PALAVRA_SEM_VALOR.has(palavra)) continue;
    if (vistos.has(palavra)) continue;
    vistos.add(palavra);
    termos.push(palavra);
    if (termos.length >= 6) break;
  }
  return termos;
}

/**
 * RECALL FACTUAL — o que faltava.
 *
 * `recallEpisodes` acima responde "o que aconteceu na janela X". Isso sustenta
 * "o que conversamos ontem", mas NÃO sustenta a pergunta que a equipe faz de
 * verdade: "quem é o decisor da Colpar?". Essa pergunta não cita tempo, então a
 * janela era nula e a consulta nunca acontecia — o fato ensinado minutos antes
 * ficava no banco, inalcançável. Rastreado em 17/09/2026: a consulta ACHAVA o
 * episódio; era o portão temporal que não deixava consultar.
 *
 * Aqui a chave é ENTIDADE + ESCOPO, não tempo. O que limita o resultado é a
 * pergunta ter termos que casem com o episódio — turno que não pergunta nada
 * relacionado não traz episódio nenhum.
 *
 * Não filtra por usuário de propósito: o que a equipe ensina é memória da
 * AGÊNCIA, não caderno privado de quem digitou. Cliente e ambiente continuam
 * filtrando duro, que é onde vazamento de verdade doeria.
 */
export async function recallFactualEpisodes(params: {
  clientId?: string | null;
  termos: string[];
  environment?: string;
  limit?: number;
}): Promise<EpisodioRecuperado[]> {
  if (params.termos.length === 0) return [];

  const condicoes = [
    eq(schema.agentEpisodes.environment, params.environment ?? 'production'),
    sql`${schema.agentEpisodes.eventType} in ${TIPOS_DE_FATO_EXPLICITO}`,
  ];
  if (params.clientId) {
    condicoes.push(
      or(eq(schema.agentEpisodes.clientId, params.clientId), isNull(schema.agentEpisodes.clientId))!,
    );
  }
  const casaAlgumTermo = or(
    ...params.termos.map((termo) => sql`${schema.agentEpisodes.summary} ilike ${'%' + termo + '%'}`),
  );
  if (casaAlgumTermo) condicoes.push(casaAlgumTermo);

  const rows = await db
    .select({
      occurredAt: schema.agentEpisodes.occurredAt,
      eventType: schema.agentEpisodes.eventType,
      summary: schema.agentEpisodes.summary,
      clientId: schema.agentEpisodes.clientId,
      agent: schema.agentEpisodes.agent,
      sourceRefs: schema.agentEpisodes.sourceRefs,
    })
    .from(schema.agentEpisodes)
    .where(and(...condicoes))
    // MAIS RECENTE PRIMEIRO, e não por importância: aqui a pergunta é "o que
    // vale HOJE". Quando dois registros falam da mesma coisa, o novo substitui
    // o velho — ordenar por importância deixaria o fato aposentado na frente.
    .orderBy(desc(schema.agentEpisodes.occurredAt))
    .limit(params.limit ?? 6)
    .catch((erro: unknown) => {
      console.error('[episodic-memory] recall factual falhou', erro);
      return [];
    });

  return rows.map((r) => ({ ...r, sourceRefs: r.sourceRefs ?? [] }));
}

/**
 * Bloco do que foi ENSINADO. Separado do bloco temporal porque responde outra
 * pergunta, e rotulado como conversa porque a proveniência importa: dizer
 * "ClickUp" para algo que a pessoa falou no chat é atribuição falsa.
 */
/** Palavras de conteúdo do resumo, para decidir se dois registros falam da MESMA coisa. */
function nucleoDoResumo(resumo: string): Set<string> {
  return new Set(termosDeConsulta(resumo));
}

/**
 * Dois episódios tratam do mesmo assunto? Exige DUAS palavras de conteúdo em
 * comum, não uma: com uma só, "o decisor é X" e "a praça é Y" se tocariam por
 * acaso e um fato válido seria marcado como substituído.
 */
function falamDoMesmo(a: Set<string>, b: Set<string>): boolean {
  let comuns = 0;
  for (const t of a) {
    // Por RADICAL, não por igualdade: "decisor" e "decisora" são a mesma coisa
    // pra quem pergunta, e comparar string exata fazia a correção do decisor
    // passar como fato novo em vez de substituir o anterior.
    for (const u of b) {
      const menor = t.length <= u.length ? t : u;
      const maior = t.length <= u.length ? u : t;
      if (menor.length >= 5 && maior.startsWith(menor)) {
        comuns += 1;
        break;
      }
    }
  }
  return comuns >= 2;
}

export function formatFactualEpisodeBlock(episodios: EpisodioRecuperado[]): string {
  if (episodios.length === 0) return '';

  /**
   * RÓTULO EXPLÍCITO, não ordem.
   *
   * A primeira versão deste bloco entregava a lista do mais novo pro mais velho
   * e mandava o modelo concluir que o primeiro valia. Na simulação de uso real
   * de 17/09/2026 ele leu os dois registros do decisor da Colpar e devolveu
   * "o decisor é Marcelo Ribeiro (informado por Fernanda Alves)" — misturou o
   * fato aposentado com a pessoa do fato novo. Não é erro de leitura: é o que
   * acontece quando a decisão de qual fato vale fica com quem está gerando
   * texto. Agora a decisão é tomada aqui e viaja escrita.
   */
  const vistos: Array<{ nucleo: Set<string>; texto: string }> = [];
  const linhas = [
    'REGISTRO APRENDIDO NA CONVERSA (informado por quem trabalha aqui, com data):',
  ];
  for (const e of episodios) {
    const quando = e.occurredAt.toISOString().slice(0, 16).replace('T', ' ');
    const nucleo = nucleoDoResumo(e.summary);
    const anterior = vistos.find((v) => falamDoMesmo(v.nucleo, nucleo));
    const rotulo = anterior ? 'SUBSTITUÍDO' : 'ATUAL';
    linhas.push(`- ${rotulo} [${quando}] (${e.eventType}) ${e.summary}`);
    vistos.push({ nucleo, texto: e.summary });
  }
  linhas.push('');
  linhas.push(
    'Isto foi dito por alguém da equipe, não lido do ClickUp: ao citar, diga que foi informado na conversa, com a data.',
  );
  linhas.push(
    'Use APENAS o que está marcado ATUAL como verdade de hoje. O que está SUBSTITUÍDO já foi corrigido: não repita o nome, o número ou a decisão dele como se ainda valesse, nem misture os dois no mesmo enunciado.',
  );
  linhas.push(
    'Corrige ficha curada: onde isto contradisser o dossiê ou o brain, isto vale, porque é mais novo e veio de quem decide.',
  );
  return linhas.join('\n');
}
