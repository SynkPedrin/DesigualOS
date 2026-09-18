import { stripOrchestratorContext } from './depth';

/**
 * referential.ts — "o segundo" é o que EU acabei de escrever.
 *
 * O defeito, medido pelo frontend publicado (18/09/2026): o Otto entregou três
 * títulos e, no turno seguinte, respondeu a "me explica o segundo" com "as
 * fontes recuperadas são fragmentadas" e passou a descrever o tom de voz da
 * APAE — material de outro cliente.
 *
 * Duas causas, ambas neste caminho:
 *
 * 1. A QUERY DO VAULT ERA A MENSAGEM INTEIRA. O worker cola o pacote de
 *    contexto depois do CONTEXT_BLOCK_MARKER, então a busca lexical recebia
 *    dossiê, conversa recente e preferências junto — centenas de palavras que
 *    não são o pedido. Com "me explica o segundo" (três palavras úteis) quem
 *    decidia o resultado era o ruído. A detecção de intenção e a classificação
 *    de profundidade já cortavam esse bloco; o retrieval ficou pra trás — o
 *    mesmo tipo de esquecimento que o comentário de `stripOrchestratorContext`
 *    já avisava que ia acontecer.
 *
 * 2. NÃO HAVIA PORTA. O vault rodava em todo turno. Para um follow-up cujo
 *    referente está na conversa, buscar conhecimento externo não só é
 *    desnecessário como compete com a resposta certa: RAG preenche lacuna de
 *    conhecimento, não decide o que "o segundo" significa.
 *
 * O que este módulo NÃO faz: desligar o vault. Pedido novo continua precisando
 * de marca, dado e pesquisa. A porta fecha só quando o referente resolve
 * localmente E o turno não pede fato adicional.
 */

/** Como o turno se relaciona com o que já foi dito. */
export type ClasseDeTurno =
  /** Aponta para algo do diálogo recente: "o segundo", "essa versão". */
  | 'REFERENCIAL'
  /** Continua o trabalho sobre o artefato atual: "faz menor", "menos IA". */
  | 'CONTINUACAO_CRIATIVA'
  /** Pede fato/dado que o diálogo não tem: prazo, métrica, histórico. */
  | 'BUSCA_FACTUAL'
  /** Pedido novo: precisa de marca, conhecimento e pesquisa. */
  | 'PEDIDO_NOVO';

export interface TurnoClassificado {
  classe: ClasseDeTurno;
  /** O vault deve rodar neste turno? */
  precisaVault: boolean;
  /** Ordinal citado (1-based), quando houver: "o segundo" -> 2. */
  ordinal: number | null;
  motivo: string;
}

