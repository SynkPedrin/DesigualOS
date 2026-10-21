'use client';

import { Check } from 'lucide-react';
import { PRIORIDADES, type WorkMember, type WorkStatus, type WorkTaskWire } from '@/hooks/use-work';
import { Avatar, AvatarStack, DueDate, Popover, PriorityFlag, StatusPill } from './primitivas';

const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-branco-cru hover:bg-grafite-elevado';

export function StatusPicker({ tarefa, statuses, onChange }: { tarefa: WorkTaskWire; statuses: WorkStatus[]; onChange: (statusId: string) => void }) {
  const s = tarefa.status;
  return (
    <Popover label={`Status de ${tarefa.key}`} trigger={s ? <StatusPill nome={s.name} cor={s.color} categoria={s.category} tamanho="sm" /> : <span className="text-xs text-nevoa">—</span>}>
      {(fechar) => statuses.map((x) => (
        <button key={x.id} type="button" className={item} onClick={() => { fechar(); if (x.id !== tarefa.statusId) onChange(x.id); }}>
          <StatusPill nome={x.name} cor={x.color} categoria={x.category} tamanho="sm" />
          {x.id === tarefa.statusId && <Check size={12} className="ml-auto" />}
        </button>
      ))}
    </Popover>
  );
}

export function PriorityPicker({ tarefa, onChange, comTexto }: { tarefa: WorkTaskWire; onChange: (p: number) => void; comTexto?: boolean }) {
  return (
    <Popover label={`Prioridade de ${tarefa.key}`} trigger={<PriorityFlag valor={tarefa.priority} {...(comTexto !== undefined ? { comTexto } : {})} />}>
      {(fechar) => [1, 2, 3, 4, 0].map((p) => (
        <button key={p} type="button" className={item} onClick={() => { fechar(); if (p !== tarefa.priority) onChange(p); }}>
          <PriorityFlag valor={p} comTexto />
          {PRIORIDADES[p] && p === tarefa.priority && <Check size={12} className="ml-auto" />}
        </button>
      ))}
    </Popover>
  );
}

export function AssigneePicker({ tarefa, membros, onChange }: { tarefa: WorkTaskWire; membros: WorkMember[]; onChange: (ids: string[]) => void }) {
  const mapa = new Map(membros.map((m) => [m.id, m]));
  return (
    <Popover label={`Responsáveis de ${tarefa.key}`} trigger={<AvatarStack ids={tarefa.assigneeIds} membros={mapa} />}>
      {() => (
        <div className="max-h-64 overflow-y-auto">
          {membros.map((m) => {
            const marcado = tarefa.assigneeIds.includes(m.id);
            return (
              <button key={m.id} type="button" className={item} onClick={() => onChange(marcado ? tarefa.assigneeIds.filter((i) => i !== m.id) : [...tarefa.assigneeIds, m.id])}>
                <Avatar nome={m.name} url={m.avatarUrl} size={20} />
                <span className="truncate">{m.name}</span>
                {marcado && <Check size={12} className="ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

export function DuePicker({ tarefa, onChange }: { tarefa: WorkTaskWire; onChange: (iso: string | null) => void }) {
  const valor = tarefa.dueAt ? tarefa.dueAt.slice(0, 10) : '';
  return (
    <Popover label={`Vencimento de ${tarefa.key}`} trigger={<DueDate tarefa={tarefa} />}>
      {(fechar) => (
        <div className="space-y-1 p-1">
          <input
            type="date"
            value={valor}
            onChange={(e) => { fechar(); onChange(e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null); }}
            className="rounded border border-grafite-elevado bg-grafite px-2 py-1 text-xs text-branco-cru"
          />
          {tarefa.dueAt && <button type="button" className={item} onClick={() => { fechar(); onChange(null); }}>Limpar data</button>}
        </div>
      )}
    </Popover>
  );
}
