'use client';

import { Check } from 'lucide-react';
import { PRIORIDADES, type WorkMember, type WorkStatus, type WorkTaskWire } from '@/hooks/use-work';
import { Avatar, AvatarStack, DueDate, Popover, PriorityFlag, StatusPill } from './primitivas';
import { EmblemaDePrioridade } from './ui';
import { Calendario, instanteDoDia } from './calendario';
import { diaEmSaoPaulo } from '@/lib/prazo';

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

export function PriorityPicker({ tarefa, onChange, comTexto, badge }: { tarefa: WorkTaskWire; onChange: (p: number) => void; comTexto?: boolean; badge?: boolean }) {
  return (
    <Popover label={`Prioridade de ${tarefa.key}`} trigger={badge ? <EmblemaDePrioridade valor={tarefa.priority} /> : <PriorityFlag valor={tarefa.priority} {...(comTexto !== undefined ? { comTexto } : {})} />}>
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
                {m.soNoClickUp && <span className="shrink-0 text-[10px] text-nevoa/60" title="Ainda não entrou no OS; a tarefa chega a ela pelo ClickUp">ClickUp</span>}
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
  const valor = tarefa.dueAt ? diaEmSaoPaulo(tarefa.dueAt) : null;
  return (
    <Popover label={`Vencimento de ${tarefa.key}`} trigger={<DueDate tarefa={tarefa} />} alturaMax={420} largura={272}>
      {(fechar) => <Calendario valor={valor} onEscolher={(dia) => { fechar(); onChange(instanteDoDia(dia)); }} />}
    </Popover>
  );
}
