'use client';

import { useState } from 'react';
import { Copy, Repeat, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { useWorkTree } from '@/hooks/use-work';
import { useRecurrenceActions, useRecurrences, useTemplateActions, useTemplates } from '@/hooks/use-work-extra';

const FREQ: Record<string, string> = { daily: 'dia', weekly: 'semana', monthly: 'mês' };
const sel = 'rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru outline-none';

export default function ModelosPage() {
  const modelos = useTemplates();
  const recs = useRecurrences();
  const tree = useWorkTree();
  const { usar, apagar } = useTemplateActions();
  const { ativar } = useRecurrenceActions();
  const [alvo, setAlvo] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  const listas = (tree.data?.spaces ?? []).flatMap((s) => s.lists.map((l) => ({ id: l.id, rotulo: `${s.name} › ${l.name}` })));
  return (
    <div className="space-y-8">
      {ok && <p role="status" className="text-xs text-sucesso">{ok}</p>}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Modelos de tarefa</h2>
        <p className="text-xs text-nevoa">Abra uma tarefa e use o ícone de disquete para salvá-la como modelo (leva subtarefas e checklists).</p>
        {modelos.isPending ? <Skeleton className="h-24 w-full" /> : (modelos.data?.templates.length ?? 0) === 0 ? <EmptyState icon={Copy} title="Nenhum modelo salvo" /> : (
          <Surface className="divide-y divide-grafite-elevado/60">
            {modelos.data!.templates.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="text-sm text-branco-cru">{m.name}</span>
                <span className="text-xs text-nevoa">{m.subtasks} subtarefas · {m.checklists} checklists</span>
                <select aria-label={`Lista para ${m.name}`} value={alvo[m.id] ?? ''} onChange={(e) => setAlvo({ ...alvo, [m.id]: e.target.value })} className={`${sel} ml-auto max-w-64`}><option value="">Escolha a lista…</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.rotulo}</option>)}</select>
                <button type="button" disabled={!alvo[m.id] || usar.isPending} onClick={() => usar.mutate({ id: m.id, listId: alvo[m.id]! }, { onSuccess: () => setOk(`Tarefa criada a partir de "${m.name}".`) })} className="rounded bg-roxo-eletrico px-2 py-1 text-xs font-semibold text-white disabled:opacity-40">Criar tarefa</button>
                <button type="button" aria-label={`Apagar modelo ${m.name}`} onClick={() => { if (window.confirm(`Apagar o modelo "${m.name}"?`)) apagar.mutate(m.id); }} className="text-nevoa hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </Surface>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Tarefas recorrentes</h2>
        <p className="text-xs text-nevoa">Abra uma tarefa e use o ícone de repetir. A cada ocorrência o sistema cria uma cópia (com subtarefas e checklists) na mesma lista.</p>
        {recs.isPending ? <Skeleton className="h-24 w-full" /> : (recs.data?.recurrences.length ?? 0) === 0 ? <EmptyState icon={Repeat} title="Nenhuma recorrência" /> : (
          <Surface className="divide-y divide-grafite-elevado/60">
            {recs.data!.recurrences.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-[11px] text-nevoa">{r.taskKey}</span><span className="text-branco-cru">{r.taskTitle}</span>
                <span className="text-xs text-nevoa">a cada {r.interval > 1 ? `${r.interval} ` : ''}{FREQ[r.freq]}{r.interval > 1 && r.freq !== 'monthly' ? 's' : r.interval > 1 ? 'es' : ''} · próxima {new Date(r.nextRunAt).toLocaleDateString('pt-BR')}</span>
                <label className="ml-auto flex items-center gap-1 text-xs text-nevoa"><input type="checkbox" checked={r.active} onChange={(e) => ativar.mutate({ id: r.id, active: e.target.checked })} /> Ativa</label>
              </div>
            ))}
          </Surface>
        )}
      </section>
    </div>
  );
}
