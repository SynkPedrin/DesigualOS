import { Dinheiro } from '../kit';

/** Margem em reais e em %. Sem venda informada o percentual não existe: mostra "sem venda", nunca 0% nem 100%. */
export function MargemDoPedido({ margemCents, percentual }: { margemCents: number; percentual: number | null }) {
  return (
    <span className="inline-flex flex-col items-end">
      <Dinheiro centavos={margemCents} />
      <span className="text-[11px] text-nevoa">{percentual === null ? 'sem venda informada' : `${String(percentual).replace('.', ',')}%`}</span>
    </span>
  );
}
