/**
 * bento-campanha.ts — de uma campanha para as frentes de trabalho da agência.
 *
 * Pedido da operação (28/09/2026): "a partir da campanha, criar uma segmentação
 * de responsabilidades e lançar as tasks pra cada colaborador, cada um com seu
 * briefing individual — o briefing de redator vai pro Sain, o de designer pro
 * Gui, o de edição pro Celso; ou perguntar, se tiver mais de um por função".
 *
 * Duas decisões sustentam este módulo, e elas são opostas de propósito:
 *
 * 1. O QUE a campanha exige é JULGAMENTO, e vai pro modelo. Nenhuma tabela de
 *    regex decide que uma campanha de lançamento precisa de roteiro antes de
 *    vídeo. O modelo decompõe; este arquivo valida a forma, nunca o mérito.
 *
 * 2. QUEM faz cada frente é FATO, e nunca é inferido. Este repositório já
 *    pagou por inferir relação de pessoa: o incidente da Esther (16/09/2026,
 *    ver person-context.ts) foi promover "aparece em task deste cliente" a
 *    "responde pela conta". Volume de trabalho não é cargo. Então função só
 *    vira responsável quando a pessoa foi NOMEADA no pedido ou existe um
 *    registro declarado; fora disso o Bento PERGUNTA — que é exatamente o que
 *    a operação pediu, e o único desfecho honesto quando a fonte é omissa.
 *
 * O resultado é um plano que ou está completo, ou está completo com perguntas
 * — nunca um plano que adivinhou dono e criou task no nome errado.
 */

/** Funções da agência, com o vocabulário de entregável que cada uma cobre. */
export const FUNCOES = [
  { id: 'redacao', rotulo: 'Redação', termos: /\b(copy|texto|redac|legenda|headline|roteiro|script)/i },
  { id: 'design', rotulo: 'Design', termos: /\b(design|layout|arte|pe[çc]a|placa|card|carross|banner|key ?visual|kv)/i },
  { id: 'video', rotulo: 'Edição de vídeo', termos: /\b(v[ií]deo|edi[çc]|montagem|reels?|motion|anima)/i },
  { id: 'trafego', rotulo: 'Tráfego', termos: /\b(tr[áa]fego|m[ií]dia paga|an[úu]ncio|ads|campanha paga|impulsion)/i },
  { id: 'atendimento', rotulo: 'Atendimento', termos: /\b(atendimento|alinhamento|aprova[çc][aã]o do cliente|reuni[aã]o)/i },
  { id: 'social', rotulo: 'Social', termos: /\b(social|feed|stories|publica[çc]|agendamento|calend[áa]rio editorial)/i },
] as const;

export type FuncaoId = (typeof FUNCOES)[number]['id'];

export function rotuloDaFuncao(id: string): string {
  return FUNCOES.find((f) => f.id === id)?.rotulo ?? id;
}

/** Função mais provável para um entregável escrito em português. Null quando nenhuma casa. */
export function funcaoDoTexto(texto: string): FuncaoId | null {
  for (const f of FUNCOES) if (f.termos.test(texto)) return f.id;
  return null;
}

/** Uma frente de trabalho da campanha: o que é, de que função, e o briefing dela. */
export interface FrenteDeTrabalho {
  funcao: FuncaoId;
  /** Título da task, já no formato que a operação lê numa lista. */
  titulo: string;
  /** Briefing INDIVIDUAL — o que essa função precisa saber pra executar. */
  briefing: string;
  /** Nome falado do responsável, quando o próprio pedido nomeou. */
  responsavelNomeado: string | null;
}

/* ------------------------------------------------------------------ */
/* Decomposição — o modelo propõe, este arquivo valida a FORMA          */
/* ------------------------------------------------------------------ */

