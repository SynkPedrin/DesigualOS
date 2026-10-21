'use client';

import { useEffect, useState } from 'react';
import { Link2, Paperclip, X } from 'lucide-react';
import { useAddComment, useChecklistActions, useCreateTask, useTaskDetail, useWorkTasks, type TaskPatch, type WorkMember, type WorkStatus } from '@/hooks/use-work';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AssigneePicker, DuePicker, PriorityPicker, StatusPicker } from './pickers';
import { Avatar } from './primitivas';

/** Gaveta da tarefa (como o painel do ClickUp): título, status, responsáveis, datas, descrição, subtarefas, checklists, comentários. */
export function TaskDrawer({ taskId, onClose, onOpen, statuses, membros, atualizar }: {
  taskId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  statuses: WorkStatus[];
  membros: WorkMember[];
  atualizar: (id: string, version: number, patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => Promise<unknown>;
}) {
  const { data, isPending, error } = useTaskDetail(taskId);
  const comentar = useAddComment(taskId);
  const cl = useChecklistActions(taskId);
  const criar = useCreateTask();
  const [titulo, setTitulo] = useState('');
  const [desc, setDesc] = useState('');
  const [coment, setComent] = useState('');
  const [sub, setSub] = useState('');
  const [novoCl, setNovoCl] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const t = data?.task;
  useEffect(() => { if (t) { setTitulo(t.title); setDesc(t.description ?? ''); } }, [t?.id, t?.version]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);

  const salvar = async (patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => {
    if (!t) return;
    setMsg(null);
    try { await atualizar(t.id, t.version, patch); } catch (e) { setMsg(e instanceof ApiRequestError && e.status === 409 ? 'Outra pessoa alterou esta tarefa. Recarreguei os dados — tente de novo.' : 'Não foi possível salvar.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside role="dialog" aria-label="Detalhes da tarefa" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-grafite-elevado bg-carbono shadow-elevated">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-grafite-elevado bg-carbono px-4 py-2 text-xs text-nevoa">
          <span className="font-mono">{t?.key}</span>
          {data?.list && <span>em {data.list.name}</span>}
          <button type="button" onClick={onClose} aria-label="Fechar" className="ml-auto rounded p-1 hover:bg-grafite-elevado"><X size={16} /></button>
        </header>
        {isPending && <p className="p-6 text-sm text-nevoa">Carregando…</p>}
        {error && <p role="alert" className="p-6 text-sm text-red-400">Não foi possível abrir a tarefa.</p>}
        {data && t && (
          <div className="space-y-6 p-5">
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              onBlur={() => { if (titulo.trim() && titulo !== t.title) void salvar({ title: titulo.trim() }); }}
              aria-label="Título"
              className="w-full bg-transparent font-heading text-2xl font-semibold text-branco-cru outline-none"
            />
            {msg && <p role="alert" className="text-xs text-red-400">{msg}</p>}
            <dl className="grid grid-cols-[120px_1fr] items-center gap-y-3 text-sm">
              <dt className="text-nevoa">Status</dt><dd><StatusPicker tarefa={t} statuses={statuses} onChange={(statusId) => void salvar({ statusId })} /></dd>
              <dt className="text-nevoa">Responsáveis</dt><dd><AssigneePicker tarefa={t} membros={membros} onChange={(ids) => void salvar({ assigneeIds: ids })} /></dd>
              <dt className="text-nevoa">Vencimento</dt><dd><DuePicker tarefa={t} onChange={(iso) => void salvar({ dueAt: iso })} /></dd>
              <dt className="text-nevoa">Prioridade</dt><dd><PriorityPicker tarefa={t} comTexto onChange={(priority) => void salvar({ priority })} /></dd>
              {t.tags.length > 0 && (<><dt className="text-nevoa">Tags</dt><dd className="flex flex-wrap gap-1">{t.tags.map((x) => <span key={x} className="rounded bg-grafite-elevado px-1.5 py-0.5 text-xs text-nevoa">{x}</span>)}</dd></>)}
              {data.customFields.map((f) => (<div key={f.fieldId} className="contents"><dt className="text-nevoa">{f.name}</dt><dd className="text-branco-cru">{Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? '')}</dd></div>))}
            </dl>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-nevoa">Descrição</h3>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => { if (desc !== (t.description ?? '')) void salvar({ description: desc || null }); }} rows={6} placeholder="Adicione uma descrição" className="w-full rounded border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru outline-none focus:border-sinal/50" />
            </section>

            {(data.blockedBy.length > 0 || data.blocking.length > 0 || data.related.length > 0) && (
              <section className="space-y-1 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-nevoa">Dependências</h3>
                {data.blockedBy.map((x) => <button key={x.id} type="button" onClick={() => onOpen(x.id)} className="flex items-center gap-2 text-left text-red-300 hover:underline"><Link2 size={13} /> Aguardando {x.key} · {x.title}</button>)}
                {data.blocking.map((x) => <button key={x.id} type="button" onClick={() => onOpen(x.id)} className="flex items-center gap-2 text-left text-aviso hover:underline"><Link2 size={13} /> Bloqueia {x.key} · {x.title}</button>)}
                {data.related.map((x) => <button key={x.id} type="button" onClick={() => onOpen(x.id)} className="flex items-center gap-2 text-left text-nevoa hover:underline"><Link2 size={13} /> Relacionada {x.key} · {x.title}</button>)}
              </section>
            )}

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-nevoa">Subtarefas ({data.subtaskIds.length})</h3>
              <SubtasksList parentId={t.id} onOpen={onOpen} />
              <form className="mt-2" onSubmit={(e) => { e.preventDefault(); if (sub.trim()) criar.mutate({ listId: t.listId, title: sub.trim(), parentTaskId: t.id }, { onSuccess: () => setSub('') }); }}>
                <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="+ Adicionar subtarefa" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
              </form>
            </section>

            <section className="space-y-3">
              {data.checklists.map((c) => {
                const feitos = c.items.filter((i) => i.done).length;
                return (
                  <div key={c.id}>
                    <h3 className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-nevoa"><span>{c.name}</span><span>{feitos}/{c.items.length}</span></h3>
                    <div className="mb-1 h-1 overflow-hidden rounded bg-grafite-elevado"><div className="h-full bg-sucesso" style={{ width: `${c.items.length ? (feitos / c.items.length) * 100 : 0}%` }} /></div>
                    <ul className="space-y-0.5">
                      {c.items.map((i) => (
                        <li key={i.id}><label className={cn('flex items-center gap-2 py-0.5 text-sm', i.done ? 'text-nevoa line-through' : 'text-branco-cru')} style={{ paddingLeft: i.parentItemId ? 20 : 0 }}><input type="checkbox" checked={i.done} onChange={(e) => cl.marcar.mutate({ itemId: i.id, done: e.target.checked })} />{i.text}</label></li>
                      ))}
                    </ul>
                    <ItemAdd onAdd={(text) => cl.item.mutate({ checklistId: c.id, text })} />
                  </div>
                );
              })}
              <form onSubmit={(e) => { e.preventDefault(); if (novoCl.trim()) cl.criar.mutate(novoCl.trim(), { onSuccess: () => setNovoCl('') }); }}>
                <input value={novoCl} onChange={(e) => setNovoCl(e.target.value)} placeholder="+ Novo checklist" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
              </form>
            </section>

            {data.attachments.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-nevoa">Anexos ({data.attachments.length})</h3>
                <ul className="space-y-1">{data.attachments.map((a) => <li key={a.id}><a href={a.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-sm text-branco-cru hover:underline"><Paperclip size={13} className="text-nevoa" />{a.fileName}</a></li>)}</ul>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-nevoa">Comentários ({data.comments.length})</h3>
              <ul className="space-y-3">
                {data.comments.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <Avatar nome={c.authorName} url={c.authorAvatar} size={26} />
                    <div className="min-w-0"><p className="text-xs text-nevoa"><strong className="text-branco-cru">{c.authorName}</strong> · {new Date(c.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p><p className="whitespace-pre-wrap break-words text-sm text-branco-cru">{c.body}</p></div>
                  </li>
                ))}
              </ul>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (coment.trim()) comentar.mutate(coment.trim(), { onSuccess: () => setComent('') }); }}>
                <textarea value={coment} onChange={(e) => setComent(e.target.value)} rows={2} placeholder="Escreva um comentário" className="flex-1 rounded border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru outline-none focus:border-sinal/50" />
                <button type="submit" disabled={comentar.isPending || !coment.trim()} className="self-end rounded bg-sinal px-3 py-1.5 text-sm font-semibold text-grafite disabled:opacity-40">Comentar</button>
              </form>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function ItemAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  return <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}><input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ Adicionar item" className="mt-1 w-full bg-transparent px-1 py-0.5 text-xs text-nevoa outline-none placeholder:text-nevoa/70 focus:text-branco-cru" /></form>;
}

function SubtasksList({ parentId, onOpen }: { parentId: string; onOpen: (id: string) => void }) {
  const { data } = useWorkTasks({ parentTaskId: parentId });
  if (!data?.rows.length) return null;
  return (
    <ul className="space-y-0.5">
      {data.rows.map((s) => (
        <li key={s.id}><button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-grafite-elevado/60"><span className="size-2 shrink-0 rounded-full" style={{ background: s.status?.color ?? '#6b7280' }} /><span className={cn('truncate', s.status?.category === 'done' ? 'text-nevoa line-through' : 'text-branco-cru')}>{s.title}</span></button></li>
      ))}
    </ul>
  );
}
