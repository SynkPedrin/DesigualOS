'use client';

import { useMemo, useState } from 'react';
import { Pencil, Play, Plus, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { PRIORIDADES, useSpaceStatuses, useWorkMembers, useWorkTasks, useWorkTree } from '@/hooks/use-work';
import { useAutomationActions, useAutomationRuns, useAutomations, useTestAutomation, useUpdateAutomation, type WorkAutomation } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const GATILHOS: Record<string, string> = {
  task_created: 'uma tarefa for criada', status_changed: 'o status mudar', assigned: 'alguém for atribuído', priority_changed: 'a prioridade mudar',
  comment_added: 'alguém comentar', task_completed: 'a tarefa for concluída', due_date_passed: 'o prazo vencer', due_soon: 'faltarem poucos dias para o prazo', task_moved: 'a tarefa mudar de lista',
};
const ACOES: Record<string, string> = {
  set_status: 'mudar o status para', set_priority: 'definir a prioridade', assign: 'adicionar responsável', unassign: 'remover responsável',
  set_due_in_days: 'definir o prazo (dias a partir de hoje)', add_comment: 'comentar', add_tag: 'adicionar a tag', create_subtask: 'criar a subtarefa', notify: 'avisar', move_to_list: 'mover para a lista',
};
const CONDICOES: Record<string, string> = { priority: 'a prioridade for', hasAssignee: 'tiver responsável', hasDue: 'tiver prazo', tag: 'tiver a tag' };

interface AcaoForm { type: string; valor: string; extra: string }
interface Form { nome: string; listId: string; gatilho: string; paraStatus: string; dias: string; condicoes: Array<{ field: string; valor: string }>; acoes: AcaoForm[] }
const vazio = (): Form => ({ nome: '', listId: '', gatilho: 'status_changed', paraStatus: '', dias: '2', condicoes: [], acoes: [{ type: 'notify', valor: 'assignees', extra: '' }] });

const RECEITAS: Array<{ titulo: string; descricao: string; form: () => Form }> = [
  { titulo: 'Avisar quem foi atribuído', descricao: 'Quando alguém for atribuído, manda um aviso para os responsáveis.', form: () => ({ ...vazio(), nome: 'Avisar responsáveis ao atribuir', gatilho: 'assigned', acoes: [{ type: 'notify', valor: 'assignees', extra: 'Você recebeu uma tarefa' }] }) },
  { titulo: 'Prazo vencido vira urgente', descricao: 'Quando o prazo vencer, marca prioridade Urgente e avisa.', form: () => ({ ...vazio(), nome: 'Vencida → urgente', gatilho: 'due_date_passed', acoes: [{ type: 'set_priority', valor: '1', extra: '' }, { type: 'notify', valor: 'assignees', extra: 'Prazo vencido' }] }) },
  { titulo: 'Lembrar antes do prazo', descricao: 'Faltando 2 dias, avisa os responsáveis e põe a tag "prazo-proximo".', form: () => ({ ...vazio(), nome: 'Aviso de prazo próximo', gatilho: 'due_soon', dias: '2', acoes: [{ type: 'notify', valor: 'assignees', extra: 'Prazo chegando' }, { type: 'add_tag', valor: 'prazo-proximo', extra: '' }] }) },
  { titulo: 'Comentar ao concluir', descricao: 'Ao concluir, registra um comentário e avisa quem criou.', form: () => ({ ...vazio(), nome: 'Concluída → registrar', gatilho: 'task_completed', acoes: [{ type: 'add_comment', valor: 'Tarefa concluída.', extra: '' }, { type: 'notify', valor: 'creator', extra: 'Sua tarefa foi concluída' }] }) },
  { titulo: 'Nova tarefa sem responsável', descricao: 'Ao criar uma tarefa sem responsável, aplica a tag "triagem".', form: () => ({ ...vazio(), nome: 'Triagem de tarefa sem dono', gatilho: 'task_created', condicoes: [{ field: 'hasAssignee', valor: 'false' }], acoes: [{ type: 'add_tag', valor: 'triagem', extra: '' }] }) },
  { titulo: 'Urgente avisa o time', descricao: 'Quando a prioridade virar Urgente, avisa os responsáveis.', form: () => ({ ...vazio(), nome: 'Prioridade urgente', gatilho: 'priority_changed', condicoes: [{ field: 'priority', valor: '1' }], acoes: [{ type: 'notify', valor: 'assignees', extra: 'Esta tarefa virou URGENTE' }] }) },
];

const sel = 'rounded border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru outline-none';

function deAutomacao(a: WorkAutomation): Form {
  const cfg = (x: { config?: Record<string, unknown> }) => x.config ?? {};
  return {
    nome: a.name, listId: a.listId ?? '', gatilho: a.trigger.type, paraStatus: String(a.trigger.config?.toStatusId ?? ''), dias: String(a.trigger.config?.days ?? '2'),
    condicoes: a.conditions.map((c) => ({ field: c.field, valor: String(c.value) })),
    acoes: a.actions.map((x) => ({
      type: x.type,
      valor: String(x.type === 'set_status' ? cfg(x).statusId : x.type === 'set_priority' ? cfg(x).priority : x.type === 'assign' || x.type === 'unassign' ? cfg(x).userId : x.type === 'set_due_in_days' ? cfg(x).days : x.type === 'add_comment' ? cfg(x).text : x.type === 'add_tag' ? cfg(x).tag : x.type === 'create_subtask' ? cfg(x).title : x.type === 'move_to_list' ? cfg(x).listId : cfg(x).target === 'user' ? cfg(x).userId : cfg(x).target ?? 'assignees'),
      extra: x.type === 'notify' ? String(cfg(x).message ?? '') : '',
    })),
  };
}

function paraApi(f: Form) {
  const config = (a: AcaoForm): Record<string, unknown> => {
    switch (a.type) {
      case 'set_status': return { statusId: a.valor };
      case 'set_priority': return { priority: Number(a.valor) };
      case 'assign': case 'unassign': return { userId: a.valor };
      case 'set_due_in_days': return { days: Number(a.valor) };
      case 'add_comment': return { text: a.valor };
      case 'add_tag': return { tag: a.valor };
      case 'move_to_list': return { listId: a.valor };
      case 'notify': return a.valor === 'assignees' || a.valor === 'creator' ? { target: a.valor, message: a.extra } : { target: 'user', userId: a.valor, message: a.extra };
      default: return { title: a.valor };
    }
  };
  return {
    name: f.nome.trim(), spaceId: null as string | null, listId: f.listId || null,
    trigger: { type: f.gatilho, ...(f.gatilho === 'status_changed' && f.paraStatus ? { config: { toStatusId: f.paraStatus } } : {}), ...(f.gatilho === 'due_soon' ? { config: { days: Number(f.dias) } } : {}) },
    conditions: f.condicoes.map((c) => ({ field: c.field, op: 'eq', value: c.field === 'hasAssignee' || c.field === 'hasDue' ? c.valor === 'true' : c.field === 'priority' ? Number(c.valor) : c.valor })),
    actions: f.acoes.map((a) => ({ type: a.type, config: config(a) })),
  };
}

function Execucoes({ id }: { id: string }) {
  const { data } = useAutomationRuns(id);
  if (!data) return <p className="p-3 text-xs text-nevoa">Carregando…</p>;
  if (data.runs.length === 0) return <p className="p-3 text-xs text-nevoa">Nenhuma execução ainda. Use "Executar agora" para testar numa tarefa.</p>;
  return (
    <ul className="divide-y divide-grafite-elevado/60 text-xs">
      {data.runs.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-3 py-1.5">
          <span className={cn('w-16 font-medium', r.status === 'ok' ? 'text-sucesso' : r.status === 'failed' ? 'text-red-400' : 'text-nevoa')}>{r.status === 'ok' ? 'executou' : r.status === 'failed' ? 'falhou' : 'ignorou'}</span>
          <span className="text-nevoa">{new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</span>
          {r.taskId && <a href={`/daily-tasks?task=${r.taskId}`} className="text-sinal hover:underline">abrir tarefa</a>}
          <span className="truncate text-nevoa">{String(r.detail.erro ?? r.detail.motivo ?? (Array.isArray(r.detail.acoes) ? r.detail.acoes.join(', ') : ''))}</span>
        </li>
      ))}
    </ul>
  );
}

