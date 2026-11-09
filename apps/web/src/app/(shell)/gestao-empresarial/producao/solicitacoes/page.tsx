'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO, CAMPO, Carregando, Paginacao, TD, TH, Tabela, Vazio } from '@/components/gestao-empresarial/kit';
import { SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { NovaSolicitacao } from '@/components/gestao-empresarial/producao/nova-solicitacao';
import { usePessoasPorId } from '@/hooks/use-gestao-comercial';
import { useSolicitacoes } from '@/hooks/use-gestao-producao';
import { formatarDia } from '@/lib/gestao-empresarial/formato';

export default function SolicitacoesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [criando, setCriando] = useState(false);
  const { data, isPending, isError, refetch } = useSolicitacoes({ page, ...(status && { status }) });
  const nomes = usePessoasPorId(data?.items.map((s) => s.partyId) ?? []);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs text-nevoa">Situação
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${CAMPO} mt-1 w-44`}>
            <option value="">Todas</option><option value="aberta">Aberta</option><option value="cotando">Cotando</option><option value="aprovada">Aprovada</option><option value="cancelada">Cancelada</option>
          </select>
        </label>
        <button type="button" onClick={() => setCriando(true)} className={BOTAO}><Plus size={14} /> Nova solicitação</button>
      </div>
      {isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar as solicitações." onRetry={() => void refetch()} /> : data.items.length === 0 ? (
        <Vazio titulo="Nenhuma solicitação de produção">Registre o que precisa ser produzido, peça cotações a fornecedores e escolha a melhor. A cotação escolhida vira pedido de produção.</Vazio>
      ) : (
        <>
          <Tabela legenda="Solicitações de produção">
            <thead><tr><th className={TH}>Número</th><th className={TH}>Solicitação</th><th className={TH}>Cliente</th><th className={TH}>Situação</th><th className={TH}>Prazo</th></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40">
                  <td className={`${TD} font-mono text-xs`}><Link href={`/gestao-empresarial/producao/solicitacoes/${s.id}`} className="underline">{s.number}</Link></td>
                  <td className={TD}>{s.title}</td>
                  <td className={`${TD} text-nevoa`}>{s.partyId ? (nomes.data?.[s.partyId] ?? '…') : '—'}</td>
                  <td className={TD}><SeloDeStatus status={s.status} /></td>
                  <td className={`${TD} tabular-nums text-nevoa`}>{formatarDia(s.dueOn) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {criando && <NovaSolicitacao onFechar={() => setCriando(false)} />}
    </div>
  );
}
