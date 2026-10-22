'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { PRIORIDADES, useSpaceStatuses, useWorkMembers, useWorkTree } from '@/hooks/use-work';
import { useAutomationActions, useAutomationRuns, useAutomations, type WorkAutomation } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';

const GATILHOS: Record<string, string> = {
  task_created: 'Quando uma tarefa for criada', status_changed: 'Quando o status mudar', assigned: 'Quando alguém for atribuído',
  priority_changed: 'Quando a prioridade mudar', comment_added: 'Quando alguém comentar', task_completed: 'Quando a tarefa for concluída', due_date_passed: 'Quando o prazo vencer',
};
const ACOES: Record<string, string> = {
  set_status: 'Mudar status para', set_priority: 'Definir prioridade', assign: 'Adicionar responsável', unassign: 'Remover responsável',
  set_due_in_days: 'Definir prazo (dias a partir de hoje)', add_comment: 'Comentar', add_tag: 'Adicionar tag', create_subtask: 'Criar subtarefa',
};
interface AcaoForm { type: string; valor: string }
const sel = 'rounded border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru outline-none';

function descreve(a: WorkAutomation): string {
  return `${GATILHOS[a.trigger.type] ?? a.trigger.type} → ${a.actions.map((x) => ACOES[x.type] ?? x.type).join(', ')}`;
}