function ExecutarAgora({ auto, onClose }: { auto: WorkAutomation; onClose: () => void }) {
  const [q, setQ] = useState('');
  const busca = useWorkTasks({ q: q.trim() || undefined, limit: 8, includeSubtasks: true, listId: auto.listId, enabled: q.trim().length >= 2 });
  const testar = useTestAutomation();
  return (
    <div className="space-y-2 border-t border-grafite-elevado p-3">
      <p className="text-xs text-nevoa">Escolha a tarefa. As condições continuam valendo e <strong className="text-branco-cru">as ações são reais</strong> (mudam a tarefa de verdade).</p>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefa por DT-123 ou título" aria-label="Buscar tarefa para executar" className={cn(sel, 'w-full')} />
      <ul className="space-y-1">
        {(busca.data?.rows ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-[11px] text-nevoa">{t.key}</span><span className="min-w-0 flex-1 truncate text-branco-cru">{t.title}</span>
            <button type="button" disabled={testar.isPending} onClick={() => testar.mutate({ id: auto.id, taskId: t.id }, { onSuccess: (r) => { toast(r.status === 'ok' ? `Executou: ${(r.detail.acoes as string[] | undefined)?.join(', ')}` : r.status === 'skipped' ? 'Não executou: as condições não bateram nesta tarefa.' : `Falhou: ${String(r.detail.erro)}`, r.status === 'ok' ? 'success' : r.status === 'skipped' ? 'info' : 'error'); onClose(); }, onError: (e) => toast(e instanceof ApiRequestError ? e.message : 'Erro ao executar.', 'error') })} className="flex items-center gap-1 rounded bg-sinal px-2 py-1 text-xs font-semibold text-grafite disabled:opacity-40"><Play size={11} /> Executar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AutomacoesPage() {
  const lista = useAutomations();
  const tree = useWorkTree();
  const membros = useWorkMembers().data?.members ?? [];
  const { criar, alternar, apagar } = useAutomationActions();
  const atualizar = useUpdateAutomation();
  const [form, setForm] = useState<Form>(vazio());
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verRuns, setVerRuns] = useState<string | null>(null);
  const [executar, setExecutar] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const spaces = tree.data?.spaces ?? [];
  const todasListas = spaces.flatMap((s) => s.lists.map((l) => ({ id: l.id, rotulo: `${s.name} › ${l.name}` })));
  const espacoDaLista = useMemo(() => spaces.find((s) => s.lists.some((l) => l.id === form.listId))?.id ?? null, [spaces, form.listId]);
  const statuses = useSpaceStatuses(espacoDaLista).data?.statuses ?? [];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAcao = (i: number, p: Partial<AcaoForm>) => setForm((f) => ({ ...f, acoes: f.acoes.map((a, j) => (j === i ? { ...a, ...p } : a)) }));

  const frase = () => {
    const g = `Quando ${GATILHOS[form.gatilho]}${form.gatilho === 'due_soon' ? ` (${form.dias} dia(s) antes)` : ''}`;
    const c = form.condicoes.length ? `, se ${form.condicoes.map((x) => `${CONDICOES[x.field]}${x.field === 'priority' ? ` ${PRIORIDADES[Number(x.valor)]?.label ?? ''}` : x.field === 'tag' ? ` "${x.valor}"` : x.valor === 'false' ? ' (não)' : ''}`).join(' e ')}` : '';
    return `${g}${c}, então ${form.acoes.map((a) => `${ACOES[a.type]}${a.type === 'notify' ? ` ${a.valor === 'assignees' ? 'os responsáveis' : a.valor === 'creator' ? 'quem criou' : 'a pessoa escolhida'}` : a.valor && !['assign', 'unassign', 'set_status', 'move_to_list', 'set_priority'].includes(a.type) ? ` "${a.valor}"` : ''}`).join(' e ')}.`;
  };
  const pronto = form.nome.trim() && form.acoes.length > 0 && form.acoes.every((a) => a.valor !== '') && form.condicoes.every((c) => c.valor !== '');

  const salvar = () => {
    setErro(null);
    const corpo = paraApi(form);
    const ok = () => { toast(editando ? 'Automação atualizada.' : 'Automação criada.', 'success'); setForm(vazio()); setEditando(null); setAberto(false); };
    const falha = (e: unknown) => setErro(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');
    if (editando) atualizar.mutate({ id: editando, ...corpo }, { onSuccess: ok, onError: falha });
    else criar.mutate(corpo, { onSuccess: ok, onError: falha });
  };

  return (
    <div className="space-y-6">
      <section aria-label="Receitas prontas" className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-branco-cru"><Sparkles size={15} /> Comece por uma receita</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {RECEITAS.map((r) => (
            <button key={r.titulo} type="button" onClick={() => { setForm(r.form()); setEditando(null); setAberto(true); setErro(null); }} className="rounded-lg border border-grafite-elevado bg-grafite p-3 text-left transition-colors hover:border-sinal/60">
              <span className="block text-sm font-medium text-branco-cru">{r.titulo}</span><span className="mt-1 block text-xs text-nevoa">{r.descricao}</span>
            </button>
          ))}
        </div>
      </section>

      {!aberto ? (
        <button type="button" onClick={() => { setForm(vazio()); setEditando(null); setAberto(true); }} className="flex items-center gap-2 rounded bg-sinal px-3 py-2 text-sm font-semibold text-grafite"><Plus size={14} /> Nova automação do zero</button>
      ) : (
        <Surface className="space-y-4 p-4">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-branco-cru"><Zap size={15} /> {editando ? 'Editar automação' : 'Nova automação'}</h2><button type="button" aria-label="Fechar editor" onClick={() => { setAberto(false); setEditando(null); setForm(vazio()); }} className="text-nevoa hover:text-branco-cru"><X size={15} /></button></div>
          <input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Nome (ex.: Avisar ao concluir)" aria-label="Nome da automação" className={cn(sel, 'w-full')} />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-nevoa">Onde vale
              <select value={form.listId} onChange={(e) => setForm((f) => ({ ...f, listId: e.target.value, paraStatus: '' }))} className={cn(sel, 'block w-full')} aria-label="Escopo">
                <option value="">Toda a empresa</option>{spaces.map((s) => <optgroup key={s.id} label={s.name}>{s.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-nevoa">QUANDO
              <select value={form.gatilho} onChange={(e) => set('gatilho', e.target.value)} className={cn(sel, 'block w-full')} aria-label="Gatilho">{Object.entries(GATILHOS).map(([k, v]) => <option key={k} value={k}>{v[0]!.toUpperCase() + v.slice(1)}</option>)}</select>
            </label>
            {form.gatilho === 'status_changed' && (
              <label className="space-y-1 text-xs text-nevoa">…para o status (escolha uma lista acima)
                <select value={form.paraStatus} onChange={(e) => set('paraStatus', e.target.value)} className={cn(sel, 'block w-full')} aria-label="Para o status"><option value="">Qualquer</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
            )}
            {form.gatilho === 'due_soon' && <label className="space-y-1 text-xs text-nevoa">Quantos dias antes<input type="number" min={0} max={60} value={form.dias} onChange={(e) => set('dias', e.target.value)} aria-label="Dias antes do prazo" className={cn(sel, 'block w-full')} /></label>}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-nevoa">SE (opcional)</p>
            {form.condicoes.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select value={c.field} onChange={(e) => setForm((f) => ({ ...f, condicoes: f.condicoes.map((x, j) => (j === i ? { field: e.target.value, valor: e.target.value === 'priority' ? '1' : e.target.value === 'tag' ? '' : 'true' } : x)) }))} className={sel} aria-label={`Condição ${i + 1}`}>{Object.entries(CONDICOES).map(([k, v]) => <option key={k} value={k}>{v[0]!.toUpperCase() + v.slice(1)}</option>)}</select>
                {c.field === 'priority' ? <select value={c.valor} onChange={(e) => setForm((f) => ({ ...f, condicoes: f.condicoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) }))} className={sel} aria-label="Prioridade da condição">{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}</select>
                  : c.field === 'tag' ? <input value={c.valor} onChange={(e) => setForm((f) => ({ ...f, condicoes: f.condicoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) }))} placeholder="tag" aria-label="Tag da condição" className={sel} />
                  : <select value={c.valor} onChange={(e) => setForm((f) => ({ ...f, condicoes: f.condicoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) }))} className={sel} aria-label="Sim ou não"><option value="true">Sim</option><option value="false">Não</option></select>}
                <button type="button" aria-label="Remover condição" onClick={() => setForm((f) => ({ ...f, condicoes: f.condicoes.filter((_, j) => j !== i) }))} className="text-nevoa hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setForm((f) => ({ ...f, condicoes: [...f.condicoes, { field: 'priority', valor: '1' }] }))} className="flex items-center gap-1 text-xs text-nevoa hover:text-branco-cru"><Plus size={12} /> Adicionar condição</button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-nevoa">ENTÃO</p>
            {form.acoes.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select value={a.type} onChange={(e) => setAcao(i, { type: e.target.value, valor: e.target.value === 'notify' ? 'assignees' : '', extra: '' })} className={sel} aria-label={`Ação ${i + 1}`}>{Object.entries(ACOES).map(([k, v]) => <option key={k} value={k}>{v[0]!.toUpperCase() + v.slice(1)}</option>)}</select>
                {a.type === 'set_status' ? <select value={a.valor} onChange={(e) => setAcao(i, { valor: e.target.value })} className={sel} aria-label="Status da ação"><option value="">{form.listId ? 'Escolha' : 'Escolha uma lista acima'}</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  : a.type === 'set_priority' ? <select value={a.valor} onChange={(e) => setAcao(i, { valor: e.target.value })} className={sel} aria-label="Prioridade da ação"><option value="">Escolha</option>{[1, 2, 3, 4, 0].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}</select>
                  : a.type === 'assign' || a.type === 'unassign' ? <select value={a.valor} onChange={(e) => setAcao(i, { valor: e.target.value })} className={sel} aria-label="Pessoa da ação"><option value="">Escolha</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                  : a.type === 'move_to_list' ? <select value={a.valor} onChange={(e) => setAcao(i, { valor: e.target.value })} className={cn(sel, 'max-w-72')} aria-label="Lista de destino"><option value="">Escolha a lista</option>{todasListas.map((l) => <option key={l.id} value={l.id}>{l.rotulo}</option>)}</select>
                  : a.type === 'notify' ? (<>
                      <select value={a.valor} onChange={(e) => setAcao(i, { valor: e.target.value })} className={sel} aria-label="Quem avisar"><option value="assignees">Os responsáveis</option><option value="creator">Quem criou</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                      <input value={a.extra} onChange={(e) => setAcao(i, { extra: e.target.value })} placeholder="Mensagem do aviso" aria-label="Mensagem do aviso" className={cn(sel, 'min-w-56 flex-1')} />
                    </>)
                  : <input value={a.valor} type={a.type === 'set_due_in_days' ? 'number' : 'text'} onChange={(e) => setAcao(i, { valor: e.target.value })} placeholder={a.type === 'add_comment' ? 'Texto do comentário' : a.type === 'add_tag' ? 'Tag' : a.type === 'create_subtask' ? 'Título da subtarefa' : 'Dias'} className={cn(sel, 'min-w-64')} aria-label="Valor da ação" />}
                {form.acoes.length > 1 && <button type="button" aria-label="Remover ação" onClick={() => setForm((f) => ({ ...f, acoes: f.acoes.filter((_, j) => j !== i) }))} className="text-nevoa hover:text-red-400"><Trash2 size={14} /></button>}
              </div>
            ))}
            <button type="button" onClick={() => setForm((f) => ({ ...f, acoes: [...f.acoes, { type: 'add_tag', valor: '', extra: '' }] }))} className="flex items-center gap-1 text-xs text-nevoa hover:text-branco-cru"><Plus size={12} /> Adicionar ação</button>
          </div>
          <p className="rounded bg-grafite-elevado/50 px-3 py-2 text-sm text-branco-cru" aria-live="polite"><span className="text-nevoa">Resumo: </span>{frase()}</p>
          {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
          <button type="button" disabled={!pronto || criar.isPending || atualizar.isPending} onClick={salvar} className="rounded bg-sinal px-3 py-1.5 text-sm font-semibold text-grafite disabled:opacity-40">{editando ? 'Salvar alterações' : 'Criar automação'}</button>
        </Surface>
      )}

      {lista.isPending ? <Skeleton className="h-32 w-full" /> : (lista.data?.automations.length ?? 0) === 0 ? (
        <EmptyState icon={Zap} title="Nenhuma automação ainda" description="Escolha uma receita acima ou crie do zero. Cada execução fica registrada aqui." />
      ) : (
        <ul className="space-y-2" aria-label="Automações criadas">
          {lista.data!.automations.map((a) => (
            <li key={a.id} className="rounded-lg border border-grafite-elevado">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <label className="flex items-center gap-2 text-sm font-medium text-branco-cru"><input type="checkbox" checked={a.enabled} onChange={(e) => alternar.mutate({ id: a.id, enabled: e.target.checked })} aria-label={`Ativar ${a.name}`} />{a.name}</label>
                <span className="min-w-0 flex-1 truncate text-xs text-nevoa">Quando {GATILHOS[a.trigger.type] ?? a.trigger.type} → {a.actions.map((x) => ACOES[x.type] ?? x.type).join(', ')}{a.listId ? ` · ${todasListas.find((l) => l.id === a.listId)?.rotulo ?? ''}` : ' · toda a empresa'}</span>
                <button type="button" onClick={() => setExecutar(executar === a.id ? null : a.id)} className="flex items-center gap-1 rounded border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru"><Play size={11} /> Executar agora</button>
                <button type="button" onClick={() => { setForm(deAutomacao(a)); setEditando(a.id); setAberto(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={`Editar ${a.name}`} className="text-nevoa hover:text-branco-cru"><Pencil size={14} /></button>
                <button type="button" onClick={() => setVerRuns(verRuns === a.id ? null : a.id)} className="text-xs text-nevoa hover:text-branco-cru">{a.runCount} execuções</button>
                <button type="button" aria-label={`Apagar ${a.name}`} onClick={() => { if (window.confirm(`Apagar a automação "${a.name}"?`)) apagar.mutate(a.id); }} className="text-nevoa hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              {executar === a.id && <ExecutarAgora auto={a} onClose={() => setExecutar(null)} />}
              {verRuns === a.id && <div className="border-t border-grafite-elevado"><Execucoes id={a.id} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
