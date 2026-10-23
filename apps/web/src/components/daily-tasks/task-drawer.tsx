'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Pencil, Play, Plus, Repeat, Save, Square, Trash2, X } from 'lucide-react';
import {
  useAddComment, useChecklistActions, useCreateTask, useSpaceStatuses, useTaskDetail, useUpdateTask, useWorkMembers, useWorkTasks,
  type TaskPatch, type WorkTaskDetail, type WorkTaskWire,
} from '@/hooks/use-work';
import { useClients } from '@/hooks/use-clients';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useFollowTask, useRecurrenceActions, useSetCustomField, useTaskApprovals, useTaskCrud, useTaskHistory, useTemplateActions, useTimeEntries, useTimer, useTimerActions } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast-store';
import { LogoDoCliente, nomeLimpo } from './cliente';
import { AbrirDiscussao } from '@/components/comunicacao/abrir-discussao';
import { AprovacaoDaTarefa } from './aprovacao-da-tarefa';
import { AnexosDaTarefa } from './anexos-da-tarefa';
import { AssigneePicker, DuePicker, PriorityPicker, StatusPicker } from './pickers';
import { Avatar, StatusDot } from './primitivas';
import { RowMenu } from './row-menu';
import { TextoRico } from './texto-rico';
import { formatarDuracao, TempoCorrendo } from './tempo';

function CampoPersonalizado({ def, valor, taskId }: { def: WorkTaskDetail['fieldDefs'][number]; valor: unknown; taskId: string }) {
  const set = useSetCustomField(taskId);
  const [v, setV] = useState(valor === undefined || valor === null ? '' : String(valor));
  useEffect(() => { setV(valor === undefined || valor === null ? '' : String(valor)); }, [valor]);
  const cls = 'rounded border border-grafite-elevado bg-grafite px-2 py-1 text-sm text-branco-cru outline-none focus:border-sinal/50';
  if (def.type === 'checkbox') return <input type="checkbox" aria-label={def.name} checked={valor === true} onChange={(e) => set.mutate({ fieldId: def.id, value: e.target.checked })} />;
  if (def.type === 'drop_down') {
    return (
      <select aria-label={def.name} value={v} onChange={(e) => set.mutate({ fieldId: def.id, value: e.target.value || null })} className={cls}>
        <option value="">—</option>{def.options.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
      </select>
    );
  }
  const numerico = def.type === 'number' || def.type === 'currency';
  return (
    <input aria-label={def.name} type={numerico ? 'number' : def.type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v === (valor === undefined || valor === null ? '' : String(valor))) return; set.mutate({ fieldId: def.id, value: v === '' ? null : numerico ? Number(v) : v }); }} className={cls} />
  );
}