function dobra(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * "primeiro/segundo/terceiro" e "1º/2ª/nº 3".
 *
 * DÍGITO SOLTO NÃO É ORDINAL, e essa distinção custou um bug: com `\b3\b` na
 * lista, "me dá 3 títulos" era lido como referência ao item 3 e o vault era
 * fechado num pedido NOVO — o oposto exato do que este módulo existe pra
 * fazer. Quantidade e posição se escrevem igual em português; o que separa as
 * duas é o marcador ordinal (º/ª/o/a) ou a palavra por extenso.
 */
const ORDINAIS: Array<[RegExp, number]> = [
  [/\b(primeir[oa]|1[ºª°]|1[oa]\b|numero 1|n\.? ?1)\b/, 1],
  [/\b(segund[oa]|2[ºª°]|2[oa]\b|numero 2|n\.? ?2)\b/, 2],
  [/\b(terceir[oa]|3[ºª°]|3[oa]\b|numero 3|n\.? ?3)\b/, 3],
  [/\b(quart[oa]|4[ºª°]|4[oa]\b|numero 4)\b/, 4],
  [/\b(quint[oa]|5[ºª°]|5[oa]\b|numero 5)\b/, 5],
];

/** Aponta para o que veio antes, sem nomear ordinal. */
const DEITICO =
  /\b(ess[ae]|est[ae]|aquel[ae]|isso|isto|aquilo|o anterior|a anterior|o ultimo|a ultima|essa versao|esse texto|essa legenda|esse titulo|essa copy|ele|ela)\b/;

/** Feedback sobre o artefato que acabou de sair. */
const CONTINUACAO =
  /\b(faz menor|deixa menor|encurta|resume|mais curt[oa]|mais long[oa]|menos ia|cara de ia|generico|refaz|reescreve|de outro jeito|outra versao|uma versao|versao pro cliente|pro cliente|muda (so )?o (final|comeco|titulo)|melhora|ajusta|troca a palavra|deixa mais|fecha (uma |a )?(versao )?final)\b/;

/** Pede fato que o diálogo não contém — aqui o vault continua sendo necessário. */
const FACTUAL =
  /\b(prazo|deadline|quando (vence|e|foi)|metrica|metricas|resultado|investimento|cpl|cpa|roi|ctr|historico|posicionamento|publico-alvo|persona|concorrente|benchmark|dados d[eo]|numeros d[eo]|no clickup|na campanha d[eo])\b/;

/** Pede explicitamente pesquisa/conhecimento externo. */
const PESQUISA = /\b(pesquisa|pesquisar|busca referencia|referencias de mercado|tendencia|benchmark|estudo)\b/;

/**
 * Classifica o turno do usuário. Determinístico: o mesmo texto dá a mesma
 * classe, e a decisão de rodar ou não o vault é auditável sem abrir o modelo.
 *
 * Só o TURNO do usuário entra — o bloco do orquestrador é cortado aqui, que é
 * a correção da causa 1.
 */
export function classificarTurno(message: string, temDialogoRecente: boolean): TurnoClassificado {
  const turno = stripOrchestratorContext(message).trim();
  const flat = dobra(turno);

  const ordinal = ORDINAIS.find(([re]) => re.test(flat))?.[1] ?? null;
  const temDeitico = DEITICO.test(flat);
  const temContinuacao = CONTINUACAO.test(flat);
  const pedeFato = FACTUAL.test(flat) || PESQUISA.test(flat);

  // Sem diálogo recente não há referente possível: qualquer pedido é novo, e o
  // vault volta a ser a única fonte. É o que mantém a conversa nova correta.
  if (!temDialogoRecente) {
    return { classe: 'PEDIDO_NOVO', precisaVault: true, ordinal, motivo: 'sem diálogo recente para resolver referente' };
  }

  // FATO vence referência: "me explica o segundo à luz do posicionamento da
  // Elite" aponta pro diálogo E precisa da marca. Nesse caso o vault roda.
  if (pedeFato) {
    const classe: ClasseDeTurno = ordinal !== null || temDeitico ? 'REFERENCIAL' : 'BUSCA_FACTUAL';
    return { classe, precisaVault: true, ordinal, motivo: 'turno pede fato/dado que o diálogo não contém' };
  }

  if (ordinal !== null || temDeitico) {
    return {
      classe: 'REFERENCIAL',
      precisaVault: false,
      ordinal,
      motivo: ordinal !== null ? `referência ordinal (${ordinal}) ao diálogo recente` : 'referência dêitica ao diálogo recente',
    };
  }

  if (temContinuacao) {
    return { classe: 'CONTINUACAO_CRIATIVA', precisaVault: false, ordinal: null, motivo: 'feedback sobre o artefato atual' };
  }

  return { classe: 'PEDIDO_NOVO', precisaVault: true, ordinal, motivo: 'pedido novo: conhecimento e marca são necessários' };
}

/**
 * Itens de uma lista escrita pelo Otto.
 *
 * Ele alterna formatos reais, e todos precisam funcionar: "2 Título",
 * "2. Título", cabeçalho "Post 2"/"Título 2" com o conteúdo na linha
 * seguinte, e a peça conceito — "Conceito: ..." + "Variação A:"/"Variação B:".
 * Depender do modelo para contar "o segundo" seria trocar uma estrutura que
 * existe por um palpite — e foi exatamente o que aconteceu em 18/09/2026:
 * sem formato reconhecido, a diretiva ficou genérica e o modelo INVENTOU um
 * título que não existia na resposta anterior.
 *
 * Na peça conceito, a ordem do documento é a ordem dos itens: o Conceito é o
 * primeiro, Variação A o segundo, B o terceiro. É assim que um humano lê a
 * peça, e é assim que "o segundo" resolve.
 */
export function itensDaLista(texto: string): string[] {
  // "Otto: 1 Alfa" — o rótulo de quem falou fica no MESMO parágrafo do
  // primeiro item. Rótulo = UMA palavra colada nos dois-pontos seguida de
  // conteúdo; exigir isso impede comer um cabeçalho legítimo ("Título 1:").
  // "Conceito:" e "Variação A:" são rótulos DE ITEM, não de locutor — por
  // isso são tratados antes, nas próprias regras abaixo.
  const linhas = texto.split('\n').map((l) => {
    const t = l.trim();
    if (/^(conceito|varia[çc][ãa]o)\b/i.test(t)) return t;
    return t.replace(/^[A-ZÁ-Ú][\wÀ-ÿ]*:\s+(?=\S)/, '');
  });
  const itens: string[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i]!;
    // Peça conceito: "Conceito: "texto"" — o primeiro item da peça.
    const conceito = /^conceito:\s*["“]?(.+?)["”]?\s*$/i.exec(l);
    if (conceito?.[1] && conceito[1].length > 3) {
      itens.push(conceito[1].trim());
      continue;
    }
    // "Variação A: texto" — letra vira ordinal (A=2º item se veio depois do
    // Conceito, pela ordem do documento).
    const variacao = /^varia[çc][ãa]o\s+[a-e]\s*[:.)-]\s*(.+)$/i.exec(l);
    if (variacao?.[1]) {
      itens.push(variacao[1].trim());
      continue;
    }
    if (/^(post|op[cç][aã]o|t[ií]tulo|vers[aã]o|alternativa)\s*\d+\s*[:.)-]?$/i.test(l)) {
      const prox = linhas.slice(i + 1).find((x) => x.length > 0);
      if (prox) itens.push(prox);
      continue;
    }
    const inline = /^(?:\d+\s*[.)-]?|[-*•])\s+(\S.*)$/.exec(l);
    if (inline?.[1]) itens.push(inline[1].trim());
  }
  return itens;
}

