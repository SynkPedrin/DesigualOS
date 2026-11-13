'use client';

import { useState } from 'react';
import { Archive, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useCreateList, type WorkTreeSpace } from '@/hooks/use-work';
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
      className={cn('group flex items-center rounded', sobre && 'ring-1 ring-roxo-eletrico', l.archived && 'opacity-60')}
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
      <button type="button" onClick={onClick} title={l.name} className={cn('min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs', ativa ? 'bg-roxo-eletrico/20 font-medium text-branco-cru ring-1 ring-inset ring-roxo-eletrico/40' : 'text-nevoa hover:bg-grafite-elevado/60 hover:text-branco-cru')}>
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5"><LogoDoCliente nome={nomeLimpo(l.name)} className="!size-4" /><span className="truncate">{l.name}</span></span>
          {l.openTaskCount > 0 && <span className="shrink-0 text-[10px] text-nevoa/60">{l.openTaskCount}</span>}
        </span>
      </button>
      <span className="shrink-0 opacity-40 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><MenuDoItem kind="list" id={l.id} nome={l.name} arquivado={l.archived} /></span>
    </li>
  );
}

type ListaDaArvore = WorkTreeSpace['lists'][number] & { spaceId: string };

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * AS DUAS PASTAS DO DAILY (pedido do Pedro, 13/11/2026): o painel mostra só "Clientes ativos" e "Clientes pontuais".
 * Casa pelo nome exato da pasta (sem diferenciar maiúscula/acento) em qualquer espaço — a pasta "👥 CLIENTES ATIVOS"
 * dos modelos da Citável, com emoji, não entra. O resto (inativos, onboarding, modelos, importados) continua no
 * sistema e aparece na BUSCA, para nenhuma tarefa ficar sem caminho.
 */
export function pastasDoDaily(spaces: WorkTreeSpace[], comArquivadas = false): { ativos: ListaDaArvore[]; pontuais: ListaDaArvore[]; outras: ListaDaArvore[]; pastaDe: Map<string, { spaceId: string; folderId: string }> } {
  const ativos: ListaDaArvore[] = [];
  const pontuais: ListaDaArvore[] = [];
  const outras: ListaDaArvore[] = [];
  const pastaDe = new Map<string, { spaceId: string; folderId: string }>();
  for (const s of spaces) {
    const tipoDaPasta = new Map(s.folders.filter((f) => comArquivadas || !f.archived).map((f) => [f.id, semAcento(f.name)]));
    for (const f of s.folders) {
      const n = semAcento(f.name);
      if ((n === 'clientes ativos' || n === 'clientes pontuais') && !pastaDe.has(n)) pastaDe.set(n, { spaceId: s.id, folderId: f.id });
    }
    for (const l of s.lists) {
      if (l.archived && !comArquivadas) continue;
      const item = { ...l, spaceId: s.id };
      const pasta = l.folderId ? tipoDaPasta.get(l.folderId) : undefined;
      if (pasta === 'clientes ativos') ativos.push(item);
      else if (pasta === 'clientes pontuais') pontuais.push(item);
      else outras.push(item);
    }
  }
  const porNome = (a: ListaDaArvore, b: ListaDaArvore) => nomeLimpo(a.name).localeCompare(nomeLimpo(b.name), 'pt-BR');
  return { ativos: ativos.sort(porNome), pontuais: pontuais.sort(porNome), outras: outras.sort(porNome), pastaDe };
}

