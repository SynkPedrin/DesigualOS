'use client';

import Link from 'next/link';
import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO_PERIGO, BOTAO_SECUNDARIO, CAMPO, Carregando, Dialogo, Dinheiro, Paginacao, TD, TH, TH_DIREITA, Tabela, Vazio, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { ACAO_DE_STATUS, SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { TRANSICOES_CONTRATO, useComercialAcoes, useContratos, usePessoasPorId, type ContratoWire, type StatusDoContrato } from '@/hooks/use-gestao-comercial';
import { formatarDia } from '@/lib/gestao-empresarial/formato';
import { toast } from '@/stores/toast-store';

export default function ContratosPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [cancelando, setCancelando] = useState<ContratoWire | null>(null);
  const { data, isPending, isError, refetch } = useContratos({ page, ...(status && { status }) });
  const nomes = usePessoasPorId(data?.items.map((c) => c.partyId) ?? []);
  const { statusContrato } = useComercialAcoes();

  function mudar(c: ContratoWire, para: StatusDoContrato) {
    statusContrato.mutate({ id: c.id, status: para }, { onSuccess: () => { toast(`Contrato ${c.number}: ${(ACAO_DE_STATUS[para] ?? para).toLowerCase()}.`, 'success'); setCancelando(null); }, onError: (e) => { setCancelando(null); toast(mensagemDeErro(e), 'error'); } });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs text-nevoa">Situação
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${CAMPO} mt-1 w-44`}>
            <option value="">Todas</option><option value="rascunho">Rascunho</option><option value="vigente">Vigente</option><option value="encerrado">Encerrado</option><option value="cancelado">Cancelado</option>
          </select>
        </label>
        <p className="max-w-md text-xs text-nevoa">Contratos nascem de uma proposta aprovada: abra a proposta e use “Gerar contrato”.</p>
      </div>
      {isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar os contratos." onRetry={() => void refetch()} /> : data.items.length === 0 ? (
        <Vazio titulo="Nenhum contrato">Aprove uma proposta em <Link href="/gestao-empresarial/comercial/propostas" className="underline">Propostas</Link> e gere o contrato a partir dela.</Vazio>
      ) : (
        <>
          <Tabela legenda="Contratos">
            <thead><tr><th className={TH}>Número</th><th className={TH}>Título</th><th className={TH}>Cliente</th><th className={TH}>Situação</th><th className={TH}>Vigência</th><th className={TH_DIREITA}>Total</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-t border-grafite-elevado/60 align-top hover:bg-grafite-elevado/40">
                  <td className={`${TD} font-mono text-xs`}>{c.number}</td>
                  <td className={TD}>{c.title}{c.proposalId && <> <Link href={`/gestao-empresarial/comercial/propostas/${c.proposalId}`} className="text-xs text-nevoa underline">ver proposta</Link></>}</td>
                  <td className={`${TD} text-nevoa`}>{c.partyId ? (nomes.data?.[c.partyId] ?? '…') : '—'}</td>
                  <td className={TD}><SeloDeStatus status={c.status} /></td>
                  <td className={`${TD} tabular-nums text-nevoa`}>{c.startsOn || c.endsOn ? `${formatarDia(c.startsOn) || '…'} a ${formatarDia(c.endsOn) || '…'}` : '—'}</td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={c.totalCents} /></td>
                  <td className={TD}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {TRANSICOES_CONTRATO[c.status].map((s) => (
                        <button key={s} type="button" disabled={statusContrato.isPending} onClick={() => (s === 'cancelado' ? setCancelando(c) : mudar(c, s))} className={`${s === 'cancelado' ? BOTAO_PERIGO : BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>{ACAO_DE_STATUS[s]}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
      {cancelando && (
        <Dialogo titulo={`Cancelar contrato ${cancelando.number}`} onFechar={() => setCancelando(null)} largura="max-w-sm">
          <p className="text-sm text-nevoa">O contrato ficará cancelado. Esta situação é final.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCancelando(null)} className={BOTAO_SECUNDARIO}>Voltar</button><button type="button" disabled={statusContrato.isPending} onClick={() => mudar(cancelando, 'cancelado')} className={BOTAO_PERIGO}>Cancelar contrato</button></div>
        </Dialogo>
      )}
    </div>
  );
}
