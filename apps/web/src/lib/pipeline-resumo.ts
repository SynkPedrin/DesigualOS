import type { PipelineStage } from '@/mocks/pipeline';

/**
 * OS NÚMEROS DO QUADRO, derivados só do que o dado sustenta.
 *
 * O mockup de Pipelines (assets/TELASS - TUTORIAL/tela-pipelines.png) mostra
 * cinco indicadores no topo e a soma de valores em cada coluna. Três deles —
 * total de cartões, quantidade por coluna e proporção — saem direto dos
 * cartões. Os outros dois do mockup, "taxa de conversão" e "carga do quadro",
 * NÃO saem: conversão exige saber qual coluna significa ganho, e isso é
 * semântica que o produto não guarda (as colunas são livres, criadas por quem
 * usa). Inventar os dois seria exatamente o que o briefing proíbe, então eles
 * não existem aqui.
 *
 * O VALOR é texto livre no banco — "R$ 4.500/mês", "12.000", "a definir" —
 * porque foi assim que a tela nasceu. Somar texto livre em silêncio é como se
 * produz um número errado com cara de certo: basta um cartão escrito de outro
 * jeito pra soma ficar menor e ninguém perceber. Por isso o resumo devolve
 * `semValor` junto da soma, e a tela mostra os dois.
 */
export interface ResumoDeEstagio {
  id: string;
  label: string;
  color: PipelineStage['color'];
  quantidade: number;
  /** Fração do total, 0–1. `null` quando o quadro está vazio. */
  proporcao: number | null;
  /** Soma dos cartões cujo valor foi possível ler, em centavos. */
  somaCentavos: number;
  /** Quantos cartões desta coluna têm valor que não dá pra somar. */
  semValor: number;
}

export interface ResumoDoQuadro {
  total: number;
  estagios: ResumoDeEstagio[];
  somaCentavos: number;
  semValor: number;
}

/**
 * Lê valor em centavos a partir de texto livre no formato brasileiro.
 *
 * Ponto é milhar e vírgula é decimal — "4.500,50" são quatro mil e quinhentos
 * reais e cinquenta centavos, não quatro reais e meio. Trocar isso divide o
 * faturamento do quadro por mil, e a conta continua parecendo plausível.
 *
 * Sufixo como "/mês" é ignorado de propósito: o cartão diz o valor, a
 * recorrência é outra informação e somar mensalidade com valor fechado seria
 * misturar duas coisas. Texto sem número nenhum devolve `null` — "a definir"
 * não é zero, e tratar como zero esconde o cartão da soma sem avisar.
 */
export function lerValorEmCentavos(texto: string | null): number | null {
  if (!texto) return null;
  const achado = texto.match(/\d[\d.,]*/);
  if (!achado) return null;

  let bruto = achado[0];
  const temVirgula = bruto.includes(',');
  // Com vírgula: pontos são milhar, vírgula é decimal. Sem vírgula: ponto é
  // milhar ("12.000" é doze mil, não doze).
  bruto = temVirgula ? bruto.replace(/\./g, '').replace(',', '.') : bruto.replace(/\./g, '');

  const numero = Number(bruto);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
}

export function formatarCentavos(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function resumoDoQuadro(
  stages: readonly PipelineStage[],
  cards: readonly { stageId: string; valor: string | null }[],
): ResumoDoQuadro {
  const total = cards.length;

  const estagios = stages.map((stage) => {
    const doEstagio = cards.filter((c) => c.stageId === stage.id);
    let somaCentavos = 0;
    let semValor = 0;
    for (const cartao of doEstagio) {
      const centavos = lerValorEmCentavos(cartao.valor);
      if (centavos === null) semValor += 1;
      else somaCentavos += centavos;
    }
    return {
      id: stage.id,
      label: stage.label,
      color: stage.color,
      quantidade: doEstagio.length,
      proporcao: total > 0 ? doEstagio.length / total : null,
      somaCentavos,
      semValor,
    };
  });

  return {
    total,
    estagios,
    somaCentavos: estagios.reduce((s, e) => s + e.somaCentavos, 0),
    semValor: estagios.reduce((s, e) => s + e.semValor, 0),
  };
}
