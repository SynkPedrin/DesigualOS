'use client';

import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Aviso, AvisoHistoricoParcial, CAMPO, Carregando, Dinheiro, TD, TH, TH_DIREITA, Tabela, Vazio } from '@/components/gestao-empresarial/kit';
import { useResultado, type LinhaDeCategoria } from '@/hooks/use-gestao-relatorios';
import { hojeIso } from '@/lib/gestao-empresarial/formato';

function Bloco({ titulo, linhas, total }: { titulo: string; linhas: LinhaDeCategoria[]; total: number }) {
  return (
    <section aria-label={titulo} className="space-y-2">
      <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">{titulo}</h3>
      {linhas.length === 0 ? <p className="rounded-lg border border-dashed border-grafite-elevado px-4 py-6 text-sm text-nevoa">Nenhum lançamento no período.</p> : (
        <Tabela legenda={titulo}>
          <thead><tr><th className={TH}>Categoria</th><th className={TH_DIREITA}>Lançamentos</th><th className={TH_DIREITA}>Total</th></tr></thead>
          <tbody>
            {linhas.map((l) => <tr key={l.categoria} className="border-t border-grafite-elevado/60"><td className={TD}>{l.categoria}</td><td className={`${TD} text-right tabular-nums text-nevoa`}>{l.quantidade}</td><td className={`${TD} text-right`}><Dinheiro centavos={l.totalCents} /></td></tr>)}
            <tr className="border-t border-grafite-elevado bg-grafite-elevado/40 font-medium"><td className={TD}>Total</td><td /><td className={`${TD} text-right`}><Dinheiro centavos={total} /></td></tr>
          </tbody>
        </Tabela>
      )}
    </section>
  );
}

export default function ResultadoPage() {
  const hoje = hojeIso();
  const [de, setDe] = useState(`${hoje.slice(0, 4)}-01-01`);
  const [ate, setAte] = useState(hoje);
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate) && de <= ate;
  const { data, isPending, isError, refetch } = useResultado(de, ate);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-nevoa">De<input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className={`${CAMPO} mt-1`} /></label>
        <label className="text-xs text-nevoa">Até<input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className={`${CAMPO} mt-1`} /></label>
        <p className="max-w-md pb-2 text-xs text-nevoa">Resultado por competência. Lançamentos cancelados nunca entram.</p>
      </div>
      {!valido ? <Aviso tom="erro">A data inicial precisa ser anterior ou igual à final.</Aviso> : isPending ? <Carregando /> : isError || !data ? <InlineSectionError message="Não conseguimos carregar o resultado." onRetry={() => void refetch()} /> : (
        <>
          {data.historicoParcial && <AvisoHistoricoParcial />}
          {data.receitas.length + data.despesas.length === 0 ? <Vazio titulo="Sem lançamentos no período">Ajuste as datas ou lance receitas e despesas para ver o resultado.</Vazio> : (
            <>
              <section aria-label="Resultado do período" className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-grafite-elevado bg-grafite p-3"><p className="text-xs text-nevoa">Receitas</p><p className="font-heading text-2xl font-semibold text-branco-cru"><Dinheiro centavos={data.receitaTotalCents} /></p></div>
                <div className="rounded-xl border border-grafite-elevado bg-grafite p-3"><p className="text-xs text-nevoa">Despesas</p><p className="font-heading text-2xl font-semibold text-branco-cru"><Dinheiro centavos={data.despesaTotalCents} /></p></div>
                <div className="rounded-xl border border-grafite-elevado bg-grafite p-3"><p className="text-xs text-nevoa">Resultado</p><p className="font-heading text-2xl font-semibold text-branco-cru"><Dinheiro centavos={data.resultadoCents} /></p>{data.historicoParcial && <p className="text-[11px] text-nevoa">Não é lucro: faltam despesas.</p>}</div>
              </section>
              <div className="grid gap-5 lg:grid-cols-2">
                <Bloco titulo="Receitas por categoria" linhas={data.receitas} total={data.receitaTotalCents} />
                <Bloco titulo="Despesas por categoria" linhas={data.despesas} total={data.despesaTotalCents} />
              </div>
              {data.lancamentosPorVencimento > 0 && <p className="text-xs text-nevoa">{data.lancamentosPorVencimento} {data.lancamentosPorVencimento === 1 ? 'lançamento não tem' : 'lançamentos não têm'} data de competência e foram contados pela data de vencimento.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
