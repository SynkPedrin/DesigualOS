'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Link2, Paperclip, Play, Repeat, Save, Square, X } from 'lucide-react';
import {
  useAddComment, useChecklistActions, useCreateTask, useSpaceStatuses, useTaskDetail, useUpdateTask, useWorkMembers, useWorkTasks,
  type TaskPatch, type WorkTaskDetail,
} from '@/hooks/use-work';
import { useRecurrenceActions, useSetCustomField, useTemplateActions, useTimeEntries, useTimer, useTimerActions } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AssigneePicker, DuePicker, PriorityPicker, StatusPicker } from './pickers';
import { LogoDoCliente, nomeLimpo } from './cliente';
import { Avatar } from './primitivas';
import { formatarDuracao, TempoCorrendo } from './tempo';

const MENCAO = /@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi;
/** Mostra @[Nome](id) como @Nome em destaque; o resto do texto fica como está. */
function TextoComMencoes({ texto }: { texto: string }) {
  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(MENCAO)) {
    partes.push(texto.slice(ultimo, m.index));
    partes.push(<span key={m.index} className="rounded bg-sinal/15 px-1 text-sinal">@{m[1]}</span>);
    ultimo = (m.index ?? 0) + m[0].length;
  }
  partes.push(texto.slice(ultimo));
  return <>{partes}</>;
}

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
    <input
      aria-label={def.name}
      type={numerico ? 'number' : def.type === 'date' ? 'date' : 'text'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v === (valor === undefined || valor === null ? '' : String(valor))) return;
        set.mutate({ fieldId: def.id, value: v === '' ? null : numerico ? Number(v) : v });
      }}
      className={cls}
    />
  );
}

