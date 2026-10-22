'use client';

import { useState } from 'react';
import { Archive, FolderPlus, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useCreateList, useCreateSpace, type WorkTreeSpace } from '@/hooks/use-work';
import { useContainerActions, useMoveTask } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';
import { LogoDoCliente, nomeLimpo } from './cliente';
import { Popover } from './primitivas';

const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-branco-cru hover:bg-grafite-elevado';
export const TASK_DRAG = 'application/x-work-task';

function NovoNome({ placeholder, onSubmit, busy }: { placeholder: string; onSubmit: (nome: string) => void; busy?: boolean }) {
  const [nome, setNome] = useState('');
  return (
    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (nome.trim()) { onSubmit(nome.trim()); setNome(''); } }}>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru placeholder:text-nevoa/50" />
      <button type="submit" disabled={busy || !nome.trim()} aria-label={`Criar: ${placeholder}`} className="rounded bg-grafite-elevado px-2 text-nevoa hover:text-branco-cru disabled:opacity-40"><Plus size={14} /></button>
    </form>
  );
}

/** Menu ⋯ de um espaço/pasta/lista: renomear, arquivar/restaurar e (só do que já está arquivado) excluir de vez. */
function MenuDoItem({ kind, id, nome, arquivado }: { kind: 'space' | 'folder' | 'list'; id: string; nome: string; arquivado: boolean }) {
  const { renomear, arquivar, excluir } = useContainerActions();
  const erro = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível concluir.', 'error');
  const rotulo = kind === 'space' ? 'espaço' : kind === 'folder' ? 'pasta' : 'lista';
  return (
    <Popover label={`Opções de ${nome}`} align="right" trigger={<MoreHorizontal size={14} className="text-nevoa" />}>
      {(fechar) => (
        <>
          <button type="button" className={item} onClick={() => { fechar(); const n = window.prompt(`Novo nome do(a) ${rotulo}`, nome); if (n?.trim() && n.trim() !== nome) renomear.mutate({ kind, id, name: n.trim() }, { onError: erro }); }}><Pencil size={12} /> Renomear</button>
          <button type="button" className={item} onClick={() => { fechar(); arquivar.mutate({ kind, id, arquivar: !arquivado }, { onError: erro, onSuccess: () => toast(arquivado ? 'Restaurado.' : 'Arquivado — dá para restaurar em "Mostrar arquivados".', 'success') }); }}>{arquivado ? <><RotateCcw size={12} /> Restaurar</> : <><Archive size={12} /> Arquivar</>}</button>
          {arquivado && <button type="button" className={cn(item, 'text-red-400')} onClick={() => { fechar(); if (window.confirm(`Excluir DEFINITIVAMENTE o(a) ${rotulo} "${nome}" e tudo que está dentro dele(a)? Não dá para desfazer.`)) excluir.mutate({ kind, id }, { onError: erro, onSuccess: () => toast('Excluído.', 'success') }); }}><Trash2 size={12} /> Excluir definitivamente</button>}
        </>
      )}
    </Popover>
  );
}

function ListaBtn({ l, ativa, onClick }: { l: WorkTreeSpace['lists'][number]; ativa: boolean; onClick: () => void }) {
  const mover = useMoveTask();
  const [sobre, setSobre] = useState(false);
  return (
    <li
      className={cn('group flex items-center rounded', sobre && 'ring-1 ring-sinal', l.archived && 'opacity-60')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(TASK_DRAG)) { e.preventDefault(); setSobre(true); } }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        setSobre(false);
        const id = e.dataTransfer.getData(TASK_DRAG);
        if (!id) return;
        e.preventDefault();
        mover.mutate({ id, listId: l.id }, { onSuccess: () => toast(`Movida para "${l.name}".`, 'success'), onError: (er) => toast(er instanceof ApiRequestError ? er.message : 'Não foi possível mover.', 'error') });
      }}
    >
      <button type="button" onClick={onClick} title={l.name} className={cn('min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs', ativa ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5"><LogoDoCliente nome={nomeLimpo(l.name)} className="!size-4" /><span className="truncate">{l.name}</span></span>
          {l.openTaskCount > 0 && <span className="shrink-0 text-[10px] text-nevoa/60">{l.openTaskCount}</span>}
        </span>
      </button>
      <span className="invisible shrink-0 group-hover:visible"><MenuDoItem kind="list" id={l.id} nome={l.name} arquivado={l.archived} /></span>
    </li>
  );
}

