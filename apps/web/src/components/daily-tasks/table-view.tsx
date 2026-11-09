'use client';

import { useMemo, useState } from 'react';
import type { WorkMember, WorkStatus, WorkTaskWire } from '@/hooks/use-work';
import { useColunas, type TaskActions } from './list-view';
import { andamento, BarraDeProgresso } from './ui';
import { AssigneePicker, DuePicker, PriorityPicker, StatusPicker } from './pickers';
import { LogoDoCliente, nomeLimpo, useListIndex } from './cliente';
import { formatarData } from './primitivas';

type Col = 'title' | 'due' | 'priority' | 'updated';

/** Tabela plana: todas as tarefas numa grade ordenável, com os mesmos editores da lista. */
export function TableView({ tarefas, statuses, membros, actions }: { tarefas: WorkTaskWire[]; statuses: WorkStatus[]; membros: WorkMember[]; actions: TaskActions }) {
  const listas = useListIndex();
  const { colunas } = useColunas();
  const tem = (c: Parameters<typeof colunas.includes>[0]) => colunas.includes(c);
  const [col, setCol] = useState<Col>('title');
  const [asc, setAsc] = useState(true);
  const [visiveis, setVisiveis] = useState(200);
  const ordenadas = useMemo(() => {
    const v = (t: WorkTaskWire) => (col === 'title' ? t.title.toLowerCase() : col === 'due' ? (t.dueAt ?? '9999') : col === 'priority' ? (t.priority === 0 ? 9 : t.priority) : (t.startAt ?? ''));
    return [...tarefas].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * (asc ? 1 : -1));
  }, [tarefas, col, asc]);
  const th = (c: Col, nome: string) => (
    <th scope="col" className="px-3 py-2 text-left font-medium"><button type="button" onClick={() => { if (col === c) setAsc(!asc); else { setCol(c); setAsc(true); } }} className="hover:text-branco-cru">{nome}{col === c ? (asc ? ' ↑' : ' ↓') : ''}</button></th>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-grafite-elevado">
      <table className="w-full text-sm">
        <thead className="bg-grafite text-[11px] text-nevoa">
          <tr><th className="px-3 py-2 text-left font-medium">ID</th>{th('title', 'Nome')}{tem('cliente') && <th className="px-3 py-2 text-left font-medium">Lista / cliente</th>}{tem('status') && <th className="px-3 py-2 text-left font-medium">Status</th>}{tem('andamento') && <th className="px-3 py-2 text-left font-medium">Andamento</th>}{tem('responsavel') && <th className="px-3 py-2 text-left font-medium">Responsável</th>}{tem('prazo') && th('due', 'Vencimento')}{tem('prioridade') && th('priority', 'Prioridade')}{tem('tags') && <th className="px-3 py-2 text-left font-medium">Tags</th>}</tr>
        </thead>
        <tbody>
          {ordenadas.slice(0, visiveis).map((t) => (
            <tr key={t.id} className="border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40">
              <td className="px-3 py-1.5 font-mono text-[11px] text-nevoa">{t.key}</td>
              <td className="max-w-[28rem] px-3 py-1.5"><button type="button" onClick={() => actions.abrir(t)} className="truncate text-left text-branco-cru hover:underline">{t.title}</button></td>
              {tem('cliente') && <td className="px-3 py-1.5"><span className="flex items-center gap-1.5 text-xs text-nevoa"><LogoDoCliente nome={nomeLimpo(listas.get(t.listId)?.nome ?? '')} />{listas.get(t.listId)?.nome ?? ''}</span></td>}
              {tem('status') && <td className="px-3 py-1.5"><StatusPicker tarefa={t} statuses={statuses} onChange={(statusId) => actions.atualizar(t, { statusId })} /></td>}
              {tem('andamento') && <td className="px-3 py-1.5"><BarraDeProgresso pct={andamento(t)} /></td>}
              {tem('responsavel') && <td className="px-3 py-1.5"><AssigneePicker tarefa={t} membros={membros} onChange={(ids) => actions.atualizar(t, { assigneeIds: ids })} /></td>}
              {tem('prazo') && <td className="px-3 py-1.5" title={formatarData(t.dueAt)}><DuePicker tarefa={t} onChange={(iso) => actions.atualizar(t, { dueAt: iso })} /></td>}
              {tem('prioridade') && <td className="px-3 py-1.5"><PriorityPicker tarefa={t} onChange={(p) => actions.atualizar(t, { priority: p })} /></td>}
              {tem('tags') && <td className="px-3 py-1.5 text-xs text-nevoa">{t.tags.slice(0, 3).join(', ')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {ordenadas.length > visiveis && <button type="button" onClick={() => setVisiveis((n) => n + 200)} className="w-full border-t border-grafite-elevado px-3 py-2 text-xs text-nevoa hover:text-branco-cru">Mostrar mais ({visiveis} de {ordenadas.length})</button>}
    </div>
  );
}
