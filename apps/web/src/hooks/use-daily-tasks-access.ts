import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

export interface DailyTasksAccessWire {
  allowed: boolean;
  userId?: string;
  reason?: string;
}

/**
 * GET /work/access — a decisão do Daily Tasks vem SEMPRE do servidor (flag da
 * empresa + papel). A tela só reflete; esconder o menu não protege nada, o
 * backend recusa com 403 de qualquer forma. Erro conta como "não liberado".
 */
export function useDailyTasksAccess() {
  return useQuery({
    queryKey: ['work', 'access'],
    queryFn: () => apiFetch<DailyTasksAccessWire>('/work/access'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