export function Arvore({ spaces, listId, spaceId, onPick, arquivados, onArquivados }: { spaces: WorkTreeSpace[]; listId: string | null; spaceId: string | null; onPick: (listId: string | null, spaceId: string) => void; arquivados: boolean; onArquivados: (v: boolean) => void }) {
  const criarEspaco = useCreateSpace();
  const criarLista = useCreateList();
  const { criarPasta } = useContainerActions();
  return (
    <Surface className="max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/60">Espaços e listas</p>
        <label className="flex items-center gap-1 text-[10px] text-nevoa"><input type="checkbox" checked={arquivados} onChange={(e) => onArquivados(e.target.checked)} /> arquivados</label>
      </div>
      {spaces.map((s) => {
        const aberto = s.id === spaceId;
        const soltas = s.lists.filter((l) => !l.folderId);
        return (
          <div key={s.id} className={cn('space-y-1', s.archived && 'opacity-60')}>
            <div className="group flex items-center">
              <button type="button" onClick={() => onPick(null, s.id)} aria-expanded={aberto} className={cn('min-w-0 flex-1 truncate text-left text-sm font-semibold', aberto ? 'text-branco-cru' : 'text-nevoa')}>
                {aberto ? '▾' : '▸'} {s.name} <span className="font-normal text-nevoa/50">{s.lists.length}</span>
              </button>
              <span className="invisible shrink-0 group-hover:visible"><MenuDoItem kind="space" id={s.id} nome={s.name} arquivado={s.archived} /></span>
            </div>
            {aberto && (
              <div className="space-y-2 pl-2">
                {s.folders.map((f) => {
                  const dela = s.lists.filter((l) => l.folderId === f.id);
                  if (dela.length === 0 && !arquivados) return null;
                  return (
                    <div key={f.id} className={cn(f.archived && 'opacity-60')}>
                      <div className="group flex items-center">
                        <p className="min-w-0 flex-1 truncate px-2 text-[11px] font-medium uppercase tracking-wide text-nevoa/60" title={f.name}>{f.name}</p>
                        <span className="invisible shrink-0 group-hover:visible"><MenuDoItem kind="folder" id={f.id} nome={f.name} arquivado={f.archived} /></span>
                      </div>
                      <ul className="space-y-0.5">{dela.map((l) => <ListaBtn key={l.id} l={l} ativa={listId === l.id} onClick={() => onPick(l.id, s.id)} />)}</ul>
                    </div>
                  );
                })}
                {soltas.length > 0 && <ul className="space-y-0.5">{soltas.map((l) => <ListaBtn key={l.id} l={l} ativa={listId === l.id} onClick={() => onPick(l.id, s.id)} />)}</ul>}
                <NovoNome placeholder="Nova lista" busy={criarLista.isPending} onSubmit={(name) => criarLista.mutate({ spaceId: s.id, name })} />
                <button type="button" onClick={() => { const n = window.prompt('Nome da nova pasta'); if (n?.trim()) criarPasta.mutate({ spaceId: s.id, name: n.trim() }); }} className="flex items-center gap-1 px-1 text-[11px] text-nevoa hover:text-branco-cru"><FolderPlus size={12} /> Nova pasta</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="border-t border-grafite-elevado pt-2"><NovoNome placeholder="Novo espaço" busy={criarEspaco.isPending} onSubmit={(n) => criarEspaco.mutate(n)} /></div>
    </Surface>
  );
}
