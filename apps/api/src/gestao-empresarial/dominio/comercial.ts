import { ErroDeValor } from './dinheiro';

export interface ItemDeProposta {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

/** Total da proposta em centavos: Σ (quantidade × preço − desconto). Total negativo é erro de dado, não "crédito". */
export function totalDaProposta(itens: readonly ItemDeProposta[]): number {
  let total = 0;
  for (const i of itens) {
    if (![i.quantity, i.unitPriceCents, i.discountCents].every(Number.isSafeInteger) || i.quantity <= 0 || i.unitPriceCents < 0 || i.discountCents < 0) {
      throw new ErroDeValor('Item com quantidade ou valor inválido.');
    }
    const linha = i.quantity * i.unitPriceCents - i.discountCents;
    if (linha < 0) throw new ErroDeValor('O desconto de um item não pode passar do valor da linha.');
    total += linha;
  }
  if (!Number.isSafeInteger(total)) throw new ErroDeValor('Total grande demais.');
  return total;
}

export type Transicoes = Readonly<Record<string, readonly string[]>>;

/** Proposta: só avança para onde faz sentido; aprovada, recusada, expirada e cancelada são finais. */
export const TRANSICOES_PROPOSTA: Transicoes = {
  rascunho: ['enviada', 'cancelada'],
  enviada: ['aprovada', 'recusada', 'expirada', 'cancelada', 'rascunho'],
  aprovada: [],
  recusada: [],
  expirada: [],
  cancelada: [],
};
export const TRANSICOES_CONTRATO: Transicoes = { rascunho: ['vigente', 'cancelado'], vigente: ['encerrado', 'cancelado'], encerrado: [], cancelado: [] };
export const TRANSICOES_PEDIDO_DE_VENDA: Transicoes = { aberto: ['faturado', 'cancelado'], faturado: [], cancelado: [] };
export const TRANSICOES_SOLICITACAO: Transicoes = { aberta: ['cotando', 'cancelada'], cotando: ['aprovada', 'cancelada'], aprovada: [], cancelada: [] };
export const TRANSICOES_PEDIDO_DE_PRODUCAO: Transicoes = { aberta: ['em_producao', 'cancelada'], em_producao: ['entregue', 'cancelada'], entregue: [], cancelada: [] };

export const podeTransitar = (mapa: Transicoes, de: string, para: string): boolean => mapa[de]?.includes(para) ?? false;

/** "P-0007" depois de "P-0006". Sem número anterior, começa em 1. Recusa lixo em vez de reiniciar a contagem. */
export function proximoNumero(prefixo: string, ultimo: string | null): string {
  if (ultimo === null) return `${prefixo}-0001`;
  const m = new RegExp(`^${prefixo}-(\\d{4,})$`).exec(ultimo);
  if (!m) throw new ErroDeValor(`Número "${ultimo}" fora do padrão ${prefixo}-0000.`);
  return `${prefixo}-${String(Number(m[1]) + 1).padStart(4, '0')}`;
}

export interface Margem {
  margemCents: number;
  /** Em %, com uma casa decimal. Nulo quando não há venda para comparar (não vira 0% nem 100%). */
  percentual: number | null;
}

export function margem(vendaCents: number | null, custoCents: number): Margem {
  if (vendaCents === null) return { margemCents: -custoCents, percentual: null };
  const margemCents = vendaCents - custoCents;
  return { margemCents, percentual: vendaCents > 0 ? Math.round((margemCents * 1000) / vendaCents) / 10 : null };
}