const CONTRATO = `Você segmenta uma campanha de marketing nas frentes de trabalho de uma agência.

Responda SOMENTE com um JSON:
{ "frentes": [ { "funcao": "<id>", "titulo": "<título da task>", "briefing": "<briefing individual>", "responsavel": "<nome citado no pedido, ou null>" } ] }

Os ids de função válidos são EXATAMENTE estes: ${FUNCOES.map((f) => `${f.id} (${f.rotulo})`).join(', ')}.

Regras:
- Uma frente por ENTREGÁVEL REAL da campanha. Não invente frente que o pedido não sustenta: campanha sem vídeo não gera frente de vídeo.
- O título diz o trabalho e o cliente, não a campanha inteira. Ex.: "Copy dos 5 posts — Colormaq", não "Campanha de outubro".
- O briefing é INDIVIDUAL e AUTOSSUFICIENTE: quem abrir aquela task tem que conseguir executar sem ler as outras. Repita o contexto necessário em cada um.
- O briefing carrega o que a FUNÇÃO precisa. Redação precisa de tom, mensagem e CTA; design precisa de formato, peça e direção visual; vídeo precisa de duração, formato e trilha.
- "responsavel" SÓ quando o pedido nomear a pessoa para aquela frente. Nunca deduza por cargo, histórico ou probabilidade — null é a resposta certa quando o pedido não diz.
- O que o pedido não informa entra no briefing como pendência declarada ("[CONFIRMAR: ...]"), nunca preenchido por suposição.`;

interface FrenteCrua {
  funcao?: unknown;
  titulo?: unknown;
  briefing?: unknown;
  responsavel?: unknown;
}

/** Extrai o JSON de uma resposta que pode vir cercada de texto ou de cerca de código. */
function extrairJson(bruto: string): unknown {
  const semCerca = bruto.replace(/```(?:json)?/gi, '').trim();
  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

const TITULO_MAX = 120;

/**
 * Valida a FORMA do que o modelo propôs. Frente sem título ou sem briefing é
 * descartada em silêncio — meia frente vira task vazia no ClickUp, e task
 * vazia é pior que frente faltando, porque alguém a considera feita.
 */
export function validarFrentes(bruto: unknown): FrenteDeTrabalho[] {
  const lista = (bruto as { frentes?: unknown } | null)?.frentes;
  if (!Array.isArray(lista)) return [];
  const idsValidos = new Set<string>(FUNCOES.map((f) => f.id));
  const vistas = new Set<string>();
  const out: FrenteDeTrabalho[] = [];
  for (const item of lista as FrenteCrua[]) {
    const titulo = typeof item.titulo === 'string' ? item.titulo.trim() : '';
    const briefing = typeof item.briefing === 'string' ? item.briefing.trim() : '';
    if (!titulo || briefing.length < 20) continue;

    // Função fora da lista não é erro fatal: o entregável do título costuma
    // dizer a mesma coisa. Não dando pra saber, a frente cai — melhor uma
    // frente a menos que uma task com dono decidido no chute.
    const idProposto = typeof item.funcao === 'string' ? item.funcao.trim().toLowerCase() : '';
    const funcao = (idsValidos.has(idProposto) ? idProposto : funcaoDoTexto(`${titulo} ${briefing}`)) as FuncaoId | null;
    if (!funcao) continue;

    const chave = `${funcao}|${titulo.toLowerCase()}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);

    const responsavel = typeof item.responsavel === 'string' && item.responsavel.trim() ? item.responsavel.trim() : null;
    out.push({ funcao, titulo: titulo.slice(0, TITULO_MAX), briefing, responsavelNomeado: responsavel });
  }
  return out;
}

export interface DecomporParams {
  /** O pedido da pessoa, inteiro. */
  mensagem: string;
  /** Contexto já recuperado do cliente (dossiê/brain) — entra como fonte, não como enfeite. */
  contextoDoCliente?: string | null;
  clientName?: string | null;
  /** Mesmo escritor sem ferramenta usado pelo briefing (completeTextSafely). */
  escritor: (prompt: string) => Promise<string | null>;
}

