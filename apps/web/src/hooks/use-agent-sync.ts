import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { AgentSyncReportWire } from '@/lib/api/contracts';

/**
 * Botão "Sincronizar": faz o Orchestrator ir até cada agente, medir de
 * verdade, gravar e diagnosticar. Não é um refresh de tela - é uma sonda.
 */
export function useAgentSync() {
  const queryClient = useQueryClient();
  return useMutation({
    // Corpo '{}' explícito: o apiFetch sempre manda Content-Type
    // application/json, e o Fastify recusa POST com esse header e corpo
    // vazio ("Body cannot be empty when content-type is set to
    // 'application/json'") - erro real visto na tela.
    mutationFn: () => apiFetch<AgentSyncReportWire>('/health/sync', { method: 'POST', body: '{}' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health', 'infrastructure'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'events'] });
    },
  });
}
