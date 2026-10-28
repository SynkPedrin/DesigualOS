'use client';

import { useState } from 'react';
import { BadgeCheck, Clock, MessageSquareWarning, XCircle } from 'lucide-react';
import type { WorkMember } from '@/hooks/use-work';
import { useApprovalActions, useTaskApprovals, type TaskApproval } from '@/hooks/use-work-extra';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';

const ROTULO: Record<TaskApproval['status'], { texto: string; cor: string }> = {
  pending: { texto: 'Aguardando', cor: 'bg-aviso/15 text-aviso' },
  approved: { texto: 'Aprovada', cor: 'bg-sucesso/15 text-sucesso' },
  rejected: { texto: 'Reprovada', cor: 'bg-red-500/15 text-red-400' },
  changes_requested: { texto: 'Pediu ajustes', cor: 'bg-roxo-eletrico/15 text-roxo-eletrico' },
};
const quando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Aprovação dentro da tarefa. É a MESMA fila da tela Aprovações: responder aqui ou lá dá no mesmo. */
export function AprovacaoDaTarefa({ taskId, membros, eu }: { taskId: string; membros: WorkMember[]; eu: string | null }) {
  const lista = useTaskApprovals(taskId).data?.approvals ?? [];
  const { pedir, responder } = useApprovalActions(taskId);
  const [aprovador, setAprovador] = useState('');
  const [nota, setNota] = useState('');
  const [comentario, setComentario] = useState('');
  const aberta = lista.find((a) => a.status === 'pending') ?? null;
  const erro = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível concluir.', 'error');
  const euPosso = aberta !== null && eu !== null && aberta.requestedBy !== eu && (aberta.approverId === null || aberta.approverId === eu);
  const decidir = (status: 'approved' | 'rejected' | 'changes_requested') => aberta && responder.mutate({ id: aberta.id, status, comment: comentario.trim() || null }, { onSuccess: () => { setComentario(''); toast('Resposta registrada.', 'success'); }, onError: erro });

  return (
    <div className="space-y-3">
      {lista.length === 0 && <p className="text-sm text-nevoa">Nenhuma aprovação pedida para esta tarefa.</p>}
      <ul className="space-y-2">
        {lista.map((a) => (
          <li key={a.id} className="rounded-lg border border-grafite-elevado p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${ROTULO[a.status].cor}`}>{ROTULO[a.status].texto}</span>
              <span className="text-xs text-nevoa">{a.requestedByName} pediu{a.approverName ? ` · respondida por ${a.approverName}` : a.approverId ? '' : ' · qualquer administrador'} · {quando(a.resolvedAt ?? a.createdAt)}</span>
            </div>
            {a.comment && <p className="mt-1.5 text-branco-cru">“{a.comment}”</p>}
          </li>
        ))}
      </ul>
      {euPosso && (
        <div className="space-y-2 rounded-lg bg-aviso/5 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-aviso"><Clock size={13} /> Esta aprovação espera por você</p>
          <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentário (obrigatório para reprovar ou pedir ajustes)" aria-label="Comentário da resposta" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1.5 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={responder.isPending} onClick={() => decidir('approved')} className="flex items-center gap-1.5 rounded-lg bg-sucesso px-3 py-1.5 text-sm font-semibold text-carbono disabled:opacity-50"><BadgeCheck size={14} /> Aprovar</button>
            <button type="button" disabled={responder.isPending} onClick={() => decidir('changes_requested')} className="flex items-center gap-1.5 rounded-lg border border-grafite-elevado px-3 py-1.5 text-sm text-branco-cru disabled:opacity-50"><MessageSquareWarning size={14} /> Pedir ajustes</button>
            <button type="button" disabled={responder.isPending} onClick={() => decidir('rejected')} className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 disabled:opacity-50"><XCircle size={14} /> Reprovar</button>
          </div>
        </div>
      )}
      {!aberta && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); pedir.mutate({ approverId: aprovador || null, note: nota.trim() || null }, { onSuccess: () => { setNota(''); toast('Aprovação pedida.', 'success'); }, onError: erro }); }}>
          <select value={aprovador} onChange={(e) => setAprovador(e.target.value)} aria-label="Quem aprova" className="rounded border border-grafite-elevado bg-grafite px-2 py-1.5 text-sm text-branco-cru">
            <option value="">Qualquer administrador</option>
            {membros.filter((m) => m.id !== eu).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Recado (opcional)" aria-label="Recado para quem aprova" className="min-w-40 flex-1 rounded border border-grafite-elevado bg-transparent px-2 py-1.5 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
          <button type="submit" disabled={pedir.isPending} className="rounded-lg bg-sinal px-3 py-1.5 text-sm font-semibold text-grafite disabled:opacity-50">Pedir aprovação</button>
        </form>
      )}
    </div>
  );
}