export async function decomporCampanha(params: DecomporParams): Promise<FrenteDeTrabalho[]> {
  const prompt = [
    CONTRATO,
    '',
    `Cliente: ${params.clientName ?? '[CONFIRMAR: cliente]'}`,
    params.contextoDoCliente?.trim() ? `Contexto conhecido do cliente:\n${params.contextoDoCliente.trim()}` : null,
    '',
    'Pedido:',
    params.mensagem,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const resposta = await params.escritor(prompt).catch(() => null);
  if (!resposta) return [];
  return validarFrentes(extrairJson(resposta));
}

/* ------------------------------------------------------------------ */
/* Responsáveis — nomeado, declarado, ou PERGUNTA                       */
/* ------------------------------------------------------------------ */

export interface MembroConhecido {
  nome: string;
  /** Funções que a FONTE declara pra essa pessoa. Vazio = não se sabe. */
  funcoes: FuncaoId[];
}

export interface FrenteComDono extends FrenteDeTrabalho {
  responsavel: string;
  /** De onde veio o dono — entra no log, e na resposta quando ajuda. */
  origem: 'nomeado_no_pedido' | 'registro_declarado';
}

export interface PerguntaDeFuncao {
  funcao: FuncaoId;
  /** Títulos das frentes que dependem desta resposta. */
  titulos: string[];
  /** Candidatos declarados pra essa função. Vazio = ninguém declarado. */
  candidatos: string[];
}

export interface ResolucaoDeResponsaveis {
  prontas: FrenteComDono[];
  perguntas: PerguntaDeFuncao[];
}

/**
 * Casa cada frente com uma pessoa. Nunca escolhe entre candidatos: um único
 * candidato declarado resolve; dois ou mais viram pergunta, e nenhum também.
 */
export function resolverResponsaveis(frentes: FrenteDeTrabalho[], membros: MembroConhecido[]): ResolucaoDeResponsaveis {
  const prontas: FrenteComDono[] = [];
  const pendentesPorFuncao = new Map<FuncaoId, PerguntaDeFuncao>();

  for (const frente of frentes) {
    if (frente.responsavelNomeado) {
      prontas.push({ ...frente, responsavel: frente.responsavelNomeado, origem: 'nomeado_no_pedido' });
      continue;
    }
    const candidatos = membros.filter((m) => m.funcoes.includes(frente.funcao)).map((m) => m.nome);
    if (candidatos.length === 1) {
      prontas.push({ ...frente, responsavel: candidatos[0]!, origem: 'registro_declarado' });
      continue;
    }
    const existente = pendentesPorFuncao.get(frente.funcao);
    if (existente) existente.titulos.push(frente.titulo);
    else pendentesPorFuncao.set(frente.funcao, { funcao: frente.funcao, titulos: [frente.titulo], candidatos });
  }

  return { prontas, perguntas: [...pendentesPorFuncao.values()] };
}

/**
 * A pergunta sai UMA VEZ, com tudo junto. Perguntar função por função, em
 * turnos separados, transforma um pedido de campanha numa entrevista — e é
 * assim que a pessoa desiste e volta a lançar task na mão.
 */
export function montarPergunta(resolucao: ResolucaoDeResponsaveis): string | null {
  if (resolucao.perguntas.length === 0) return null;
  const linhas: string[] = [];
  linhas.push(
    resolucao.prontas.length > 0
      ? `Separei a campanha em ${resolucao.prontas.length + resolucao.perguntas.reduce((n, p) => n + p.titulos.length, 0)} frentes. Antes de lançar, preciso saber de quem é:`
      : 'Separei a campanha em frentes. Antes de lançar, preciso saber de quem é cada uma:',
  );
  linhas.push('');
  for (const p of resolucao.perguntas) {
    const trabalho = p.titulos.length === 1 ? p.titulos[0]! : `${p.titulos.length} tasks (${p.titulos.join('; ')})`;
    linhas.push(
      p.candidatos.length > 1
        ? `- **${rotuloDaFuncao(p.funcao)}** — ${trabalho}. Quem: ${p.candidatos.join(', ')}?`
        : `- **${rotuloDaFuncao(p.funcao)}** — ${trabalho}. Quem fica com isso?`,
    );
  }
  if (resolucao.prontas.length > 0) {
    linhas.push('');
    linhas.push('Já com dono definido:');
    for (const f of resolucao.prontas) linhas.push(`- ${rotuloDaFuncao(f.funcao)} — ${f.titulo} → ${f.responsavel}`);
  }
  linhas.push('');
  linhas.push('Me responde e eu lanço todas de uma vez, cada uma com o briefing dela.');
  return linhas.join('\n');
}
