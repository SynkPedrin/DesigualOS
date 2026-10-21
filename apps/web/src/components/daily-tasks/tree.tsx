'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useCreateList, useCreateSpace, type WorkTreeSpace } from '@/hooks/use-work';
import { cn } from '@/lib/utils';

function NovoNome({ placeholder, onSubmit, busy }: { placeholder: string; onSubmit: (nome: string) => void; busy?: boolean }) {
  const [nome, setNome] = useState('');
  return (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim()) {
          onSubmit(nome.trim());
          setNome('');
        }
      }}
    >
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru placeholder:text-nevoa/50"
      />
      <button type="submit" disabled={busy || !nome.trim()} aria-label={placeholder} className="rounded bg-grafite-elevado px-2 text-nevoa hover:text-branco-cru disabled:opacity-40">
        <Plus size={14} />
      </button>
    </form>
  );
}

function ListaBtn({ nome, ativa, onClick, n }: { nome: string; ativa: boolean; onClick: () => void; n: number }) {
  return (
    <li>
      <button type="button" onClick={onClick} title={nome} className={cn('w-full truncate rounded px-2 py-1 text-left text-xs', ativa ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
        <span className="flex items-center justify-between gap-2"><span className="truncate">{nome}</span>{n > 0 && <span className="shrink-0 text-[10px] text-nevoa/60">{n}</span>}</span>
      </button>
    </li>
  );
}

export function Arvore({ spaces, listId, spaceId, onPick }: { spaces: WorkTreeSpace[]; listId: string | null; spaceId: string | null; onPick: (listId: string | null, spaceId: string) => void }) {
  const criarEspaco = useCreateSpace();
  const criarLista = useCreateList();
  return (
    <Surface className="max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/60">Espaços e listas</p>
      {spaces.map((s) => {
        const aberto = s.id === spaceId;
        const soltas = s.lists.filter((l) => !l.folderId);
        return (
          <div key={s.id} className="space-y-1">
            <button type="button" onClick={() => onPick(null, s.id)} aria-expanded={aberto} className={cn('w-full truncate text-left text-sm font-semibold', aberto ? 'text-branco-cru' : 'text-nevoa')}>
              {aberto ? '▾' : '▸'} {s.name} <span className="font-normal text-nevoa/50">{s.lists.length}</span>
            </button>
            {aberto && (
              <div className="space-y-2 pl-2">
                {s.folders.map((f) => {
                  const dela = s.lists.filter((l) => l.folderId === f.id);
                  return dela.length === 0 ? null : (
                    <div key={f.id}>
                      <p className="truncate px-2 text-[11px] font-medium uppercase tracking-wide text-nevoa/60" title={f.name}>{f.name}</p>
                      <ul className="space-y-0.5">{dela.map((l) => <ListaBtn key={l.id} nome={l.name} ativa={listId === l.id} n={l.openTaskCount} onClick={() => onPick(l.id, s.id)} />)}</ul>
                    </div>
                  );
                })}
                {soltas.length > 0 && <ul className="space-y-0.5">{soltas.map((l) => <ListaBtn key={l.id} nome={l.name} ativa={listId === l.id} n={l.openTaskCount} onClick={() => onPick(l.id, s.id)} />)}</ul>}
                <NovoNome placeholder="Nova lista" busy={criarLista.isPending} onSubmit={(name) => criarLista.mutate({ spaceId: s.id, name })} />
              </div>
            )}
          </div>
        );
      })}
      <div className="border-t border-grafite-elevado pt-2">
        <NovoNome placeholder="Novo espaço" busy={criarEspaco.isPending} onSubmit={(n) => criarEspaco.mutate(n)} />
      </div>
    </Surface>
  );
}

