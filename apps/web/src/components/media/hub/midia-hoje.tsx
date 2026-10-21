'use client';

import Link from 'next/link';
import { ArrowRight, Megaphone } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useMediaHub } from '@/hooks/use-media';
import { dash, int, money } from '../format';
import { DeltaChip } from '../media-charts';

/**
 * MÍDIA NO "HOJE": a mesma leitura da tela de Mídias (últimos 7 dias), em miniatura. Sem o módulo de
 * mídia (403) ou com a API em versão anterior (404) o bloco simplesmente não existe: "Hoje" nunca
 * mostra erro de uma área que a pessoa nem usa.
 */
export function MidiaHojePanel() {
  const hub = useMediaHub('last_7d', true);
  if (hub.isError || (!hub.isPending && !hub.data?.kpis)) return null;
  const h = hub.data;
  const cur = h?.kpis.current;
  const ch = h?.kpis.changes;
  const cc = h?.kpis.currency ?? 'BRL';
  const critical = h?.attention.filter((a) => a.tone === 'critical').length ?? 0;
  return (
    <Surface className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-branco-cru"><Megaphone size={14} className="text-roxo-eletrico" /> Mídia · 7 dias</h2>
        <Link href="/midias" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">Abrir <ArrowRight size={11} /></Link>
      </div>
      {hub.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Investido" value={money(cur?.spend, cc)} delta={ch?.spend} />
            <Mini label="Resultados" value={cur?.results == null ? dash : int(cur.results)} delta={ch?.results} />
            <Mini label="Custo/res." value={money(cur?.costPerResult, cc)} delta={ch?.costPerResult} invert />
          </div>
          {h!.attention.length > 0 ? (
            <ul className="space-y-1">
              {h!.attention.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs text-nevoa">
                  <span className={a.tone === 'critical' ? 'size-1.5 shrink-0 rounded-full bg-erro' : a.tone === 'warning' ? 'size-1.5 shrink-0 rounded-full bg-aviso' : 'size-1.5 shrink-0 rounded-full bg-roxo-eletrico'} />
                  <span className="truncate"><span className="text-branco-cru">{a.title}</span> · {a.detail}</span>
                </li>
              ))}
              {critical > 3 && <li className="text-[11px] text-nevoa">e mais {critical - 3} crítico(s)</li>}
            </ul>
          ) : (
            <p className="text-xs text-nevoa">Nenhuma conta pedindo atenção.</p>
          )}
        </>
      )}
    </Surface>
  );
}

function Mini({ label, value, delta, invert = false }: { label: string; value: string; delta?: number | null | undefined; invert?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-carbono/60 p-2">
      <p className="text-[11px] text-nevoa">{label}</p>
      <p className="truncate font-heading text-sm font-semibold tabular-nums text-branco-cru">{value}</p>
      {delta !== undefined && <DeltaChip value={delta} invert={invert} />}
    </div>
  );
}
