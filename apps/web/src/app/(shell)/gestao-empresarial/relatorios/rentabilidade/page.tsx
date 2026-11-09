'use client';

import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Carregando, Dinheiro, TD, TH, TH_DIREITA, Tabela, Vazio } from '@/components/gestao-empresarial/kit';
import { SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { MargemDoPedido } from '@/components/gestao-empresarial/producao/margem';
import { useRentabilidade } from '@/hooks/use-gestao-relatorios';

export default function RentabilidadePage() {
  const { data, isPending, isError, refetch } = useRentabilidade();
  if (isPending) return <Carregando />;
  if (isError || !data) return <InlineSectionError message="Não conseguimos carregar a rentabilidade." onRetry={() => void refetch()} />;
  if (data.items.length === 0) return <Vazio titulo="Nenhum pedido de produção para analisar">A rentabilidade aparece quando há pedidos de produção com custos lançados.</Vazio>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-nevoa">Pedidos cancelados não entram. Sem valor de venda informado, a margem aparece só em reais e sem percentual.</p>
      <Tabela legenda="Rentabilidade dos pedidos de produção">
        <thead><tr><th className={TH}>Pedido</th><th className={TH}>Cliente</th><th className={TH}>Situação</th><th className={TH_DIREITA}>Venda</th><th className={TH_DIREITA}>Custo</th><th className={TH_DIREITA}>Margem</th></tr></thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.numero} className="border-t border-grafite-elevado/60">
              <td className={TD}><span className="font-mono text-xs text-nevoa">{r.numero}</span> {r.titulo}</td>
              <td className={`${TD} text-nevoa`}>{r.cliente ?? '—'}</td>
              <td className={TD}><SeloDeStatus status={r.status} /></td>
              <td className={`${TD} text-right`}><Dinheiro centavos={r.vendaCents} /></td>
              <td className={`${TD} text-right`}><Dinheiro centavos={r.custoCents} /></td>
              <td className={`${TD} text-right`}><MargemDoPedido margemCents={r.margemCents} percentual={r.percentual} /></td>
            </tr>
          ))}
        </tbody>
      </Tabela>
    </div>
  );
}
