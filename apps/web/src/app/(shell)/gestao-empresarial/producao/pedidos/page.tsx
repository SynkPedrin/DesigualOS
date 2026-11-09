'use client';

import Link from 'next/link';
import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { CAMPO, Carregando, Dinheiro, Paginacao, TD, TH, TH_DIREITA, Tabela, Vazio } from '@/components/gestao-empresarial/kit';
import { SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { MargemDoPedido } from '@/components/gestao-empresarial/producao/margem';
import { usePedidosDeProducao } from '@/hooks/use-gestao-producao';

export default function PedidosDeProducaoPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, isPending, isError, refetch } = usePedidosDeProducao({ page, ...(status && { status }) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs text-nevoa">Situação
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${CAMPO} mt-1 w-44`}>
            <option value="">Todas</option><option value="aberta">Aberta</option><option value="em_producao">Em produção</option><option value="entregue">Entregue</option><option value="cancelada">Cancelada</option>
          </select>
        </label>
        <p className="max-w-md text-xs text-nevoa">Pedidos nascem de uma solicitação com cotação escolhida. Abra a solicitação para criar o pedido.</p>
      </div>
      {isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar os pedidos de produção." onRetry={() => void refetch()} /> : data.items.length === 0 ? (
        <Vazio titulo="Nenhum pedido de produção">Escolha uma cotação em <Link href="/gestao-empresarial/producao/solicitacoes" className="underline">Solicitações e cotações</Link> e abra o pedido a partir dela.</Vazio>
      ) : (
        <>
          <Tabela legenda="Pedidos de produção com custo e margem">
            <thead><tr><th className={TH}>Número</th><th className={TH}>Título</th><th className={TH}>Situação</th><th className={TH_DIREITA}>Venda</th><th className={TH_DIREITA}>Custo</th><th className={TH_DIREITA}>Margem</th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40">
                  <td className={`${TD} font-mono text-xs`}><Link href={`/gestao-empresarial/producao/pedidos/${p.id}`} className="underline">{p.number}</Link></td>
                  <td className={TD}>{p.title}</td>
                  <td className={TD}><SeloDeStatus status={p.status} /></td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={p.saleCents} /></td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={p.custoCents ?? 0} /></td>
                  <td className={`${TD} text-right`}><MargemDoPedido margemCents={p.margemCents ?? 0} percentual={p.percentual ?? null} /></td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  );
}