/** Seção que fecha quando está vazia: a gaveta mostra o que existe e deixa o resto a um clique, em vez de uma parede de campos. */
function Recolhivel({ titulo, contagem, abertaAoInicio, className, children }: { titulo: string; contagem?: number; abertaAoInicio: boolean; className?: string; children: React.ReactNode }) {
  return (
    <details open={abertaAoInicio} className={cn('group/d border-t border-grafite-elevado pt-3', className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-nevoa hover:text-branco-cru">
        <span>{titulo}{contagem !== undefined && contagem > 0 ? ` · ${contagem}` : ''}</span>
        <span aria-hidden className="text-base leading-none group-open/d:rotate-45">+</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

const Titulo = ({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) => (
  <h3 className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-nevoa"><span>{children}</span>{extra}</h3>
);

/** Edição de uma linha de texto no lugar (checklist, item): Enter salva, Esc cancela. */
function EditaNoLugar({ valor, onSalvar, className }: { valor: string; onSalvar: (v: string) => void; className?: string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(valor);
  if (!edit) return <button type="button" onDoubleClick={() => { setV(valor); setEdit(true); }} title="Duplo clique para editar" className={cn('text-left', className)}>{valor}</button>;
  return <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => setEdit(false)} onKeyDown={(e) => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter' && v.trim()) { if (v.trim() !== valor) onSalvar(v.trim()); setEdit(false); } }} className="rounded border border-sinal/50 bg-carbono px-1 text-sm text-branco-cru outline-none" />;
}

function BuscaDeTarefa({ onPick, excluir }: { onPick: (t: WorkTaskWire) => void; excluir: string }) {
  const [q, setQ] = useState('');
  const r = useWorkTasks({ q: q.trim() || undefined, limit: 8, includeSubtasks: true, enabled: q.trim().length >= 2 });
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Dependência: busque por DT-123 ou título" aria-label="Buscar tarefa para vincular" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
      {q.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-grafite-elevado bg-carbono p-1 shadow-elevated">
          {(r.data?.rows ?? []).filter((t) => t.id !== excluir).map((t) => <li key={t.id}><button type="button" onClick={() => { onPick(t); setQ(''); }} className="flex w-full gap-2 rounded px-2 py-1 text-left text-xs text-branco-cru hover:bg-grafite-elevado"><span className="font-mono text-nevoa">{t.key}</span><span className="truncate">{t.title}</span></button></li>)}
          {r.data && r.data.rows.length === 0 && <li className="px-2 py-1 text-xs text-nevoa">Nada encontrado.</li>}
        </ul>
      )}
    </div>
  );
}

/** Gaveta da tarefa (como o painel do ClickUp). Busca o que precisa sozinha: serve a qualquer tela. */
export function TaskDrawer({ taskId, onClose, onOpen }: { taskId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { data, isPending, error } = useTaskDetail(taskId);
  const statuses = useSpaceStatuses(data?.list?.spaceId ?? null);
  const membros = useWorkMembers().data?.members ?? [];
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const pendentes = (useTaskApprovals(taskId).data?.approvals ?? []).filter((a) => a.status === 'pending').length;
  const clientes = useClients().data ?? [];
  const atualizar = useUpdateTask();
  const comentar = useAddComment(taskId);
  const cl = useChecklistActions(taskId);
  const crud = useTaskCrud(taskId);
  const criar = useCreateTask();
  const tempo = useTimeEntries(taskId);
  const timer = useTimer();
  const { iniciar, parar, manual } = useTimerActions();
  const modelos = useTemplateActions();
  const historico = useTaskHistory(taskId);
  const { seguir, deixar } = useFollowTask(taskId);
  const [historicoTodo, setHistoricoTodo] = useState(false);
  const recorrencia = useRecurrenceActions();
  const [titulo, setTitulo] = useState('');
  const [desc, setDesc] = useState('');
  const [coment, setComent] = useState('');
  const [sub, setSub] = useState('');
  const [novoCl, setNovoCl] = useState('');
  const [tag, setTag] = useState('');
  const [min, setMin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [todosCampos, setTodosCampos] = useState(false);
  const [editandoDesc, setEditandoDesc] = useState(false);
  const [editandoComent, setEditandoComent] = useState<{ id: string; body: string } | null>(null);
  const comentRef = useRef<HTMLTextAreaElement>(null);
  const t = data?.task;
  useEffect(() => { if (t) { setTitulo(t.title); setDesc(t.description ?? ''); setEditandoDesc(false); } }, [t?.id, t?.version]);
  const fecharRef = useRef<() => void>(onClose);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharRef.current(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, []);

  const st = statuses.data?.statuses ?? [];
  const erro = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível concluir.', 'error');
  const salvar = async (patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => {
    if (!t) return;
    setMsg(null);
    try { await atualizar.mutateAsync({ id: t.id, expectedVersion: t.version, ...patch }); } catch (e) { setMsg(e instanceof ApiRequestError && e.status === 409 ? 'Outra pessoa (ou uma automação) alterou esta tarefa. Recarreguei os dados — tente de novo.' : 'Não foi possível salvar.'); }
  };
  const mencionar = (id: string) => {
    const m = membros.find((x) => x.id === id);
    if (!m) return;
    setComent((c) => `${c}${c && !c.endsWith(' ') ? ' ' : ''}@[${m.name}](${m.id}) `);
    comentRef.current?.focus();
  };
  const alterado = Boolean(t) && (titulo !== t!.title || desc !== (t!.description ?? ''));
  const salvarRascunho = async () => {
    if (!t || !titulo.trim()) return;
    await salvar({ ...(titulo.trim() !== t.title ? { title: titulo.trim() } : {}), ...(desc !== (t.description ?? '') ? { description: desc || null } : {}) });
    toast('Alterações salvas.', 'success');
  };
  const tentarFechar = () => { if (alterado && !window.confirm('Há alterações NÃO salvas nesta tarefa. Fechar e perder o que você escreveu?')) return; onClose(); };
  fecharRef.current = tentarFechar;
  const meuTimerNesta = timer.data?.running?.taskId === taskId;
  const cliente = useMemo(() => clientes.find((c) => c.id === t?.clientId) ?? null, [clientes, t?.clientId]);
  const feitas = data?.subtaskIds.length ? data.task.subtaskDone : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={tentarFechar}>
      <aside role="dialog" aria-label="Detalhes da tarefa" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-grafite-elevado bg-carbono shadow-elevated">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-grafite-elevado bg-carbono px-4 py-2 text-xs text-nevoa">
          <span className="font-mono">{t?.key}</span>
          {data?.list && <span className="flex items-center gap-1.5">em <LogoDoCliente nome={nomeLimpo(data.list.name)} className="!size-5" />{data.list.name}</span>}
          {t?.archivedAt && <span className="rounded bg-aviso/20 px-1.5 py-0.5 text-aviso">arquivada</span>}
          <button type="button" onClick={tentarFechar} aria-label="Fechar" className="ml-auto flex items-center gap-1 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-branco-cru hover:bg-grafite-elevado"><X size={14} /> Fechar</button>
        </header>
        {isPending && <p className="p-6 text-sm text-nevoa">Carregando…</p>}
        {error && <p role="alert" className="p-6 text-sm text-red-400">Não foi possível abrir a tarefa.</p>}
        {data && t && (
          <div className="space-y-5 p-6">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-label="Título" className="w-full bg-transparent font-heading text-2xl font-semibold text-branco-cru outline-none" />
            <div role="toolbar" aria-label="Ações da tarefa" className="flex flex-wrap gap-2">
              {(() => {
                const feita = t.status?.category === 'done';
                const alvo = feita ? st.find((x) => x.isInitial) : st.find((x) => x.category === 'done');
                return alvo ? (
                  <button type="button" onClick={() => void salvar({ statusId: alvo.id })} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold', feita ? 'bg-grafite-elevado text-branco-cru' : 'bg-sucesso text-carbono')}><Check size={16} /> {feita ? 'Reabrir tarefa' : 'Concluir tarefa'}</button>
                ) : null;
              })()}
              {meuTimerNesta ? (
                <button type="button" onClick={() => parar.mutate()} className="flex items-center gap-2 rounded-lg bg-red-500/15 px-4 py-2 text-sm font-medium text-red-400"><Square size={14} /> Parar cronômetro</button>
              ) : (
                <button type="button" onClick={() => iniciar.mutate(taskId)} className="flex items-center gap-2 rounded-lg bg-grafite-elevado px-4 py-2 text-sm font-medium text-branco-cru hover:bg-grafite"><Play size={14} /> Iniciar cronômetro</button>
              )}
              <button type="button" onClick={() => document.getElementById('drawer-subtarefa')?.focus()} className="flex items-center gap-2 rounded-lg bg-grafite-elevado px-4 py-2 text-sm font-medium text-branco-cru hover:bg-grafite"><Plus size={14} /> Criar subtarefa</button>
              <AbrirDiscussao entityType="work_task" entityId={t.id} titulo={`${t.key ?? 'Tarefa'} · ${t.title}`.slice(0, 120)} rotulo="Conversar" />
              <span className="rounded-lg bg-grafite-elevado text-branco-cru hover:bg-grafite">
                <RowMenu t={t} rotulo="Mais ações" onDone={(a) => { if (a !== 'moved') onClose(); }} extras={[
                  { rotulo: 'Salvar como modelo', icone: <Save size={12} />, onClick: () => { const n = window.prompt('Nome do modelo', t.title); if (n?.trim()) modelos.salvar.mutate({ taskId: t.id, name: n.trim() }, { onSuccess: () => toast('Modelo salvo — veja em Gerenciar › Modelos.', 'success'), onError: erro }); } },
                  { rotulo: 'Repetir esta tarefa…', icone: <Repeat size={12} />, onClick: () => { const f = window.prompt('Repetir: daily (todo dia), weekly (toda semana) ou monthly (todo mês)?', 'weekly'); if (f && ['daily', 'weekly', 'monthly'].includes(f.trim())) recorrencia.criar.mutate({ taskId: t.id, freq: f.trim() }, { onSuccess: () => toast('Recorrência criada — veja em Gerenciar › Modelos.', 'success'), onError: erro }); } },
                ]} />
              </span>
            </div>
            {msg && <p role="alert" className="text-xs text-red-400">{msg}</p>}
            <dl className="grid grid-cols-[150px_1fr] items-center gap-y-3.5 text-sm">
              <dt className="text-nevoa">Status</dt><dd><StatusPicker tarefa={t} statuses={st} onChange={(statusId) => void salvar({ statusId })} /></dd>
              <dt className="text-nevoa">Responsáveis</dt><dd><AssigneePicker tarefa={t} membros={membros} onChange={(ids) => void salvar({ assigneeIds: ids })} /></dd>
              <dt className="text-nevoa">Vencimento</dt><dd><DuePicker tarefa={t} onChange={(iso) => void salvar({ dueAt: iso })} /></dd>
              <dt className="text-nevoa">Prioridade</dt><dd><PriorityPicker tarefa={t} comTexto onChange={(priority) => void salvar({ priority })} /></dd>
              <dt className="text-nevoa">Cliente</dt>
              <dd className="flex items-center gap-2">
                {cliente && <LogoDoCliente nome={cliente.name} className="!size-6" />}
                <select aria-label="Cliente da tarefa" value={t.clientId ?? ''} onChange={(e) => void salvar({ clientId: e.target.value || null })} className="max-w-64 rounded border border-grafite-elevado bg-grafite px-2 py-1 text-sm text-branco-cru outline-none">
                  <option value="">Sem cliente</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </dd>
            </dl>
            <details className="group/d">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-nevoa hover:text-branco-cru"><span aria-hidden className="inline-block transition-transform group-open/d:rotate-90">›</span> Mais detalhes <span className="text-nevoa/60">(início, estimativa, tempo, quem acompanha, tags e campos)</span></summary>
            <dl className="mt-3 grid grid-cols-[150px_1fr] items-center gap-y-3.5 text-sm">
              <dt className="text-nevoa">Início</dt>
              <dd className="flex items-center gap-2"><input type="date" aria-label="Data de início" value={t.startAt ? t.startAt.slice(0, 10) : ''} onChange={(e) => void salvar({ startAt: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })} className="rounded border border-grafite-elevado bg-grafite px-2 py-1 text-sm text-branco-cru outline-none" />{t.startAt && <button type="button" onClick={() => void salvar({ startAt: null })} className="text-xs text-nevoa hover:text-branco-cru">limpar</button>}</dd>
              <dt className="text-nevoa">Estimativa</dt>
              <dd><input type="number" min={0} aria-label="Estimativa em minutos" defaultValue={t.estimateMinutes ?? ''} key={`est${t.version}`} onBlur={(e) => { const n = e.target.value === '' ? null : Number(e.target.value); if (n !== t.estimateMinutes) void salvar({ estimateMinutes: n }); }} className="w-24 rounded border border-grafite-elevado bg-grafite px-2 py-1 text-sm text-branco-cru outline-none" /> <span className="text-xs text-nevoa">min</span></dd>
              <dt className="text-nevoa">Tempo</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-branco-cru">{formatarDuracao(tempo.data?.totalMs ?? data.trackedMs)}</span>
                {meuTimerNesta ? (
                  <button type="button" onClick={() => parar.mutate()} className="flex items-center gap-1 rounded bg-red-500/15 px-2 py-1 text-xs text-red-400"><Square size={11} /> Parar <TempoCorrendo desde={timer.data!.running!.startedAt} /></button>
                ) : (
                  <button type="button" onClick={() => iniciar.mutate(taskId)} className="flex items-center gap-1 rounded bg-grafite-elevado px-2 py-1 text-xs text-branco-cru hover:bg-grafite"><Play size={11} /> Iniciar</button>
                )}
                <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const n = Number(min); if (n > 0) manual.mutate({ taskId, minutes: n }, { onSuccess: () => setMin('') }); }}>
                  <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" placeholder="+ min" aria-label="Minutos a lançar" className="w-16 rounded border border-grafite-elevado bg-grafite px-2 py-1 text-xs text-branco-cru outline-none" />
                </form>
              </dd>
              <dt className="text-nevoa">Acompanhando</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => (data.following ? deixar : seguir).mutate(undefined, { onSuccess: () => toast(data.following ? 'Você deixou de seguir esta tarefa.' : 'Você segue esta tarefa: recebe aviso de comentário e mudança de status.', 'success'), onError: erro })} className={cn('rounded-lg px-3 py-1 text-sm font-medium', data.following ? 'bg-sinal/20 text-sinal' : 'border border-grafite-elevado text-branco-cru hover:bg-grafite-elevado')}>{data.following ? '✓ Seguindo' : '+ Seguir'}</button>
                <span className="flex items-center -space-x-1.5">{data.followers.slice(0, 6).map((f) => <span key={f.id} className="rounded-full ring-2 ring-carbono"><Avatar nome={f.name} url={f.avatar} size={22} /></span>)}</span>
                {data.followers.length > 0 && <span className="text-xs text-nevoa">{data.followers.length} acompanhando</span>}
              </dd>
              <dt className="text-nevoa">Tags</dt>
              <dd className="flex flex-wrap items-center gap-1">
                {t.tags.map((x) => <button key={x} type="button" title="Remover tag" onClick={() => void salvar({ tags: t.tags.filter((y) => y !== x) })} className="rounded bg-grafite-elevado px-1.5 py-0.5 text-xs text-nevoa hover:text-branco-cru">{x} ×</button>)}
                <form onSubmit={(e) => { e.preventDefault(); const n = tag.trim(); if (n && !t.tags.includes(n)) void salvar({ tags: [...t.tags, n] }); setTag(''); }}><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="+ tag" aria-label="Nova tag" className="w-20 bg-transparent text-xs text-nevoa outline-none placeholder:text-nevoa focus:text-branco-cru" /></form>
              </dd>
              {data.fieldDefs.filter((f) => todosCampos || data.customFields.some((x) => x.fieldId === f.id)).map((f) => (<div key={f.id} className="contents"><dt className="text-nevoa">{f.name}</dt><dd><CampoPersonalizado def={f} valor={data.customFields.find((x) => x.fieldId === f.id)?.value} taskId={taskId} /></dd></div>))}
              {data.fieldDefs.length > data.customFields.length && (<><dt /><dd><button type="button" onClick={() => setTodosCampos((v) => !v)} className="text-xs text-nevoa hover:text-branco-cru">{todosCampos ? 'Ocultar campos vazios' : `Mostrar ${data.fieldDefs.length - data.customFields.length} campos vazios`}</button></dd></>)}
            </dl>
            </details>

            <section className="border-t border-grafite-elevado pt-4">
              <Titulo extra={desc && !editandoDesc ? <button type="button" onClick={() => setEditandoDesc(true)} className="flex items-center gap-1 normal-case text-nevoa hover:text-branco-cru"><Pencil size={12} /> Editar descrição</button> : undefined}>Descrição</Titulo>
              {desc && !editandoDesc ? (
                <TextoRico texto={desc} className="text-branco-cru" />
              ) : (
                <>
                  <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder="Adicione uma descrição (links ficam clicáveis depois de salvar)" className="w-full rounded border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru outline-none focus:border-sinal/50" />
                  {editandoDesc && <button type="button" onClick={() => setEditandoDesc(false)} className="mt-1 text-xs text-nevoa hover:text-branco-cru">Ver como ficou</button>}
                </>
              )}
            </section>

            <section className="border-t border-grafite-elevado pt-4">
              <Titulo extra={data.subtaskIds.length > 0 && <span className="normal-case tabular-nums">{feitas}/{data.subtaskIds.length}</span>}>Subtarefas ({data.subtaskIds.length})</Titulo>
              {data.subtaskIds.length > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded bg-grafite-elevado"><div className="h-full bg-sucesso" style={{ width: `${(feitas / data.subtaskIds.length) * 100}%` }} /></div>}
              <SubtasksList parentId={t.id} onOpen={onOpen} statuses={st} membros={membros} salvar={(sub, patch) => atualizar.mutate({ id: sub.id, expectedVersion: sub.version, ...patch })} />
              <form className="mt-2" onSubmit={(e) => { e.preventDefault(); if (sub.trim()) criar.mutate({ listId: t.listId, title: sub.trim(), parentTaskId: t.id }, { onSuccess: () => setSub('') }); }}>
                <input id="drawer-subtarefa" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="+ Escreva o nome da subtarefa e aperte Enter" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1.5 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
              </form>
            </section>

            <Recolhivel titulo="Dependências" contagem={data.blockedBy.length + data.blocking.length + data.related.length} abertaAoInicio={data.blockedBy.length + data.blocking.length + data.related.length > 0} className="space-y-2">
              {data.blockedBy.map((x) => <div key={x.id} className="flex items-center gap-2 text-sm"><button type="button" onClick={() => onOpen(x.id)} className="flex items-center gap-2 text-left text-red-300 hover:underline"><Link2 size={13} /> Aguardando {x.key} · {x.title}</button><button type="button" aria-label="Remover dependência" onClick={() => crud.removerDependencia.mutate(x.id, { onError: erro })} className="text-nevoa hover:text-red-400"><X size={12} /></button></div>)}
              {data.blocking.map((x) => <div key={x.id} className="flex items-center gap-2 text-sm"><button type="button" onClick={() => onOpen(x.id)} className="flex items-center gap-2 text-left text-aviso hover:underline"><Link2 size={13} /> Bloqueia {x.key} · {x.title}</button><button type="button" aria-label="Remover dependência" onClick={() => crud.removerDependencia.mutate(x.id, { onError: erro })} className="text-nevoa hover:text-red-400"><X size={12} /></button></div>)}
              {data.related.map((x) => <div key={x.id} className="flex items-center gap-2 text-sm"><button type="button" onClick={() => onOpen(x.id)} className="flex items-center gap-2 text-left text-nevoa hover:underline"><Link2 size={13} /> Relacionada {x.key} · {x.title}</button><button type="button" aria-label="Remover vínculo" onClick={() => crud.removerDependencia.mutate(x.id, { onError: erro })} className="text-nevoa hover:text-red-400"><X size={12} /></button></div>)}
              <BuscaDeTarefa excluir={t.id} onPick={(o) => crud.dependencia.mutate({ dependsOnId: o.id, kind: 'blocking' }, { onError: erro, onSuccess: () => toast(`Esta tarefa agora aguarda ${o.key}.`, 'success') })} />
            </Recolhivel>

            <Recolhivel titulo="Checklists" contagem={data.checklists.length} abertaAoInicio={data.checklists.length > 0} className="space-y-3">
              {data.checklists.map((c) => {
                const feitos = c.items.filter((i) => i.done).length;
                return (
                  <div key={c.id}>
                    <Titulo extra={<span className="flex items-center gap-2 normal-case"><span className="tabular-nums">{feitos}/{c.items.length}</span><button type="button" aria-label={`Apagar checklist ${c.name}`} onClick={() => { if (window.confirm(`Apagar o checklist "${c.name}" e seus itens?`)) crud.apagarChecklist.mutate(c.id, { onError: erro }); }} className="hover:text-red-400"><Trash2 size={12} /></button></span>}>
                      <EditaNoLugar valor={c.name} onSalvar={(name) => crud.renomearChecklist.mutate({ id: c.id, name }, { onError: erro })} />
                    </Titulo>
                    <div className="mb-1 h-1 overflow-hidden rounded bg-grafite-elevado"><div className="h-full bg-sucesso" style={{ width: `${c.items.length ? (feitos / c.items.length) * 100 : 0}%` }} /></div>
                    <ul className="space-y-0.5">
                      {c.items.map((i) => (
                        <li key={i.id} className="group flex items-center gap-2" style={{ paddingLeft: i.parentItemId ? 20 : 0 }}>
                          <input type="checkbox" checked={i.done} aria-label={i.text} onChange={(e) => cl.marcar.mutate({ itemId: i.id, done: e.target.checked })} />
                          <EditaNoLugar valor={i.text} onSalvar={(text) => crud.editarItem.mutate({ id: i.id, text }, { onError: erro })} className={cn('flex-1 py-0.5 text-sm', i.done ? 'text-nevoa line-through' : 'text-branco-cru')} />
                          <button type="button" aria-label={`Apagar item ${i.text}`} onClick={() => crud.apagarItem.mutate(i.id, { onError: erro })} className="text-nevoa opacity-40 transition-opacity hover:text-red-400 group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
                        </li>
                      ))}
                    </ul>
                    <ItemAdd onAdd={(text) => cl.item.mutate({ checklistId: c.id, text })} />
                  </div>
                );
              })}
              <form onSubmit={(e) => { e.preventDefault(); if (novoCl.trim()) cl.criar.mutate(novoCl.trim(), { onSuccess: () => setNovoCl('') }); }}>
                <input value={novoCl} onChange={(e) => setNovoCl(e.target.value)} placeholder="+ Novo checklist" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1.5 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
              </form>
            </Recolhivel>

            <Recolhivel titulo="Aprovação" contagem={pendentes} abertaAoInicio={pendentes > 0}>
              <AprovacaoDaTarefa taskId={taskId} membros={membros} eu={eu} />
            </Recolhivel>

            <Recolhivel titulo="Anexos" contagem={data.attachments.length} abertaAoInicio={data.attachments.length > 0}>
              <AnexosDaTarefa taskId={taskId} anexos={data.attachments} erro={erro} />
            </Recolhivel>

            <section className="border-t border-grafite-elevado pt-4">
              <Titulo>Comentários ({data.comments.length})</Titulo>
              <ul className="space-y-3">
                {data.comments.map((c) => (
                  <li key={c.id} className="group flex gap-2">
                    <Avatar nome={c.authorName} url={c.authorAvatar} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-xs text-nevoa"><strong className="text-branco-cru">{c.authorName}</strong> · {new Date(c.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        {c.authorId === eu && (
                          <span className="ml-auto flex gap-2 opacity-40 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <button type="button" aria-label="Editar comentário" onClick={() => setEditandoComent({ id: c.id, body: c.body })} className="hover:text-branco-cru"><Pencil size={12} /></button>
                            <button type="button" aria-label="Apagar comentário" onClick={() => { if (window.confirm('Apagar este comentário?')) crud.apagarComentario.mutate(c.id, { onError: erro }); }} className="hover:text-red-400"><Trash2 size={12} /></button>
                          </span>
                        )}
                      </p>
                      {editandoComent?.id === c.id ? (
                        <form className="mt-1 space-y-1" onSubmit={(e) => { e.preventDefault(); crud.editarComentario.mutate({ id: c.id, body: editandoComent.body }, { onSuccess: () => setEditandoComent(null), onError: erro }); }}>
                          <textarea autoFocus value={editandoComent.body} onChange={(e) => setEditandoComent({ id: c.id, body: e.target.value })} rows={3} className="w-full rounded border border-sinal/50 bg-grafite px-2 py-1 text-sm text-branco-cru outline-none" />
                          <span className="flex gap-2"><button type="submit" className="rounded bg-sinal px-2 py-1 text-xs font-semibold text-grafite">Salvar</button><button type="button" onClick={() => setEditandoComent(null)} className="text-xs text-nevoa">Cancelar</button></span>
                        </form>
                      ) : <TextoRico texto={c.body} className="text-branco-cru" />}
                    </div>
                  </li>
                ))}
              </ul>
              <form className="mt-3 space-y-1" onSubmit={(e) => { e.preventDefault(); if (coment.trim()) comentar.mutate(coment.trim(), { onSuccess: () => setComent('') }); }}>
                <textarea ref={comentRef} value={coment} onChange={(e) => setComent(e.target.value)} rows={2} placeholder="Escreva um comentário" className="w-full rounded border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru outline-none focus:border-sinal/50" />
                <div className="flex items-center justify-between">
                  <select aria-label="Mencionar alguém" value="" onChange={(e) => { if (e.target.value) mencionar(e.target.value); }} className="rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-nevoa">
                    <option value="">@ Mencionar…</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button type="submit" disabled={comentar.isPending || !coment.trim()} className="rounded bg-sinal px-3 py-1.5 text-sm font-semibold text-grafite disabled:opacity-40">Comentar</button>
                </div>
              </form>
            </section>

            <section className="border-t border-grafite-elevado pt-4">
              <Titulo extra={historico.data && historico.data.events.length > 8 ? <button type="button" onClick={() => setHistoricoTodo((v) => !v)} className="normal-case text-nevoa hover:text-branco-cru">{historicoTodo ? 'Mostrar menos' : `Ver tudo (${historico.data.events.length})`}</button> : undefined}>Histórico da tarefa</Titulo>
              {historico.isPending ? <p className="text-xs text-nevoa">Carregando…</p> : (
                <ol className="space-y-2.5" aria-label="Histórico da tarefa">
                  {(historico.data?.events ?? []).slice(0, historicoTodo ? 500 : 8).map((h) => (
                    <li key={h.id} className="flex items-start gap-2.5 text-sm">
                      <Avatar nome={h.actorName} url={h.actorAvatar} size={22} />
                      <span className="min-w-0 flex-1 text-branco-cru"><strong className="font-semibold">{h.actorName}</strong> <span className="text-nevoa">{h.texto}</span></span>
                      <time dateTime={h.createdAt} title={new Date(h.createdAt).toLocaleString('pt-BR')} className="shrink-0 text-[11px] text-nevoa/80">{new Date(h.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
        {t && (
          <footer className={cn('sticky bottom-0 z-10 flex items-center gap-3 border-t px-6 py-3', alterado ? 'border-sinal/60 bg-grafite' : 'border-grafite-elevado bg-carbono')}>
            <span className={cn('text-sm', alterado ? 'font-medium text-aviso' : 'text-nevoa')}>{alterado ? 'Você tem alterações não salvas' : 'Tudo salvo — status, responsáveis, prazo, prioridade e cliente salvam na hora'}</span>
            <button type="button" disabled={!alterado} onClick={() => { setTitulo(t.title); setDesc(t.description ?? ''); }} className="ml-auto rounded-lg border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru disabled:opacity-40">Descartar</button>
            <button type="button" disabled={!alterado || !titulo.trim() || atualizar.isPending} onClick={() => void salvarRascunho()} className="rounded-lg bg-sinal px-4 py-1.5 text-sm font-semibold text-grafite disabled:opacity-40">{atualizar.isPending ? 'Salvando…' : 'Salvar alterações'}</button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function ItemAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  return <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}><input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ Adicionar item" className="mt-1 w-full bg-transparent px-1 py-0.5 text-xs text-nevoa outline-none placeholder:text-nevoa/70 focus:text-branco-cru" /></form>;
}

/** Subtarefas com concluir, responsável e prazo no lugar — não só uma lista de títulos. */
function SubtasksList({ parentId, onOpen, statuses, membros, salvar }: { parentId: string; onOpen: (id: string) => void; statuses: Array<{ id: string; category: string; isInitial: boolean }>; membros: Parameters<typeof AssigneePicker>[0]['membros']; salvar: (t: WorkTaskWire, p: Omit<TaskPatch, 'id' | 'expectedVersion'>) => void }) {
  const { data } = useWorkTasks({ parentTaskId: parentId });
  if (!data?.rows.length) return null;
  const final = statuses.find((s) => s.category === 'done');
  return (
    <ul className="divide-y divide-grafite-elevado/50 rounded-lg border border-grafite-elevado">
      {data.rows.map((s) => {
        const feita = s.status?.category === 'done';
        return (
          <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-grafite-elevado/40">
            <button type="button" aria-label={feita ? 'Reabrir subtarefa' : 'Concluir subtarefa'} onClick={() => { const alvo = feita ? statuses.find((x) => x.isInitial) : final; if (alvo) salvar(s, { statusId: alvo.id }); }}><StatusDot cor={s.status?.color ?? '#6b7280'} feito={feita} /></button>
            <button type="button" onClick={() => onOpen(s.id)} className={cn('min-w-0 flex-1 truncate text-left text-sm hover:underline', feita ? 'text-nevoa line-through' : 'text-branco-cru')}>{s.title}</button>
            <AssigneePicker tarefa={s} membros={membros} onChange={(ids) => salvar(s, { assigneeIds: ids })} />
            <DuePicker tarefa={s} onChange={(iso) => salvar(s, { dueAt: iso })} />
          </li>
        );
      })}
    </ul>
  );
}

void Check; void Plus;
