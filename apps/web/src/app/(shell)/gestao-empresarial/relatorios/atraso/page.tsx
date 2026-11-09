'use client';

import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Carregando, Dinheiro, TD, TH, TH_DIREITA, Tabela, Vazio } from '@/components/gestao-empresarial/kit';
import { ExportarCsv } from '@/components/gestao-empresarial/relatorios/exportar-csv';
import { ORDEM_DAS_FAIXAS, ROTULO_DA_FAIXA, useAtraso } from '@/hooks/use-gestao-relatorios';
import { cn } from '@/lib/utils';

export default function AtrasoPage() {
  const [kind, setKind] = useState<'receita' | 'despesa'>('receita');
  const { data, isPending, isError, refetch } = useAtraso(kind);
  const nome = kind === 'receita' ? 'a receber' : 'a pagar';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="Tipo" className="inline-flex rounded-md border border-grafite-elevado p-0.5">
          {(['receita', 'despesa'] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('rounded px-3 py-1.5 text-sm', kind === k ? 'bg-grafite-elevado font-medium text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>{k === 'receita' ? 'A receber' : 'A pagar'}</button>)}
        </div>
        {data && <p className="text-sm text-nevoa">Total em aberto {nome}: <Dinheiro centavos={data.totalCents} className="font-heading text-lg font-semibold text-branco-cru" /></p>}
      </div>
      {isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar o relatório de atraso." onRetry={() => void refetch()} /> : data.totalCents === 0 ? (
        <Vazio titulo={`Nada ${nome} em aberto`}>Quando houver lançamentos em aberto, eles aparecem aqui por faixa de atraso.</Vazio>
      ) : (
        <>
          <section aria-label="Faixas de atraso" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {ORDEM_DAS_FAIXAS.map((f) => (
              <div key={f} className={cn('rounded-xl border bg-grafite p-3', f === 'a_vencer' ? 'border-grafite-elevado' : data.faixas[f].quantidade > 0 ? 'border-red-500/40' : 'border-grafite-elevado')}>
                <p className="text-xs text-nevoa">{ROTULO_DA_FAIXA[f]}</p>
                <p className="font-heading text-xl font-semibold text-branco-cru"><Dinheiro centavos={data.faixas[f].totalCents} /></p>
                <p className="text-[11px] text-nevoa">{data.faixas[f].quantidade} {data.faixas[f].quantidade === 1 ? 'lançamento' : 'lançamentos'}</p>
              </div>
            ))}
          </section>
          <section aria-label="Maiores saldos em aberto" className="space-y-2">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">{kind === 'receita' ? 'Quem mais deve' : 'A quem mais se deve'}</h3>
            <Tabela legenda="Maiores saldos em aberto">
              <thead><tr><th className={TH}>Cadastro ou cedente</th><th className={TH_DIREITA}>Lançamentos</th><th className={TH_DIREITA}>Em aberto</th><th className={TH_DIREITA}>Já vencido</th></tr></thead>
              <tbody>
                {data.maiores.map((m) => (
                  <tr key={m.nome} className="border-t border-grafite-elevado/60">
                    <td className={TD}>{m.nome}</td>
                    <td className={`${TD} text-right tabular-nums text-nevoa`}>{m.quantidade}</td>
                    <td className={`${TD} text-right`}><Dinheiro centavos={m.totalCents} /></td>
                    <td className={`${TD} text-right`}>{m.vencidoCents > 0 ? <Dinheiro centavos={m.vencidoCents} className="text-red-500" /> : <span className="text-nevoa">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </section>
        </>
      )}
      <ExportarCsv />
    </div>
  );
}
