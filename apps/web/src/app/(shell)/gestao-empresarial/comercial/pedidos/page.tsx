'use client';

import Link from 'next/link';
import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO, BOTAO_PERIGO, BOTAO_SECUNDARIO, CAMPO, Carregando, Dialogo, Dinheiro, Paginacao, TD, TH, TH_DIREITA, Tabela, Vazio, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { Faturar } from '@/components/gestao-empresarial/comercial/faturar';
import { SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { useComercialAcoes, usePedidosDeVenda, usePessoasPorId, type PedidoDeVendaWire } from '@/hooks/use-gestao-comercial';
import { toast } from '@/stores/toast-store';

export default function PedidosDeVendaPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [faturando, setFaturando] = useState<PedidoDeVendaWire | null>(null);
  const [cancelando, setCancelando] = useState<PedidoDeVendaWire | null>(null);
  const { data, isPending, isError, refetch } = usePedidosDeVenda({ page, ...(status && { status }) });
  const nomes = usePessoasPorId(data?.items.map((p) => p.partyId) ?? []);
  const { cancelarPedido } = useComercialAcoes();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs text-nevoa">Situação
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${CAMPO} mt-1 w-44`}>
            <option value="">Todas</option><option value="aberto">Aberto</option><option value="faturado">Faturado</option><option value="cancelado">Cancelado</option>
          </select>
        </label>
        <p className="max-w-md text-xs text-nevoa">Faturar um pedido cria as contas a receber dele no financeiro. Pedidos nascem de uma proposta aprovada.</p>
      </div>
      {isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar os pedidos." onRetry={() => void refetch()} /> : data.items.length === 0 ? (
        <Vazio titulo="Nenhum pedido de venda">Aprove uma proposta em <Link href="/gestao-empresarial/comercial/propostas" className="underline">Propostas</Link> e gere o pedido a partir dela.</Vazio>
      ) : (
        <>
          <Tabela legenda="Pedidos de venda">
            <thead><tr><th className={TH}>Número</th><th className={TH}>Título</th><th className={TH}>Cliente</th><th className={TH}>Situação</th><th className={TH_DIREITA}>Total</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40">
                  <td className={`${TD} font-mono text-xs`}>{p.number}</td>
                  <td className={TD}>{p.title}{p.proposalId && <> <Link href={`/gestao-empresarial/comercial/propostas/${p.proposalId}`} className="text-xs text-nevoa underline">ver proposta</Link></>}</td>
                  <td className={`${TD} text-nevoa`}>{p.partyId ? (nomes.data?.[p.partyId] ?? '…') : '—'}</td>
                  <td className={TD}><SeloDeStatus status={p.status} /></td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={p.totalCents} /></td>
                  <td className={TD}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {p.status === 'aberto' && <button type="button" onClick={() => setFaturando(p)} className={`${BOTAO} px-2 py-1 text-xs`}>Faturar</button>}
                      {p.status === 'aberto' && <button type="button" onClick={() => setCancelando(p)} className={`${BOTAO_PERIGO} px-2 py-1 text-xs`}>Cancelar</button>}
                      {p.status === 'faturado' && <Link href="/gestao-empresarial/financeiro/receber" className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>Ver no financeiro</Link>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {faturando && <Faturar pedido={faturando} onFechar={() => setFaturando(null)} />}
      {cancelando && (
        <Dialogo titulo={`Cancelar pedido ${cancelando.number}`} onFechar={() => setCancelando(null)} largura="max-w-sm">
          <p className="text-sm text-nevoa">O pedido ficará cancelado e não poderá ser faturado. Esta situação é final.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setCancelando(null)} className={BOTAO_SECUNDARIO}>Voltar</button>
            <button type="button" disabled={cancelarPedido.isPending} onClick={() => cancelarPedido.mutate(cancelando.id, { onSuccess: () => { toast(`Pedido ${cancelando.number} cancelado.`, 'success'); setCancelando(null); }, onError: (e) => { setCancelando(null); toast(mensagemDeErro(e), 'error'); } })} className={BOTAO_PERIGO}>Cancelar pedido</button>
          </div>
        </Dialogo>
      )}
    </div>
  );
}
