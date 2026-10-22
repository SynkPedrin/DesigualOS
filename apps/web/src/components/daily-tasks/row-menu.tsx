'use client';

import { Archive, ArrowRightLeft, Copy, ExternalLink, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useWorkTree, type WorkTaskWire } from '@/hooks/use-work';
import { useMoveTask, useTaskArchiveActions, useTemplateActions } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';
import { Popover } from './primitivas';

const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-branco-cru hover:bg-grafite-elevado';

/** Menu ⋯ da tarefa: abrir, duplicar, mover de lista (mudar de pipeline), arquivar/restaurar e excluir de vez (só arquivada). */
export function RowMenu({ t, onOpen, onDone }: { t: Pick<WorkTaskWire, 'id' | 'key' | 'title' | 'listId' | 'archivedAt'>; onOpen?: () => void; onDone?: (acao: 'moved' | 'archived' | 'deleted') => void }) {
  const arvore = useWorkTree();
  const mover = useMoveTask();
  const { duplicar } = useTemplateActions();
  const { arquivar, excluir } = useTaskArchiveActions();
  const erro = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível concluir.', 'error');
  const arquivada = t.archivedAt !== null;
  return (
    <Popover label={`Opções de ${t.key}`} align="right" trigger={<MoreHorizontal size={15} className="text-nevoa" />}>
      {(fechar) => (
        <div className="min-w-56">
          {onOpen && <button type="button" className={item} onClick={() => { fechar(); onOpen(); }}><ExternalLink size={12} /> Abrir</button>}
          <button type="button" className={item} onClick={() => { fechar(); duplicar.mutate(t.id, { onSuccess: () => toast('Tarefa duplicada.', 'success'), onError: erro }); }}><Copy size={12} /> Duplicar</button>
          <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-nevoa/60"><ArrowRightLeft size={10} className="mr-1 inline" />Mover para a lista</div>
          <div className="max-h-48 overflow-y-auto">
            {(arvore.data?.spaces ?? []).map((s) => (
              <div key={s.id}>
                <p className="truncate px-2 pt-1 text-[10px] text-nevoa/50">{s.name}</p>
                {s.lists.map((l) => (
                  <button key={l.id} type="button" disabled={l.id === t.listId} className={cn(item, l.id === t.listId && 'opacity-40')} onClick={() => { fechar(); mover.mutate({ id: t.id, listId: l.id }, { onSuccess: () => { toast(`Movida para "${l.name}".`, 'success'); onDone?.('moved'); }, onError: erro }); }}>
                    <span className="truncate">{l.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 border-t border-grafite-elevado pt-1">
            <button type="button" className={item} onClick={() => { fechar(); arquivar.mutate({ id: t.id, arquivar: !arquivada }, { onError: erro, onSuccess: () => { toast(arquivada ? 'Tarefa restaurada.' : 'Tarefa arquivada.', 'success'); onDone?.('archived'); } }); }}>{arquivada ? <><RotateCcw size={12} /> Restaurar</> : <><Archive size={12} /> Arquivar</>}</button>
            {arquivada && <button type="button" className={cn(item, 'text-red-400')} onClick={() => { fechar(); if (window.confirm(`Excluir DEFINITIVAMENTE ${t.key} "${t.title}"? Não dá para desfazer.`)) excluir.mutate(t.id, { onError: erro, onSuccess: () => { toast('Tarefa excluída.', 'success'); onDone?.('deleted'); } }); }}><Trash2 size={12} /> Excluir definitivamente</button>}
          </div>
        </div>
      )}
    </Popover>
  );
}
