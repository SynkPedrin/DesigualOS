import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ClientReportWire } from '@/lib/api/contracts';

const EM_ANDAMENTO = new Set(['queued', 'processing']);

/** Lista dos relatórios já gerados (ou em geração) deste cliente, mais recentes primeiro. */
export function useClientReports(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'reports'],
    queryFn: async () => {
      const wire = await apiFetch<{ reports: ClientReportWire[] }>(`/clients/${clientId}/reports`);
      return wire.reports;
    },
    enabled: Boolean(clientId),
    // Faz polling sozinho enquanto algum relatório ainda está em fila/processando —
    // é a lista inteira que precisa atualizar (status muda, não só o item), não um
    // relatório isolado.
    refetchInterval: (query) => (query.state.data?.some((r) => EM_ANDAMENTO.has(r.status)) ? 3_000 : false),
  });
}

export function useCreateClientReport(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { channels: string[]; period_days: number }) =>
      apiFetch<ClientReportWire>(`/clients/${clientId}/reports`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'reports'] }),
  });
}
