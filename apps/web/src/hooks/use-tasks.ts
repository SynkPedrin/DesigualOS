import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import type { AgencyTasksResponseWire } from '@/lib/api/contracts';

/** Todas as tarefas de todos os clientes com lista vinculada no ClickUp
 * ("Central de Tasks", pedido do usuário em 10/09/2026). */
export function useAgencyTasks() {
  return useQuery({
    queryKey: ['clickup', 'tasks', 'agency'],
    queryFn: () => apiFetch<AgencyTasksResponseWire>('/clickup/tasks/agency'),
    staleTime: 60_000,
  });
}

/** Só as tarefas atribuídas ao usuário logado (resolvido por
 * users.clickup_email). 409 = ainda não vinculou e-mail nenhum, ou o e-mail
 * vinculado não bate com nenhum membro do workspace - estado esperado, não
 * insiste em retry (mesmo padrão de useClientClickUpTasks).
 * `enabled` vem da tela: sem ele a query disparava até no escopo "agency",
 * gerando um 409 desnecessário a cada visita de quem não vinculou e-mail. */
export function useMyTasks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['clickup', 'tasks', 'me'],
    queryFn: () => apiFetch<AgencyTasksResponseWire>('/clickup/tasks/me'),
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status === 409) && failureCount < 1,
  });
}
