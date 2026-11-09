'use client';

import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Carregando, Dinheiro, Vazio } from '@/components/gestao-empresarial/kit';
import { SeloDeStatus, rotuloDoStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { useFunil } from '@/hooks/use-gestao-relatorios';

const ORDEM = ['rascunho', 'enviada', 'aprovada', 'recusada', 'expirada', 'cancelada'];

export default function FunilPage() {
  const { data, isPending, isError, refetch } = useFunil();
  if (isPending) return <Carregando />;
  if (isError || !data) return <InlineSectionError message="Não conseguimos carregar o funil comercial." onRetry={() => void refetch()} />;
  const total = Object.values(data).reduce((s, f) => s + f.quantidade, 0);
  if (total === 0) return <Vazio titulo="Nenhuma proposta ainda">O funil mostra quantas propostas estão em cada etapa e quanto valem.</Vazio>;
  const maior = Math.max(...Object.values(data).map((f) => f.totalCents), 1);
  return (
    <section aria-label="Propostas por situação" className="space-y-2">
      <p className="text-xs text-nevoa">{total} {total === 1 ? 'proposta' : 'propostas'} no total. A barra compara o valor de cada etapa.</p>
      <ul className="space-y-2">
        {ORDEM.filter((s) => data[s]).map((s) => {
          const f = data[s]!;
          return (
            <li key={s} className="rounded-lg border border-grafite-elevado bg-grafite p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2"><SeloDeStatus status={s} /><span className="text-sm text-nevoa">{f.quantidade} {f.quantidade === 1 ? 'proposta' : 'propostas'}</span></span>
                <Dinheiro centavos={f.totalCents} className="font-heading text-lg font-semibold text-branco-cru" />
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-grafite-elevado" role="img" aria-label={`${rotuloDoStatus(s)}: ${Math.round((f.totalCents / maior) * 100)}% do maior valor`}><div className="h-full rounded bg-roxo-eletrico" style={{ width: `${Math.max(2, (f.totalCents / maior) * 100)}%` }} /></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
