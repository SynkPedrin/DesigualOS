'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { PRIORIDADES, useWorkTree } from '@/hooks/use-work';
import { useWorkReport } from '@/hooks/use-work-extra';

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number | string; alerta?: boolean }) {
  return (
    <Surface className="p-3">
      <p className={`font-heading text-2xl font-semibold ${alerta ? 'text-red-400' : 'text-branco-cru'}`}>{valor}</p>
      <p className="text-xs text-nevoa">{rotulo}</p>
    </Surface>
  );
}

function Barra({ pct, cor }: { pct: number; cor: string }) {
  return <div className="h-2 flex-1 overflow-hidden rounded bg-grafite-elevado"><div className="h-full rounded" style={{ width: `${Math.max(2, pct)}%`, background: cor }} /></div>;
}

export default function RelatoriosPage() {
  const tree = useWorkTree();
  const [espaco, setEspaco] = useState<string | null>(null);
  const { data: r, isPending } = useWorkReport(espaco);
  if (isPending || !r) return <Skeleton className="h-96 w-full" />;
  const maxStatus = Math.max(1, ...r.porStatus.map((s) => s.n));
  const maxFluxo = Math.max(1, ...r.fluxo.flatMap((f) => [f.criadas, f.concluidas]));
  const maxResp = Math.max(1, ...r.porResponsavel.map((p) => p.abertas + p.concluidas));
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label htmlFor="esp" className="text-xs text-nevoa">Espaço</label>
        <select id="esp" value={espaco ?? ''} onChange={(e) => setEspaco(e.target.value || null)} className="rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru">
          <option value="">Todos</option>{(tree.data?.spaces ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="ml-auto text-xs text-nevoa">Tarefas de topo (subtarefas não entram na contagem)</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Numero rotulo="Total" valor={r.totais.total} /><Numero rotulo="Abertas" valor={r.totais.abertas} /><Numero rotulo="Concluídas" valor={r.totais.concluidas} />
        <Numero rotulo="Atrasadas" valor={r.totais.atrasadas} alerta={r.totais.atrasadas > 0} /><Numero rotulo="Sem responsável" valor={r.totais.sem_responsavel} /><Numero rotulo="Ciclo médio (90 dias)" valor={r.cicloMedioDias === null ? '—' : `${r.cicloMedioDias} d`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Surface className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-branco-cru">Por status</h2>
          {r.porStatus.map((s) => (<div key={s.name} className="flex items-center gap-2 text-xs"><span className="w-28 truncate text-nevoa">{s.name}</span><Barra pct={(s.n / maxStatus) * 100} cor={s.color} /><span className="w-10 text-right text-branco-cru">{s.n}</span></div>))}
        </Surface>
        <Surface className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-branco-cru">Criadas × concluídas por semana</h2>
          {r.fluxo.map((f) => (
            <div key={f.semana} className="space-y-0.5 text-xs">
              <div className="flex items-center gap-2"><span className="w-20 text-nevoa">{f.semana.slice(5).split('-').reverse().join('/')}</span><Barra pct={(f.criadas / maxFluxo) * 100} cor="#3b82f6" /><span className="w-8 text-right text-branco-cru">{f.criadas}</span></div>
              <div className="flex items-center gap-2"><span className="w-20" /><Barra pct={(f.concluidas / maxFluxo) * 100} cor="#10b981" /><span className="w-8 text-right text-branco-cru">{f.concluidas}</span></div>
            </div>
          ))}
          <p className="text-[11px] text-nevoa"><span className="text-[#3b82f6]">■</span> criadas · <span className="text-[#10b981]">■</span> concluídas</p>
        </Surface>
        <Surface className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-branco-cru">Carga por pessoa</h2>
          {r.porResponsavel.length === 0 && <p className="text-xs text-nevoa">Ninguém com tarefas atribuídas.</p>}
          {r.porResponsavel.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs"><span className="w-32 truncate text-nevoa">{p.name}</span><Barra pct={((p.abertas + p.concluidas) / maxResp) * 100} cor="#7c3aed" /><span className="w-28 text-right text-branco-cru">{p.abertas} abertas{p.atrasadas > 0 && <span className="text-red-400"> · {p.atrasadas} atras.</span>}</span></div>
          ))}
        </Surface>
        <Surface className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-branco-cru">Abertas por prioridade · tempo registrado (30 dias)</h2>
          {r.porPrioridade.map((p) => (<div key={p.priority} className="flex items-center justify-between text-xs"><span style={{ color: PRIORIDADES[p.priority]?.color || undefined }} className="text-nevoa">{PRIORIDADES[p.priority]?.label ?? p.priority}</span><span className="text-branco-cru">{p.n}</span></div>))}
          <div className="border-t border-grafite-elevado pt-2">
            {r.tempoPorPessoa30d.length === 0 ? <p className="text-xs text-nevoa">Nenhum tempo registrado ainda.</p> : r.tempoPorPessoa30d.map((t) => (<div key={t.name} className="flex justify-between text-xs"><span className="text-nevoa">{t.name}</span><span className="text-branco-cru">{t.horas} h</span></div>))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
