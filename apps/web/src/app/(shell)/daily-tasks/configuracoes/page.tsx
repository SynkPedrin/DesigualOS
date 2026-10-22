'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { useIsMaster } from '@/hooks/use-is-master';
import { useCreateStatus, useSpaceStatuses, useWorkMembers, useWorkTree, type WorkStatus } from '@/hooks/use-work';
import { useCreateCustomField, useCustomFields, useSavedViewActions, useSavedViews } from '@/hooks/use-work-extra';
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

  return (
    <div className="space-y-8">
      {isMaster && <Flag />}
      <div className="flex items-center gap-2">
        <label htmlFor="cfg-esp" className="text-xs text-nevoa">Espaço</label>
        <select id="cfg-esp" value={ativo ?? ''} onChange={(e) => setEspaco(e.target.value)} className={campo}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>
      {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Status do espaço</h2>
        <Surface className="divide-y divide-grafite-elevado/60">{ordenados.map((s) => <LinhaStatus key={s.id} s={s} todos={ordenados} onErro={setErro} />)}</Surface>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (novoStatus.trim()) criarStatus.mutate(novoStatus.trim(), { onSuccess: () => setNovoStatus('') }); }}>
          <input value={novoStatus} onChange={(e) => setNovoStatus(e.target.value)} placeholder="Novo status" aria-label="Novo status" className={campo} /><button type="submit" className="rounded bg-grafite-elevado px-3 text-sm text-branco-cru">Adicionar</button>
        </form>
      </section>
      <section className="space-y-2">
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
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-branco-cru">Visões salvas</h2>
        <Surface className="divide-y divide-grafite-elevado/60">
          {(views.data?.views ?? []).map((v) => <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="text-branco-cru">{v.name}</span><span className="text-xs text-nevoa">{v.userId ? 'pessoal' : 'da empresa'}</span><button type="button" aria-label={`Apagar visão ${v.name}`} onClick={() => apagarView.mutate(v.id)} className="ml-auto text-nevoa hover:text-red-400"><Trash2 size={14} /></button></div>)}
          {(views.data?.views.length ?? 0) === 0 && <p className="px-3 py-2 text-xs text-nevoa">Nenhuma. Na tela Todas as Tarefas, ajuste os filtros e use "Salvar visão".</p>}
        </Surface>
      </section>
    </div>
  );
}