/** Gaveta da tarefa (como o painel do ClickUp). Busca o que precisa sozinha: serve a qualquer tela. */
export function TaskDrawer({ taskId, onClose, onOpen }: { taskId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { data, isPending, error } = useTaskDetail(taskId);
  const statuses = useSpaceStatuses(data?.list?.spaceId ?? null);
  const membros = useWorkMembers().data?.members ?? [];
  const atualizar = useUpdateTask();
  const comentar = useAddComment(taskId);
  const cl = useChecklistActions(taskId);
  const criar = useCreateTask();
  const tempo = useTimeEntries(taskId);
  const timer = useTimer();
  const { iniciar, parar, manual } = useTimerActions();
  const modelos = useTemplateActions();
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
  const [aviso, setAviso] = useState<string | null>(null);
  const comentRef = useRef<HTMLTextAreaElement>(null);
  const t = data?.task;
  useEffect(() => { if (t) { setTitulo(t.title); setDesc(t.description ?? ''); } }, [t?.id, t?.version]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);

  const salvar = async (patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => {
    if (!t) return;
    setMsg(null);
    try { await atualizar.mutateAsync({ id: t.id, expectedVersion: t.version, ...patch }); } catch (e) { setMsg(e instanceof ApiRequestError && e.status === 409 ? 'Outra pessoa alterou esta tarefa. Recarreguei os dados — tente de novo.' : 'Não foi possível salvar.'); }
  };
  const mencionar = (id: string) => {
    const m = membros.find((x) => x.id === id);
    if (!m) return;
    setComent((c) => `${c}${c && !c.endsWith(' ') ? ' ' : ''}@[${m.name}](${m.id}) `);
    comentRef.current?.focus();
  };
  const meuTimerNesta = timer.data?.running?.taskId === taskId;
  const st = statuses.data?.statuses ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside role="dialog" aria-label="Detalhes da tarefa" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-grafite-elevado bg-carbono shadow-elevated">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-grafite-elevado bg-carbono px-4 py-2 text-xs text-nevoa">
          <span className="font-mono">{t?.key}</span>
          {data?.list && <span className="flex items-center gap-1.5">em <LogoDoCliente nome={nomeLimpo(data.list.name)} className="!size-5" />{data.list.name}</span>}
          <div className="ml-auto flex items-center gap-1">
            {t && <button type="button" title="Duplicar tarefa" onClick={() => modelos.duplicar.mutate(t.id, { onSuccess: () => setAviso('Tarefa duplicada na mesma lista.') })} className="rounded p-1 hover:bg-grafite-elevado"><Copy size={15} /></button>}
            {t && <button type="button" title="Salvar como modelo" onClick={() => { const n = window.prompt('Nome do modelo', t.title); if (n?.trim()) modelos.salvar.mutate({ taskId: t.id, name: n.trim() }, { onSuccess: () => setAviso('Modelo salvo — veja na aba Modelos.') }); }} className="rounded p-1 hover:bg-grafite-elevado"><Save size={15} /></button>}
            {t && <button type="button" title="Repetir esta tarefa" onClick={() => { const f = window.prompt('Repetir: daily (diária), weekly (semanal) ou monthly (mensal)?', 'weekly'); if (f && ['daily', 'weekly', 'monthly'].includes(f.trim())) recorrencia.criar.mutate({ taskId: t.id, freq: f.trim() }, { onSuccess: () => setAviso('Recorrência criada — veja na aba Modelos.') }); }} className="rounded p-1 hover:bg-grafite-elevado"><Repeat size={15} /></button>}
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 hover:bg-grafite-elevado"><X size={16} /></button>
          </div>
        </header>
        {isPending && <p className="p-6 text-sm text-nevoa">Carregando…</p>}
        {error && <p role="alert" className="p-6 text-sm text-red-400">Não foi possível abrir a tarefa.</p>}
        {data && t && (
          <div className="space-y-6 p-5">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={() => { if (titulo.trim() && titulo !== t.title) void salvar({ title: titulo.trim() }); }} aria-label="Título" className="w-full bg-transparent font-heading text-2xl font-semibold text-branco-cru outline-none" />
            {msg && <p role="alert" className="text-xs text-red-400">{msg}</p>}
            {aviso && <p role="status" className="text-xs text-sucesso">{aviso}</p>}
            <dl className="grid grid-cols-[130px_1fr] items-center gap-y-3 text-sm">
              <dt className="text-nevoa">Status</dt><dd><StatusPicker tarefa={t} statuses={st} onChange={(statusId) => void salvar({ statusId })} /></dd>
              <dt className="text-nevoa">Responsáveis</dt><dd><AssigneePicker tarefa={t} membros={membros} onChange={(ids) => void salvar({ assigneeIds: ids })} /></dd>
              <dt className="text-nevoa">Vencimento</dt><dd><DuePicker tarefa={t} onChange={(iso) => void salvar({ dueAt: iso })} /></dd>
              <dt className="text-nevoa">Prioridade</dt><dd><PriorityPicker tarefa={t} comTexto onChange={(priority) => void salvar({ priority })} /></dd>
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
              <dt className="text-nevoa">Tags</dt>
              <dd className="flex flex-wrap items-center gap-1">
                {t.tags.map((x) => <button key={x} type="button" title="Remover tag" onClick={() => void salvar({ tags: t.tags.filter((y) => y !== x) })} className="rounded bg-grafite-elevado px-1.5 py-0.5 text-xs text-nevoa hover:text-branco-cru">{x} ×</button>)}
                <form onSubmit={(e) => { e.preventDefault(); const n = tag.trim(); if (n && !t.tags.includes(n)) void salvar({ tags: [...t.tags, n] }); setTag(''); }}><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="+ tag" aria-label="Nova tag" className="w-20 bg-transparent text-xs text-nevoa outline-none placeholder:text-nevoa focus:text-branco-cru" /></form>
              </dd>
              {data.fieldDefs.filter((f) => todosCampos || data.customFields.some((x) => x.fieldId === f.id)).map((f) => (<div key={f.id} className="contents"><dt className="text-nevoa">{f.name}</dt><dd><CampoPersonalizado def={f} valor={data.customFields.find((x) => x.fieldId === f.id)?.value} taskId={taskId} /></dd></div>))}
              {data.fieldDefs.length > data.customFields.length && (<><dt /><dd><button type="button" onClick={() => setTodosCampos((v) => !v)} className="text-xs text-nevoa hover:text-branco-cru">{todosCampos ? 'Ocultar campos vazios' : `Mostrar ${data.fieldDefs.length - data.customFields.length} campos vazios`}</button></dd></>)}
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
                      {c.items.map((i) => (<li key={i.id}><label className={cn('flex items-center gap-2 py-0.5 text-sm', i.done ? 'text-nevoa line-through' : 'text-branco-cru')} style={{ paddingLeft: i.parentItemId ? 20 : 0 }}><input type="checkbox" checked={i.done} onChange={(e) => cl.marcar.mutate({ itemId: i.id, done: e.target.checked })} />{i.text}</label></li>))}
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
                    <div className="min-w-0"><p className="text-xs text-nevoa"><strong className="text-branco-cru">{c.authorName}</strong> · {new Date(c.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p><p className="whitespace-pre-wrap break-words text-sm text-branco-cru"><TextoComMencoes texto={c.body} /></p></div>
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
