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
    /**
     * NÃO INSISTE EM 4xx (09/10/2026). Esta rota responde 400 quando a
     * organização não tem conector de ClickUp utilizável, e 400 não vira 200
     * por insistência: as três tentativas padrão do React Query só adiavam a
     * mesma resposta, com recuo exponencial no meio.
     *
     * O custo não era teórico. Enquanto as tentativas corriam, `isPending`
     * seguia verdadeiro e TODO painel desta página que depende desta consulta
     * ficava em esqueleto. A tela do Hoje levava mais de 20 segundos pra
     * assentar, e o portão de captura da desigualos-f9 recusou as três
     * resoluções por isso. Falhando na primeira resposta, o painel mostra em
     * seguida o que é verdade aqui: não deu pra ler as tarefas da agência.
     */
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && failureCount < 1,
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