/**
 * Resolve o referente contra o diálogo recente e devolve uma instrução curta
 * para o prompt — não a resposta pronta. Quem escreve continua sendo o modelo;
 * o que o código garante é que ele saiba de QUE item se está falando.
 */
export function resolverReferente(dialogoRecente: string, turno: TurnoClassificado): string | null {
  if (turno.classe !== 'REFERENCIAL' && turno.classe !== 'CONTINUACAO_CRIATIVA') return null;
  if (!dialogoRecente.trim()) return null;

  // O último bloco do assistente é onde o artefato mora. Locutor é QUEM FALA
  // no bloco de diálogo — "Usuário:" ou o nome do agente — nunca qualquer
  // palavra com dois-pontos: "Conceito:" e "Variação A:" são itens DENTRO da
  // fala, e tratá-los como locutor fatiava a fala no meio (medido em 18/09).
  const linhas = dialogoRecente.split('\n');
  const ehLocutor = /^(Usuário|Otto|Bento|Jarbas|Suzy):/;
  const inicioUltimaFala = linhas.map((l, i) => ({ l, i })).filter((x) => ehLocutor.test(x.l)).pop()?.i ?? 0;
  const ultimaFala = linhas.slice(inicioUltimaFala).join('\n');

  if (turno.ordinal !== null) {
    const itens = itensDaLista(ultimaFala);
    const alvo = itens[turno.ordinal - 1];
    if (alvo) return `O item ${turno.ordinal} a que o usuário se refere é: "${alvo}". Fale sobre ELE.`;
    return `O usuário se refere ao item ${turno.ordinal} da sua resposta anterior. Use a conversa recente para identificá-lo; não procure em outras fontes.`;
  }

  return 'O usuário se refere ao que você acabou de entregar na conversa recente. Trabalhe sobre esse material.';
}
