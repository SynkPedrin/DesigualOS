'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO, CAMPO, Carregando, Dinheiro, Paginacao, TD, TH, TH_DIREITA, Tabela, Vazio } from '@/components/gestao-empresarial/kit';
import { NovaProposta } from '@/components/gestao-empresarial/comercial/nova-proposta';
import { SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { usePessoasPorId, usePropostas } from '@/hooks/use-gestao-comercial';
import { formatarDia } from '@/lib/gestao-empresarial/formato';

const STATUS = ['rascunho', 'enviada', 'aprovada', 'recusada', 'expirada', 'cancelada'];

export default function PropostasPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [criando, setCriando] = useState(false);
  const { data, isPending, isError, refetch } = usePropostas({ page, ...(status && { status }), ...(q.trim() && { q: q.trim() }) });
  const nomes = usePessoasPorId(data?.items.map((p) => p.partyId) ?? []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-nevoa">Situação
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${CAMPO} mt-1 w-44`}>
            <option value="">Todas</option>
            {STATUS.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-xs text-nevoa">Buscar pelo título
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Ex.: campanha de verão" className={`${CAMPO} mt-1`} />
        </label>
        <button type="button" onClick={() => setCriando(true)} className={BOTAO}><Plus size={14} /> Nova proposta</button>
      </div>

      {isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar as propostas." onRetry={() => void refetch()} /> : data.items.length === 0 ? (
        <Vazio titulo={status || q ? 'Nenhuma proposta com esse filtro' : 'Nenhuma proposta ainda'}>{status || q ? 'Limpe os filtros para ver todas.' : 'Crie a primeira proposta e envie ao cliente. Quando aprovada, ela vira contrato e pedido de venda.'}</Vazio>
      ) : (
        <>
          <Tabela legenda="Propostas">
            <thead><tr><th className={TH}>Número</th><th className={TH}>Título</th><th className={TH}>Cliente</th><th className={TH}>Situação</th><th className={TH}>Válida até</th><th className={TH_DIREITA}>Total</th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40">
                  <td className={`${TD} font-mono text-xs`}><Link href={`/gestao-empresarial/comercial/propostas/${p.id}`} className="underline">{p.number}</Link></td>
                  <td className={TD}>{p.title}</td>
                  <td className={`${TD} text-nevoa`}>{p.partyId ? (nomes.data?.[p.partyId] ?? '…') : 'Sem cliente'}</td>
                  <td className={TD}><SeloDeStatus status={p.status} /></td>
                  <td className={`${TD} tabular-nums text-nevoa`}>{formatarDia(p.validUntil) || '—'}</td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={p.totalCents} /></td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {criando && <NovaProposta onFechar={() => setCriando(false)} />}
    </div>
  );
}
