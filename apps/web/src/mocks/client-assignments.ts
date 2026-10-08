import type { ClientAssignmentWire } from '@/lib/api/contracts';
import { mockTeamMembers } from './team';

interface ClientAssignmentRow extends ClientAssignmentWire {
  client_id: string;
}

/** Fixture DEV/QA de responsabilidade operacional por cliente (P0-C/P1-K) +
 *  demo "dia real de operação" (07/10/2026) — distinta de acesso ao
 *  workspace. Mesmos nomes de `mocks/team.ts`. */
export const mockClientAssignments: ClientAssignmentRow[] = [
  { client_id: 'client-cosentino', user_id: 'user-admin-master', user_name: 'Pedro Gabriel', user_email: 'pedro@desigual.com.br', responsibility: 'account' },
  { client_id: 'client-cosentino', user_id: 'user-colaborador-1', user_name: 'Matheus Rial', user_email: 'matheus@desigual.com.br', responsibility: 'account' },
  { client_id: 'client-cosentino', user_id: 'user-colaborador-2', user_name: 'Tami Alves', user_email: 'tami@desigual.com.br', responsibility: 'design' },
  { client_id: 'client-g4-educacao', user_id: 'user-admin-master', user_name: 'Pedro Gabriel', user_email: 'pedro@desigual.com.br', responsibility: 'account' },
  { client_id: 'client-g4-educacao', user_id: 'user-colaborador-3', user_name: 'Julia Prado', user_email: 'julia@desigual.com.br', responsibility: 'copy' },
];

export function findTeamMember(userId: string) {
  return mockTeamMembers.find((m) => m.id === userId) ?? null;
}