function Secao({ titulo, listas, listId, onPick, pasta }: { titulo: string; listas: ListaDaArvore[]; listId: string | null; onPick: (listId: string | null, spaceId: string) => void; pasta?: { spaceId: string; folderId: string } | undefined }) {
  const criarLista = useCreateList();
  const [criando, setCriando] = useState(false);
  return (
    <div>
      <div className="group flex items-center">
        <p className="min-w-0 flex-1 truncate px-2 text-[11px] font-medium uppercase tracking-wide text-nevoa/60">{titulo} <span className="font-normal normal-case tracking-normal text-nevoa/40">{listas.length}</span></p>
        {pasta && <button type="button" onClick={() => setCriando((v) => !v)} aria-label={`Nova lista em ${titulo}`} title="Nova lista" className="shrink-0 rounded p-1 text-nevoa opacity-40 transition-opacity hover:text-branco-cru group-hover:opacity-100 focus-visible:opacity-100"><Plus size={12} /></button>}
      </div>
      {criando && pasta && <div className="mb-1 px-1"><NovoNome placeholder={`Novo cliente em ${titulo.toLowerCase()}`} busy={criarLista.isPending} onSubmit={(name) => criarLista.mutate({ spaceId: pasta.spaceId, folderId: pasta.folderId, name }, { onSuccess: () => setCriando(false) })} /></div>}
      {listas.length === 0 ? <p className="px-2 py-1 text-[11px] text-nevoa/50">Nenhum cliente.</p> : (
        <ul className="space-y-0.5">{listas.map((l) => <ListaBtn key={l.id} l={l} ativa={listId === l.id} onClick={() => onPick(l.id, l.spaceId)} />)}</ul>
      )}
    </div>
  );
}

export function Arvore({ spaces, listId, onPick, arquivados, onArquivados }: { spaces: WorkTreeSpace[]; listId: string | null; spaceId?: string | null; onPick: (listId: string | null, spaceId: string) => void; arquivados: boolean; onArquivados: (v: boolean) => void }) {
  const [busca, setBusca] = useState('');
  const { ativos, pontuais, outras, pastaDe } = pastasDoDaily(spaces, arquivados);
  const termo = semAcento(busca);
  const casa = (l: ListaDaArvore) => semAcento(nomeLimpo(l.name)).includes(termo) || semAcento(l.name).includes(termo);
  const buscando = termo.length > 0;
  const achadosFora = buscando ? outras.filter(casa) : [];
  const ativosVisiveis = buscando ? ativos.filter(casa) : ativos;
  const pontuaisVisiveis = buscando ? pontuais.filter(casa) : pontuais;
  const nada = buscando && !ativosVisiveis.length && !pontuaisVisiveis.length && !achadosFora.length;
  const primeiro = ativosVisiveis[0] ?? pontuaisVisiveis[0] ?? achadosFora[0];
  return (
    <Surface className="max-h-[calc(100vh-12rem)] space-y-3 overflow-y-auto p-2.5">
      <div className="flex items-center justify-between">
        <p className="whitespace-nowrap text-xs font-semibold text-nevoa">Clientes</p>
        <label className="flex items-center gap-1 text-[10px] text-nevoa"><input type="checkbox" checked={arquivados} onChange={(e) => onArquivados(e.target.checked)} /> arquivados</label>
      </div>
      <label className="relative block">
        <Search size={13} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-nevoa/60" />
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          // Enter abre o primeiro cliente achado; Esc limpa.
          onKeyDown={(e) => { if (e.key === 'Enter' && primeiro) { e.preventDefault(); onPick(primeiro.id, primeiro.spaceId); } if (e.key === 'Escape') setBusca(''); }}
          placeholder="Buscar cliente…"
          aria-label="Buscar cliente"
          className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-7 pr-2 text-xs text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/50 focus:outline-none"
        />
      </label>
      {(!buscando || ativosVisiveis.length > 0) && <Secao titulo="Clientes ativos" listas={ativosVisiveis} listId={listId} onPick={onPick} pasta={pastaDe.get('clientes ativos')} />}
      {(!buscando || pontuaisVisiveis.length > 0) && <Secao titulo="Clientes pontuais" listas={pontuaisVisiveis} listId={listId} onPick={onPick} pasta={pastaDe.get('clientes pontuais')} />}
      {achadosFora.length > 0 && <Secao titulo="Em outras pastas" listas={achadosFora} listId={listId} onPick={onPick} />}
      {nada && <p className="px-2 text-xs text-nevoa">Nenhum cliente com “{busca.trim()}”.</p>}
    </Surface>
  );
}
