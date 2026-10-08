/**
 * pergunta-factual.ts — ENTIDADE CONHECIDA + ATRIBUTO PERGUNTADO = conhecimento.
 *
 * Decisão determinística, tomada ANTES de qualquer classificador.
 *
 * O QUE ELA RESOLVE, medido em 01/10/2026 numa bateria de 25 execuções sobre a
 * Cosentino: 2 delas devolveram "não consegui identificar sozinho se isso é
 * operação, mídia paga ou criação" para perguntas como "Qual é o posicionamento
 * da Cosentino?" — com o cliente já resolvido na própria requisição.
 *
 * As outras 23 rotearam certo. Mesma pergunta, mesmo código, resultados
 * diferentes: a decisão dependia de classificador probabilístico, e
 * classificador probabilístico às vezes erra. Numa pergunta sem ambiguidade
 * nenhuma, essa variação não tem o que justificar.
 *
 * POR QUE NÃO UMA LISTA DE PALAVRAS: corrigir `posicionamento`, depois `preço`,
 * depois `segmento`, é uma lista que nunca fecha — e cada entrada nova só cobre
 * a pergunta que já falhou, nunca a próxima. A regra aqui é de FORMA: pergunta
 * que começa com pronome interrogativo e pede um atributo, com entidade já
 * resolvida pelo chamador, é consulta ao conhecimento. Ponto.
 *
 * O QUE ELA NÃO FAZ: não resolve entidade (quem resolve é quem chama, que tem
 * banco), não decide sem entidade, e não captura pedido de execução. "Cria um
 * carrossel pra Cosentino" tem entidade e não é pergunta — segue o caminho
 * normal.
 */

/** Sem acento, minúscula. Mesma normalização do guarda de ausência. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Abertura de pergunta factual em português. Cobre as formas que a equipe
 * escreve de verdade, incluindo o imperativo cortês ("me diz qual..."), e NÃO
 * cobre imperativo de execução ("cria", "monta", "escreve").
 */
const ABERTURA_FACTUAL =
  /^\s*(?:me (?:diga|diz|fala|conta)[,:]?\s+)?(?:h[áa]\s+)?(?:qual|quais|quem|quando|onde|como|quant[oa]s?|que tipo de|o que)\b/;

/**
 * Marcas de pedido OPERACIONAL, que têm caminho próprio e autoridade própria
 * (ClickUp ao vivo). Uma pergunta factual que fale de tarefa não é consulta ao
 * Brain: é consulta ao estado, e o estado tem outra fonte.
 */
const PEDE_ESTADO_OPERACIONAL =
  /\b(status|andamento|tarefas?|tasks?|entregas?|prazos?|vence|vencimento|atrasad[ao]s?|em aberto|pend[êe]ncias?|backlog|sprint)\b/i;

/**
 * Marcas de pedido de MÍDIA PAGA. Têm agente próprio (Jarbas) e dado próprio —
 * mandar isso ao Bento foi como uma resposta de mídia saiu com vault de outro
 * cliente, que é a razão de a clarification existir.
 */
const PEDE_MIDIA_PAGA =
  /\b(cpa|cpc|cpm|ctr|roas|investimento|verba|anuncio|anuncios|campanha paga|meta ads|google ads|impress[õo]es|convers[õa]o|convers[õo]es)\b/i;

/** Marcas de pedido de CRIAÇÃO: "que tipo de legenda eu escrevo" não é consulta. */
const PEDE_CRIACAO =
  /\b(cri[ae]|escrev[ae]|mont[ae]|gera|gere|fa[çc]a|redij[ae]|reescrev[ae]|roteiro|legenda|carrossel|headline|copy)\b/i;

export interface PerguntaFactual {
  ehFactual: boolean;
  /** Por que não, quando não é — entra no log para a decisão ser auditável. */
  motivo: string | null;
}

/**
 * A pergunta é uma consulta factual sobre uma entidade já resolvida?
 *
 * `entidadeResolvida` é responsabilidade de quem chama: na rota de chat é o
 * `client_id` do corpo ou o cliente que o resolvedor de escopo achou. Sem
 * entidade esta função NUNCA decide — "qual é o posicionamento?" sem cliente é
 * genuinamente ambíguo, e clarification ali é a resposta certa.
 */
export function ehPerguntaFactualSobreEntidade(
  mensagem: string,
  entidadeResolvida: boolean,
): PerguntaFactual {
  if (!entidadeResolvida) return { ehFactual: false, motivo: 'sem entidade resolvida' };

  const texto = normalizar(mensagem);
  if (texto.length === 0) return { ehFactual: false, motivo: 'mensagem vazia' };

  if (!ABERTURA_FACTUAL.test(texto)) return { ehFactual: false, motivo: 'não abre como pergunta factual' };

  // A ordem importa: operacional e mídia paga vencem, porque têm fonte e
  // agente próprios. Criação vence porque é pedido de entrega, não consulta.
  if (PEDE_ESTADO_OPERACIONAL.test(texto)) return { ehFactual: false, motivo: 'pede estado operacional' };
  if (PEDE_MIDIA_PAGA.test(texto)) return { ehFactual: false, motivo: 'pede mídia paga' };
  if (PEDE_CRIACAO.test(texto)) return { ehFactual: false, motivo: 'pede criação' };

  return { ehFactual: true, motivo: null };
}
