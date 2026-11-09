'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkMember, WorkStatus, WorkTaskWire } from '@/hooks/use-work';
import { LogoDoCliente, nomeLimpo, useListIndex } from './cliente';
import { ListView, type TaskActions } from './list-view';

/**
 * As tarefas de uma pessoa em todas as listas, divididas por cliente (a lista) e, dentro de cada um, por status —
 * a visão que o ClickUp mostra ao filtrar por responsável (pedido do Pedro, 29/10/2026: "ver as demandas de outros
 * usuários"). Cada cliente é a ListView de sempre com a própria lista: adicionar tarefa ali cai no cliente certo.
 */
export function PorCliente({ tarefas, statuses, membros, actions, onNovoStatus, expandirTudo, arquivadas, selecionadas, onSelecionadas }: {
  tarefas: WorkTaskWire[]; statuses: WorkStatus[]; membros: WorkMember[]; actions: TaskActions; onNovoStatus: (nome: string) => void;
  expandirTudo: boolean; arquivadas: boolean; selecionadas: Set<string>; onSelecionadas: (s: Set<string>) => void;
}) {
  const listas = useListIndex();
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const grupos = useMemo(() => {
    const porLista = new Map<string, WorkTaskWire[]>();
    for (const t of tarefas) porLista.set(t.listId, [...(porLista.get(t.listId) ?? []), t]);
    return [...porLista.entries()]
      .map(([listId, itens]) => ({ listId, itens, info: listas.get(listId) }))
      .sort((a, b) => nomeLimpo(a.info?.nome ?? '').localeCompare(nomeLimpo(b.info?.nome ?? ''), 'pt-BR'));
  }, [tarefas, listas]);

  if (grupos.length === 0) return <p className="rounded-xl border border-grafite-elevado px-4 py-8 text-center text-sm text-nevoa">Nenhuma tarefa com esses filtros.</p>;
  return (
    <div className="space-y-4">
      {grupos.map(({ listId, itens, info }) => {
        const fechado = fechados.has(listId);
        const nome = nomeLimpo(info?.nome ?? 'Lista');
        return (
          <section key={listId} aria-label={`Cliente ${nome}`} className="rounded-xl border border-grafite-elevado p-3">
            <div className="mb-2 flex items-center gap-2">
              <button type="button" aria-expanded={!fechado} onClick={() => setFechados((f) => { const n = new Set(f); if (n.has(listId)) n.delete(listId); else n.add(listId); return n; })} className="flex min-w-0 items-center gap-2 text-left">
                {fechado ? <ChevronRight size={16} className="text-nevoa" /> : <ChevronDown size={16} className="text-nevoa" />}
                <LogoDoCliente nome={nome} className="!size-6" />
                <span className="min-w-0">
                  {info && <span className="block truncate text-[11px] text-nevoa">{info.espaco}{info.pasta ? ` / ${info.pasta}` : ''}</span>}
                  <span className="block truncate font-heading text-base font-semibold text-branco-cru">{nome}</span>
                </span>
              </button>
              <span className="rounded-full bg-grafite-elevado px-2 py-0.5 text-xs tabular-nums text-nevoa">{itens.length}</span>
            </div>
            {!fechado && (
              <ListView tarefas={itens} statuses={statuses} membros={membros} listId={listId} actions={actions} onNovoStatus={onNovoStatus}
                expandirTudo={expandirTudo} arquivadas={arquivadas} agrupar comNovoStatus={false} selecionadas={selecionadas} onSelecionadas={onSelecionadas} />
            )}
          </section>
        );
      })}
    </div>
  );
}
