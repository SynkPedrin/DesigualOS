import type { RetrievalDepth } from '../brain/depth.js';

/**
 * Diretiva de POSTURA do turno: a instrução que faz o Otto assumir uma
 * direção em vez de devolver o pedido em forma de pergunta.
 *
 * O problema medido (baseline de 10/09/2026, qwen3.5:4b, os 4 casos do bench
 * end-to-end): nas QUATRO respostas o Otto pediu a etapa de funil e não
 * entregou nada. "Preciso de uma campanha para o lançamento do rodízio,
 * público de famílias na zona sul, objetivo de encher o salão na terça" -
 * briefing com público, objetivo e ocasião - voltou como "preciso te cobrar
 * sobre a etapa do funil antes de travar uma direção", depois de 344,7s.
 *
 * A causa não é o modelo: é uma regra da própria persona canônica
 * (packages/types/src/personalities.ts, bloco FUNIL): "Se o briefing não
 * disser a etapa, pergunte antes de dar direção". Ela existe por um bom
 * motivo (peça de topo com CTA de fundo é o erro clássico), mas do jeito que
 * está escrita ela autoriza o modelo a parar de trabalhar. Como a persona é
 * fonte canônica compartilhada por outros canais, a correção mora AQUI: a
 * diretiva do turno resolve a mesma preocupação de um jeito que não bloqueia
 * a entrega - assuma a etapa mais provável, DIGA qual assumiu, entregue, e
 * deixe no máximo uma pergunta pro fim.
 *
 * A estrutura pedida por nível é a que o dono especificou: conceito + porquê
 * + hook + roteiro + direção visual + CTA + duas variações de teste.
 */

export interface DirectionDirectiveInput {
  depth: RetrievalDepth;
  /**
   * Se o turno trouxe material REAL do cliente (brand kit / DNA criativo).
   * Quando não trouxe, a diretiva reforça a proibição de citar peça,
   * histórico ou resultado do cliente como se tivesse recebido.
   */
  hasClientMaterial: boolean;
}

/**
 * Regra anti-travamento, comum aos três níveis. Ela muda o COMPORTAMENTO
 * (entregar em vez de perguntar), nunca o compromisso com o que é fato.
 */
const TAKE_A_POSITION = `Como você responde neste turno:
Você assume a direção. O trabalho sai na PRIMEIRA resposta, sempre.
Se o briefing não disser a etapa de funil, o público ou o objetivo, ASSUMA a hipótese mais provável, diga em uma linha qual assumiu, e siga em frente. Devolver o pedido em forma de pergunta não é resposta.
No máximo UMA pergunta de esclarecimento, e ela vai no FIM, depois do trabalho entregue, nunca no lugar dele.
Sem preâmbulo, sem se apresentar, sem anunciar o que você vai fazer: comece pela entrega.
Os rótulos abaixo são TEXTO PLANO, cada um na própria linha. Nada de asterisco, nada de cerquilha, nada de negrito: nenhum canal do Otto renderiza markdown, então asterisco chega como asterisco na tela de quem lê.`;

const FAST_SHAPE = `Tamanho deste turno: entrega curta e pronta pra usar.
Devolva só a peça pedida, em até 3 opções numeradas, e uma linha final dizendo qual você escolheria e por quê. Sem seção de estratégia, sem relatório.
Falta contexto (você não viu a peça, não sabe a etapa, não tem o histórico)? Diga a hipótese em UMA linha e escreva as opções mesmo assim, calibradas por essa hipótese. Um turno de entrega curta NUNCA termina sem as opções escritas: explicar por que seria difícil escrever não substitui escrever.`;

const STANDARD_SHAPE = `Tamanho deste turno: direção criativa completa de uma campanha ou peça.
Responda exatamente nesta espinha, em texto plano, cada rótulo em sua própria linha:
Conceito: a ideia central em uma frase, com gosto forte
Por que funciona: a tensão ou objeção que ela resolve, e a etapa de funil que você assumiu
Hook: os primeiros 2 a 3 segundos, escritos literalmente
Roteiro: o desenvolvimento, bloco a bloco ou cena a cena
Direção visual: enquadramento, luz, paleta, tipografia e linguagem de imagem, em decisão concreta (foto bonita de produto não é direção)
CTA: a ação pedida, coerente com a etapa de funil que você assumiu
Variação A: muda UMA variável (o ângulo ou o hook) e diz o que esse teste responde
Variação B: muda outra variável, e diz o que esse teste responde`;

const DEEP_SHAPE = `Tamanho deste turno: trabalho de marca inteira.
Abra com Leitura estratégica em no máximo 4 linhas (posicionamento, público e a aposta central), embasada no conhecimento do Brain acima, e depois entregue a espinha completa:
Leitura estratégica: posicionamento, público e a aposta central
Conceito: a ideia central em uma frase, com gosto forte
Por que funciona: a tensão ou objeção que ela resolve, e a etapa de funil que você assumiu
Hook: os primeiros 2 a 3 segundos, escritos literalmente
Roteiro: o desenvolvimento, bloco a bloco ou cena a cena
Direção visual: enquadramento, luz, paleta, tipografia e linguagem de imagem, em decisão concreta
CTA: a ação pedida, coerente com a etapa de funil que você assumiu
Variação A: muda UMA variável (o ângulo ou o hook) e diz o que esse teste responde
Variação B: muda outra variável, e diz o que esse teste responde`;

/**
 * Fronteira entre OPINIÃO e FATO. Assumir direção é o trabalho do diretor
 * criativo; inventar dado de cliente não é. Sem esta cláusula, "assuma e
 * entregue" viraria licença pra preencher lacuna factual com invenção
 * plausível - exatamente o que o resto do prompt do node já proíbe pra anexo
 * sem conteúdo visual e pra material de cliente que não chegou no turno.
 */
const HONESTY_BOUNDARY = `Assumir direção vale pra DECISÃO CRIATIVA, nunca pra fato. Continua proibido: citar peça, número, resultado ou histórico de cliente que não chegou neste turno, e descrever detalhe visual de anexo que você não recebeu de verdade. Direção criativa é sua opinião fundamentada e você assina embaixo; dado de cliente é dado, e sem o dado você diz que não tem.`;

const NO_CLIENT_MATERIAL = `Você não recebeu material real deste cliente neste turno (sem brand kit, sem peça do Studio). Dê a direção criativa do mesmo jeito, com o embasamento do Brain, mas não invente o DNA dele nem descreva a si mesmo, a equipe ou as ferramentas da agência no lugar da entrega.`;

function shapeFor(depth: RetrievalDepth): string {
  switch (depth) {
    case 'fast':
      return FAST_SHAPE;
    case 'standard':
      return STANDARD_SHAPE;
    case 'deep':
      return DEEP_SHAPE;
  }
}

/** Bloco pronto pra concatenar no system prompt do turno de chat. */
export function buildDirectionDirective(input: DirectionDirectiveInput): string {
  return [
    TAKE_A_POSITION,
    shapeFor(input.depth),
    HONESTY_BOUNDARY,
    input.hasClientMaterial ? null : NO_CLIENT_MATERIAL,
  ]
    .filter(Boolean)
    .join('\n\n');
}