function Execucoes({ id }: { id: string }) {
  const { data } = useAutomationRuns(id);
  if (!data) return <p className="p-2 text-xs text-nevoa">Carregando…</p>;
  if (data.runs.length === 0) return <p className="p-2 text-xs text-nevoa">Nenhuma execução ainda.</p>;
  return (
    <ul className="divide-y divide-grafite-elevado/60 text-xs">
      {data.runs.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-2 py-1">
          <span className={r.status === 'ok' ? 'text-sucesso' : r.status === 'failed' ? 'text-red-400' : 'text-nevoa'}>{r.status === 'ok' ? 'executou' : r.status === 'failed' ? 'falhou' : 'ignorou'}</span>
          <span className="text-nevoa">{new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</span>
          <span className="truncate text-nevoa">{String(r.detail.erro ?? r.detail.motivo ?? (Array.isArray(r.detail.acoes) ? r.detail.acoes.join(', ') : ''))}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AutomacoesPage() {
  const lista = useAutomations();
  const tree = useWorkTree();
  const membros = useWorkMembers().data?.members ?? [];
  const { criar, alternar, apagar } = useAutomationActions();
  const [nome, setNome] = useState('');
  const [listId, setListId] = useState('');
  const [gatilho, setGatilho] = useState('status_changed');
  const [paraStatus, setParaStatus] = useState('');
  const [condPrio, setCondPrio] = useState('');
  const [acoes, setAcoes] = useState<AcaoForm[]>([{ type: 'add_comment', valor: '' }]);
  const [erro, setErro] = useState<string | null>(null);
  const [verRuns, setVerRuns] = useState<string | null>(null);

  const spaces = tree.data?.spaces ?? [];
  const espacoDaLista = useMemo(() => spaces.find((s) => s.lists.some((l) => l.id === listId))?.id ?? null, [spaces, listId]);
  const statuses = useSpaceStatuses(espacoDaLista).data?.statuses ?? [];

  const salvar = () => {
    setErro(null);
    const config = (a: AcaoForm): Record<string, unknown> => {
      switch (a.type) {
        case 'set_status': return { statusId: a.valor };
        case 'set_priority': return { priority: Number(a.valor) };
        case 'assign': case 'unassign': return { userId: a.valor };
        case 'set_due_in_days': return { days: Number(a.valor) };
        case 'add_comment': return { text: a.valor };
        case 'add_tag': return { tag: a.valor };
        default: return { title: a.valor };
      }
    };
    criar.mutate(
      {
        name: nome.trim(), spaceId: null, listId: listId || null,
        trigger: { type: gatilho, ...(gatilho === 'status_changed' && paraStatus ? { config: { toStatusId: paraStatus } } : {}) },
        conditions: condPrio ? [{ field: 'priority', op: 'eq', value: Number(condPrio) }] : [],
        actions: acoes.map((a) => ({ type: a.type, config: config(a) })),
      },
      { onSuccess: () => { setNome(''); setAcoes([{ type: 'add_comment', valor: '' }]); }, onError: (e) => setErro(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.') },
    );
  };
  const pronto = nome.trim() && acoes.every((a) => a.valor !== '');

  return (
    <div className="space-y-6">
      <Surface className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-branco-cru"><Zap size={15} /> Nova automação</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: Avisar ao concluir)" aria-label="Nome da automação" className={`${sel} md:col-span-2`} />
          <label className="space-y-1 text-xs text-nevoa">Onde vale
            <select value={listId} onChange={(e) => { setListId(e.target.value); setParaStatus(''); }} className={`${sel} block w-full`} aria-label="Escopo">
              <option value="">Toda a empresa</option>
              {spaces.map((s) => <optgroup key={s.id} label={s.name}>{s.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-nevoa">Quando
            <select value={gatilho} onChange={(e) => setGatilho(e.target.value)} className={`${sel} block w-full`} aria-label="Gatilho">{Object.entries(GATILHOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          {gatilho === 'status_changed' && (
            <label className="space-y-1 text-xs text-nevoa">…para o status (opcional — escolha uma lista acima)
              <select value={paraStatus} onChange={(e) => setParaStatus(e.target.value)} className={`${sel} block w-full`} aria-label="Para o status"><option value="">Qualquer</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
          <label className="space-y-1 text-xs text-nevoa">Somente se a prioridade for (opcional)
            <select value={condPrio} onChange={(e) => setCondPrio(e.target.value)} className={`${sel} block w-full`} aria-label="Condição de prioridade"><option value="">Qualquer</option>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}</select>
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-nevoa">Então</p>
          {acoes.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select value={a.type} onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { type: e.target.value, valor: '' } : x)))} className={sel} aria-label={`Ação ${i + 1}`}>{Object.entries(ACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {a.type === 'set_status' ? (
                <select value={a.valor} onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} className={sel} aria-label="Status da ação"><option value="">{listId ? 'Escolha' : 'Escolha uma lista acima'}</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              ) : a.type === 'set_priority' ? (
                <select value={a.valor} onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} className={sel} aria-label="Prioridade da ação"><option value="">Escolha</option>{[1, 2, 3, 4, 0].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}</select>
              ) : a.type === 'assign' || a.type === 'unassign' ? (
                <select value={a.valor} onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} className={sel} aria-label="Pessoa da ação"><option value="">Escolha</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              ) : (
                <input value={a.valor} type={a.type === 'set_due_in_days' ? 'number' : 'text'} onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} placeholder={a.type === 'add_comment' ? 'Texto do comentário' : a.type === 'add_tag' ? 'Tag' : a.type === 'create_subtask' ? 'Título da subtarefa' : 'Dias'} className={`${sel} min-w-64`} aria-label="Valor da ação" />
              )}
              {acoes.length > 1 && <button type="button" aria-label="Remover ação" onClick={() => setAcoes(acoes.filter((_, j) => j !== i))} className="text-nevoa hover:text-red-400"><Trash2 size={14} /></button>}
            </div>
          ))}
          <button type="button" onClick={() => setAcoes([...acoes, { type: 'add_tag', valor: '' }])} className="flex items-center gap-1 text-xs text-nevoa hover:text-branco-cru"><Plus size={12} /> Adicionar ação</button>
        </div>
        {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
        <button type="button" disabled={!pronto || criar.isPending} onClick={salvar} className="rounded bg-sinal px-3 py-1.5 text-sm font-semibold text-grafite disabled:opacity-40">Criar automação</button>
      </Surface>

      {lista.isPending ? <Skeleton className="h-32 w-full" /> : (lista.data?.automations.length ?? 0) === 0 ? (
        <EmptyState icon={Zap} title="Nenhuma automação ainda" description="Crie a primeira acima. Cada execução fica registrada aqui." />
      ) : (
        <ul className="space-y-2">
          {lista.data!.automations.map((a) => (
            <li key={a.id} className="rounded-lg border border-grafite-elevado">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                <label className="flex items-center gap-2 text-sm text-branco-cru"><input type="checkbox" checked={a.enabled} onChange={(e) => alternar.mutate({ id: a.id, enabled: e.target.checked })} aria-label={`Ativar ${a.name}`} />{a.name}</label>
                <span className="min-w-0 flex-1 truncate text-xs text-nevoa">{descreve(a)}</span>
                <button type="button" onClick={() => setVerRuns(verRuns === a.id ? null : a.id)} className="text-xs text-nevoa hover:text-branco-cru">{a.runCount} execuções</button>
                <button type="button" aria-label={`Apagar ${a.name}`} onClick={() => { if (window.confirm(`Apagar a automação "${a.name}"?`)) apagar.mutate(a.id); }} className="text-nevoa hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              {verRuns === a.id && <div className="border-t border-grafite-elevado"><Execucoes id={a.id} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
