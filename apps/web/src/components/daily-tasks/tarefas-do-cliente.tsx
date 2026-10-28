'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus } from 'lucide-react';
import { Modal } from '@/components/comunicacao/modais';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useWorkMembers, useWorkTree } from '@/hooks/use-work';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';

const campo = 'w-full rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none';
interface Resumo { abertas: number; atrasadas: number; concluidas30d: number; proximas: Array<{ id: string; key: string; title: string; dueAt: string | null }> }

function FormularioDeTarefa({ clientId, clienteNome, origem, tituloInicial, onClose }: { clientId: string; clienteNome: string; origem: string; tituloInicial: string; onClose: () => void }) {
  const arvore = useWorkTree().data;
  const membros = useWorkMembers().data?.members ?? [];
  const qc = useQueryClient();
  const listas = (arvore?.spaces ?? []).flatMap((s) => s.lists.filter((l) => !l.archived).map((l) => ({ ...l, espaco: s.name })));
  // A lista do próprio cliente vem marcada; sem ela, a pessoa escolhe.
  const doCliente = listas.find((l) => l.clientId === clientId);
  const [titulo, setTitulo] = useState(tituloInicial);
  const [listId, setListId] = useState('');
  const [resp, setResp] = useState('');
  const [prazo, setPrazo] = useState('');
  const [prio, setPrio] = useState('3');
  const [descricao, setDescricao] = useState('');
  const chave = useState(() => crypto.randomUUID())[0];
  const lista = listId || doCliente?.id || '';
  const criar = useMutation({
    mutationFn: () => apiFetch<{ key: string }>('/work/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
      body: JSON.stringify({
        listId: lista, title: titulo.trim(), clientId, priority: Number(prio),
        description: `${descricao.trim() ? `${descricao.trim()}\n\n` : ''}Origem: ${origem}`,
        ...(resp ? { assigneeIds: [resp] } : {}), ...(prazo ? { dueAt: new Date(`${prazo}T18:00:00`).toISOString() } : {}),
      }),
    }),
    onSuccess: (t) => { void qc.invalidateQueries({ queryKey: ['work'] }); toast(`Tarefa ${t.key} criada para ${clienteNome}.`, 'success'); onClose(); },
    onError: (e) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível criar a tarefa.', 'error'),
  });
  return (
    <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
      <p className="text-xs text-nevoa">Cliente: <strong className="text-branco-cru">{clienteNome}</strong> · {origem}</p>
      <label className="block text-xs text-nevoa">Título<input autoFocus required minLength={3} maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={`${campo} mt-1`} /></label>
      <label className="block text-xs text-nevoa">Detalhes<textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={`${campo} mt-1`} placeholder="O que precisa ser feito, referências, links…" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-nevoa">Lista
          <select required value={lista} onChange={(e) => setListId(e.target.value)} className={`${campo} mt-1`} aria-label="Lista do Daily Tasks"><option value="">Escolha…</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.espaco} › {l.name}</option>)}</select>
        </label>
        <label className="block text-xs text-nevoa">Responsável
          <select value={resp} onChange={(e) => setResp(e.target.value)} className={`${campo} mt-1`}><option value="">Ninguém</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </label>
        <label className="block text-xs text-nevoa">Prazo<input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={`${campo} mt-1`} /></label>
        <label className="block text-xs text-nevoa">Prioridade
          <select value={prio} onChange={(e) => setPrio(e.target.value)} className={`${campo} mt-1`}><option value="1">Urgente</option><option value="2">Alta</option><option value="3">Normal</option><option value="4">Baixa</option></select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
        <button type="submit" disabled={!lista || titulo.trim().length < 3 || criar.isPending} className="rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-medium text-branco-cru disabled:opacity-50">{criar.isPending ? 'Criando…' : 'Criar no Daily Tasks'}</button>
      </div>
    </form>
  );
}

/**
 * Daily Tasks dentro da ficha do cliente e da central de Mídias: quanto há aberto, o que está atrasado e um botão para
 * lançar tarefa já com o cliente preenchido. Some para quem não tem o módulo liberado.
 */
export function TarefasDoCliente({ clientId, clienteNome, origem, tituloInicial = '' }: { clientId: string; clienteNome: string; origem: string; tituloInicial?: string }) {
  const acesso = useDailyTasksAccess().data?.allowed === true;
  const [aberto, setAberto] = useState(false);
  const resumo = useQuery({ queryKey: ['work', 'client-summary', clientId], enabled: acesso, staleTime: 30_000, queryFn: () => apiFetch<Resumo>(`/work/clients/${clientId}/summary`) });
  if (!acesso) return null;
  const r = resumo.data;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/daily-tasks?cli=${clientId}`} title="Ver as tarefas deste cliente no Daily Tasks" className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/60">
        <ListChecks size={14} />
        {r ? <>{r.abertas} aberta{r.abertas === 1 ? '' : 's'}{r.atrasadas > 0 && <span className="text-red-400"> · {r.atrasadas} atrasada{r.atrasadas === 1 ? '' : 's'}</span>}</> : 'Tarefas'}
      </Link>
      <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-white hover:opacity-90"><Plus size={14} /> Nova tarefa</button>
      {aberto && <Modal titulo={`Nova tarefa — ${clienteNome}`} onClose={() => setAberto(false)} largura="max-w-lg"><FormularioDeTarefa clientId={clientId} clienteNome={clienteNome} origem={origem} tituloInicial={tituloInicial} onClose={() => setAberto(false)} /></Modal>}
    </div>
  );
}
