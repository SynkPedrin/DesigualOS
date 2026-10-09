'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { LinhasFantasma, SemNadaAinda } from '@/components/control/primitives';
import { useClientAssignments, useRemoveClientAssignment, useSetClientAssignment } from '@/hooks/use-client-assignments';
import { useCollaborators } from '@/hooks/use-collaborators';
import { CLIENT_RESPONSIBILITIES, type ClientResponsibility } from '@/lib/api/contracts';
import { toast } from '@/stores/toast-store';
import { ApiRequestError } from '@/lib/api/client';

const RESPONSIBILITY_LABEL: Record<ClientResponsibility, string> = {
  account: 'Atendimento',
  traffic: 'Tráfego',
  design: 'Design',
  copy: 'Copy',
  social: 'Social',
  video: 'Vídeo',
  manager: 'Gestão',
  sales: 'Comercial',
  other: 'Outro',
};

/**
 * QUEM RESPONDE POR ESTE CLIENTE — responsabilidade operacional (P0-C),
 * distinta de quem TEM ACESSO ao workspace (aba Acesso). A mesma pessoa pode
 * acumular responsabilidades (ex.: account E gestão); o mesmo cliente pode
 * ter mais de uma pessoa na mesma responsabilidade. Sem gente atribuída não é
 * um erro — é `[FALTA]`, o estado real de um cliente recém-criado.
 */
export function ClientTeamPanel({ clientId }: { clientId: string }) {
  const { data: assignments, isPending, isError } = useClientAssignments(clientId);
  const { data: collaboratorsData } = useCollaborators();
  const setAssignment = useSetClientAssignment(clientId);
  const removeAssignment = useRemoveClientAssignment(clientId);
  const [userId, setUserId] = useState('');
  const [responsibility, setResponsibility] = useState<ClientResponsibility>('account');

  if (isPending) return <LinhasFantasma linhas={4} />;

  if (isError) {
    return (
      <SemNadaAinda
        titulo="Não consegui ler a equipe deste cliente"
        explicacao="A consulta falhou. É a API, não a conta, se continuar, vale avisar quem cuida do sistema."
      />
    );
  }

  const collaborators = collaboratorsData?.collaborators ?? [];

  function adicionar() {
    if (!userId) return;
    setAssignment.mutate(
      { userId, responsibility },
      {
        onError: (error) => toast(error instanceof ApiRequestError ? error.message : 'Não foi possível atribuir.', 'error'),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru"
        >
          <option value="">Selecione uma pessoa</option>
          {collaborators.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={responsibility}
          onChange={(e) => setResponsibility(e.target.value as ClientResponsibility)}
          className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru"
        >
          {CLIENT_RESPONSIBILITIES.map((r) => (
            <option key={r} value={r}>
              {RESPONSIBILITY_LABEL[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!userId || setAssignment.isPending}
          onClick={adicionar}
          className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm font-semibold text-branco-cru disabled:opacity-50"
        >
          Atribuir
        </button>
      </div>

      {!assignments || assignments.length === 0 ? (
        <SemNadaAinda
          titulo="Ninguém atribuído a este cliente ainda"
          explicacao="Atribua quem responde pelo atendimento, tráfego, design ou qualquer outra frente, vira o responsável padrão de demandas novas deste cliente."
        />
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li
              key={`${a.user_id}:${a.responsibility}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-grafite-elevado bg-grafite px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-branco-cru">{a.user_name}</p>
                <p className="truncate text-xs text-nevoa">{a.user_email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-grafite-elevado px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  {RESPONSIBILITY_LABEL[a.responsibility as ClientResponsibility] ?? a.responsibility}
                </span>
                <button
                  type="button"
                  onClick={() => removeAssignment.mutate({ userId: a.user_id, responsibility: a.responsibility as ClientResponsibility })}
                  disabled={removeAssignment.isPending}
                  className="text-nevoa hover:text-erro disabled:opacity-50"
                  aria-label="Remover atribuição"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
