'use client';

import { Surface } from './surface';
import { Skeleton } from './skeleton';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  accent = false,
  formatValue = (v) => Math.round(v).toLocaleString('pt-BR'),
  isLoading = false,
  isError = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  formatValue?: (value: number) => string;
  isLoading?: boolean;
  /** Fetch falhou pra essa métrica: mostra um indicador discreto no lugar do número em vez
   * de cair silenciosamente em "0" (que parece um dado real, só que errado). */
  isError?: boolean;
}) {
  const animated = useCountUp(isLoading ? 0 : value);

  return (
    <Surface level="grafite" className="p-4">
      {/* Sem selo da marca aqui: ele era IDÊNTICO nos quatro cards lado a
        * lado, o que fazia a fileira inteira parecer card duplicado sem
        * acrescentar informação nenhuma. O que distingue um card do outro é
        * o rótulo e o número. */}
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">{label}</p>
      {isLoading ? (
        <Skeleton className="h-8 w-24" />
      ) : isError ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-erro" title="Não foi possível carregar essa métrica.">
          <span className="size-1.5 shrink-0 rounded-full bg-erro" />
          Falha ao carregar
        </p>
      ) : (
        <p
          className={cn(
            'font-display text-3xl font-black tabular-nums',
            accent ? 'text-sinal' : 'text-branco-cru',
          )}
        >
          {formatValue(animated)}
        </p>
      )}
    </Surface>
  );
}
