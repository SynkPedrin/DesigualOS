'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { useIsMaster } from '@/hooks/use-is-master';
import { useCreateStatus, useSpaceStatuses, useWorkMembers, useWorkTree, type WorkStatus } from '@/hooks/use-work';
import { useCreateCustomField, useCustomFields, useLinkListToClient, useSavedViewActions, useSavedViews } from '@/hooks/use-work-extra';
import { useClients } from '@/hooks/use-clients';
import { LogoDoCliente, nomeLimpo } from '@/components/daily-tasks/cliente';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';
import { apiFetch, ApiRequestError } from '@/lib/api/client';

const CATEGORIAS: Record<string, string> = { todo: 'A fazer', active: 'Em andamento', review: 'Revisão', blocked: 'Bloqueado', done: 'Concluído', cancelled: 'Cancelado' };
const TIPOS: Record<string, string> = { text: 'Texto', number: 'Número', date: 'Data', drop_down: 'Lista de opções', checkbox: 'Caixa de seleção', url: 'Link', currency: 'Valor em R$' };
const campo = 'rounded border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru outline-none';
const json = (method: string, body?: unknown): RequestInit => (body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

function LinhaStatus({ s, todos, onErro }: { s: WorkStatus; todos: WorkStatus[]; onErro: (m: string | null) => void }) {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: ['work'] });
  const [nome, setNome] = useState(s.name);
  const salvar = useMutation({ mutationFn: (b: Record<string, unknown>) => apiFetch(`/work/statuses/${s.id}`, json('PATCH', b)), onSuccess: refrescar, onError: (e) => onErro(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.') });
  const apagar = useMutation({
    mutationFn: (migrar: string) => apiFetch(`/work/statuses/${s.id}?migrate_to=${migrar}`, json('DELETE')),
    onSuccess: refrescar, onError: (e) => onErro(e instanceof ApiRequestError ? e.message : 'Não foi possível apagar.'),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <input type="color" aria-label={`Cor de ${s.name}`} value={s.color.length === 7 ? s.color : '#6b7280'} onChange={(e) => salvar.mutate({ color: e.target.value })} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
      <input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={() => { if (nome.trim() && nome !== s.name) salvar.mutate({ name: nome.trim() }); }} aria-label={`Nome do status ${s.name}`} className={`${campo} w-48`} />
      <select value={s.category} aria-label={`Categoria de ${s.name}`} onChange={(e) => salvar.mutate({ category: e.target.value })} className={campo}>{Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {s.isInitial && <span className="text-[11px] text-nevoa">inicial</span>}
      <button type="button" aria-label={`Apagar status ${s.name}`} onClick={() => {
        const destino = todos.find((x) => x.id !== s.id && x.isInitial) ?? todos.find((x) => x.id !== s.id);
        if (destino && window.confirm(`Apagar "${s.name}"? As tarefas desse status vão para "${destino.name}".`)) apagar.mutate(destino.id);
      }} className="ml-auto text-nevoa hover:text-red-400"><Trash2 size={14} /></button>
    </div>
  );
}


function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\[[^\]]*\]/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Liga cada lista ao cliente dela. É daqui que a tarefa nasce já com o cliente e que os cruzamentos funcionam. */
function ListasEClientes() {
  const tree = useWorkTree();
  const clientes = useClients().data ?? [];
  const vincular = useLinkListToClient();
  const [busca, setBusca] = useState('');
  const todas = (tree.data?.spaces ?? []).flatMap((sp) => sp.lists.map((l) => ({ ...l, espaco: sp.name, pasta: sp.folders.find((f) => f.id === l.folderId)?.name ?? null })));
  const lista = todas.filter((l) => !busca.trim() || l.name.toLowerCase().includes(busca.toLowerCase()));
  const porNome = new Map(clientes.map((c) => [normalizar(c.name), c]));
  const sugestoes = todas.filter((l) => !l.clientId && porNome.has(normalizar(l.name)));
  const semCliente = todas.filter((l) => !l.clientId).length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-xl font-semibold text-branco-cru">Listas e clientes</h2>
          <p className="text-sm text-nevoa">Toda tarefa criada numa lista do cliente já nasce com o cliente — e as subtarefas herdam. {semCliente} lista(s) ainda sem cliente.</p>
        </div>
        <button type="button" disabled={sugestoes.length === 0 || vincular.isPending} onClick={async () => { if (!window.confirm(`Vincular ${sugestoes.length} lista(s) ao cliente de MESMO NOME? (só nome igual, nada aproximado)`)) return; for (const l of sugestoes) await vincular.mutateAsync({ listId: l.id, clientId: porNome.get(normalizar(l.name))!.id }); toast(`${sugestoes.length} lista(s) vinculada(s).`, 'success'); }} className="rounded-lg bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Vincular as {sugestoes.length} de nome igual</button>
      </div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lista…" aria-label="Buscar lista" className="w-72 rounded-lg border border-grafite-elevado bg-carbono px-3 py-1.5 text-sm text-branco-cru outline-none" />
      <div className="overflow-hidden rounded-xl border border-grafite-elevado">
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_70px] gap-3 border-b border-grafite-elevado px-4 py-2 text-[11px] uppercase tracking-wide text-nevoa"><span>Lista</span><span>Onde está</span><span>Cliente</span><span className="text-right">Abertas</span></div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {lista.map((l) => (
            <li key={l.id} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_70px] items-center gap-3 border-b border-grafite-elevado/60 px-4 py-2 last:border-0">
              <span className="flex min-w-0 items-center gap-2 text-sm text-branco-cru"><LogoDoCliente nome={nomeLimpo(l.name)} className="!size-5" /><span className="truncate">{l.name}</span></span>
              <span className="truncate text-xs text-nevoa">{l.espaco}{l.pasta ? ` › ${l.pasta}` : ''}</span>
              <select aria-label={`Cliente da lista ${l.name}`} value={l.clientId ?? ''} onChange={(e) => vincular.mutate({ listId: l.id, clientId: e.target.value || null }, { onSuccess: () => toast('Vínculo salvo.', 'success'), onError: () => toast('Não foi possível vincular.', 'error') })} className={campo}>
                <option value="">Sem cliente</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className="text-right text-sm tabular-nums text-nevoa">{l.openTaskCount}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Flag() {
  const qc = useQueryClient();
  const flag = useQuery({ queryKey: ['work', 'flag'], queryFn: () => apiFetch<{ enabled: boolean; allowedUserIds: string[] }>('/work/admin/flag') });
  const membros = useWorkMembers().data?.members ?? [];
  const salvar = useMutation({ mutationFn: (b: { enabled: boolean; allowedUserIds: string[] }) => apiFetch('/work/admin/flag', json('PUT', b)), onSuccess: () => qc.invalidateQueries({ queryKey: ['work'] }) });
  if (!flag.data) return <Skeleton className="h-24 w-full" />;
  const f = flag.data;
  return (
    <Surface className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-branco-cru">Quem pode usar o Daily Tasks</h2>
      <label className="flex items-center gap-2 text-sm text-branco-cru"><input type="checkbox" checked={f.enabled} onChange={(e) => salvar.mutate({ enabled: e.target.checked, allowedUserIds: f.allowedUserIds })} /> Daily Tasks ligado para os administradores desta empresa</label>
      <p className="text-xs text-nevoa">Ligado = TODOS os administradores da empresa enxergam o Daily Tasks (colaboradores comuns nunca enxergam). Se quiser restringir a algumas pessoas, marque-as abaixo: com alguém marcado, só essas pessoas (que sejam administradoras) entram. Desligar esconde o módulo para todos, sem apagar nenhum dado.</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {membros.map((m) => {
          const marcado = f.allowedUserIds.includes(m.id);
          return <li key={m.id}><label className="flex items-center gap-2 text-sm text-branco-cru"><input type="checkbox" checked={marcado} onChange={() => salvar.mutate({ enabled: f.enabled, allowedUserIds: marcado ? f.allowedUserIds.filter((x) => x !== m.id) : [...f.allowedUserIds, m.id] })} />{m.name} <span className="text-xs text-nevoa">({m.role})</span></label></li>;
        })}
      </ul>
    </Surface>
  );
}

export default function ConfiguracoesPage() {
  const { isMaster } = useIsMaster();
  const tree = useWorkTree();
  const [espaco, setEspaco] = useState<string | null>(null);
  const spaces = tree.data?.spaces ?? [];
  const ativo = espaco ?? spaces.find((s) => s.lists.length > 0)?.id ?? spaces[0]?.id ?? null;
  const statuses = useSpaceStatuses(ativo).data?.statuses ?? [];
  const ordenados = useMemo(() => [...statuses].sort((a, b) => a.position - b.position), [statuses]);
  const criarStatus = useCreateStatus(ativo);
  const campos = useCustomFields(ativo);
  const criarCampo = useCreateCustomField(ativo);
  const views = useSavedViews();
  const { apagar: apagarView } = useSavedViewActions();
  const [novoStatus, setNovoStatus] = useState('');
  const [campoNome, setCampoNome] = useState('');
  const [campoTipo, setCampoTipo] = useState('text');
  const [campoOpcoes, setCampoOpcoes] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const [secao, setSecao] = useState<'listas' | 'status' | 'campos' | 'visoes' | 'acesso'>('listas');
  const secoes = [{ id: 'listas', rotulo: 'Listas e clientes' }, { id: 'status', rotulo: 'Status' }, { id: 'campos', rotulo: 'Campos personalizados' }, { id: 'visoes', rotulo: 'Visões salvas' }, ...(isMaster ? [{ id: 'acesso', rotulo: 'Quem pode usar' }] : [])] as const;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-branco-cru">Configurações</h1>
        <p className="text-sm text-nevoa">Como o Daily Tasks se organiza: clientes e listas, status, campos, visões e acesso.</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Seções" className="flex gap-1 lg:flex-col">
          {secoes.map((x) => <button key={x.id} type="button" aria-current={secao === x.id} onClick={() => setSecao(x.id as typeof secao)} className={cn('rounded-lg px-3 py-2 text-left text-sm', secao === x.id ? 'bg-roxo-eletrico font-medium text-white' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru')}>{x.rotulo}</button>)}
        </nav>
        <div className="min-w-0 space-y-8">
      {secao === 'listas' && <ListasEClientes />}
      {secao === 'acesso' && isMaster && <Flag />}
      {(secao === 'status' || secao === 'campos') && (<div className="flex items-center gap-2">
        <label htmlFor="cfg-esp" className="text-xs text-nevoa">Espaço</label>
        <select id="cfg-esp" value={ativo ?? ''} onChange={(e) => setEspaco(e.target.value)} className={campo}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>)}
      {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
      {secao === 'status' && <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Status do espaço</h2>
        <Surface className="divide-y divide-grafite-elevado/60">{ordenados.map((s) => <LinhaStatus key={s.id} s={s} todos={ordenados} onErro={setErro} />)}</Surface>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (novoStatus.trim()) criarStatus.mutate(novoStatus.trim(), { onSuccess: () => setNovoStatus('') }); }}>
          <input value={novoStatus} onChange={(e) => setNovoStatus(e.target.value)} placeholder="Novo status" aria-label="Novo status" className={campo} /><button type="submit" className="rounded bg-grafite-elevado px-3 text-sm text-branco-cru">Adicionar</button>
        </form>
      </section>}
      {secao === 'campos' && <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Campos personalizados do espaço</h2>
        <Surface className="divide-y divide-grafite-elevado/60">
          {(campos.data?.fields ?? []).map((f) => <div key={f.id} className="flex gap-3 px-3 py-2 text-sm"><span className="text-branco-cru">{f.name}</span><span className="text-xs text-nevoa">{TIPOS[f.fieldType] ?? f.fieldType}{f.options.length ? ` · ${f.options.map((o) => o.label).join(', ')}` : ''}</span></div>)}
          {(campos.data?.fields.length ?? 0) === 0 && <p className="px-3 py-2 text-xs text-nevoa">Nenhum campo ainda.</p>}
        </Surface>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (campoNome.trim()) criarCampo.mutate({ name: campoNome.trim(), fieldType: campoTipo, ...(campoTipo === 'drop_down' ? { options: campoOpcoes.split(',').map((x) => x.trim()).filter(Boolean) } : {}) }, { onSuccess: () => { setCampoNome(''); setCampoOpcoes(''); }, onError: (er) => setErro(er instanceof ApiRequestError ? er.message : 'Não foi possível criar.') }); }}>
          <input value={campoNome} onChange={(e) => setCampoNome(e.target.value)} placeholder="Nome do campo" aria-label="Nome do campo" className={campo} />
          <select value={campoTipo} onChange={(e) => setCampoTipo(e.target.value)} aria-label="Tipo do campo" className={campo}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {campoTipo === 'drop_down' && <input value={campoOpcoes} onChange={(e) => setCampoOpcoes(e.target.value)} placeholder="Opções separadas por vírgula" aria-label="Opções" className={`${campo} min-w-56`} />}
          <button type="submit" className="rounded bg-grafite-elevado px-3 text-sm text-branco-cru">Criar campo</button>
        </form>
      </section>}
      {secao === 'visoes' && <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Visões salvas</h2>
        <Surface className="divide-y divide-grafite-elevado/60">
          {(views.data?.views ?? []).map((v) => <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="text-branco-cru">{v.name}</span><span className="text-xs text-nevoa">{v.userId ? 'pessoal' : 'da empresa'}</span><button type="button" aria-label={`Apagar visão ${v.name}`} onClick={() => apagarView.mutate(v.id)} className="ml-auto text-nevoa hover:text-red-400"><Trash2 size={14} /></button></div>)}
          {(views.data?.views.length ?? 0) === 0 && <p className="px-3 py-2 text-xs text-nevoa">Nenhuma. Na tela Todas as Tarefas, ajuste os filtros e use "Salvar visão".</p>}
        </Surface>
      </section>}
        </div>
      </div>
    </div>
  );
}
