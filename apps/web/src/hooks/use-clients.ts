import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapClientSummary, type ClientSummaryWire } from '@/lib/api/contracts';

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const wire = await apiFetch<{ clients: ClientSummaryWire[] }>('/clients');
      return wire.clients.map(mapClientSummary);
    },
    staleTime: 5 * 60_000,
  });
}

/** Projeto criado à mão (sem lista do ClickUp vinculada) — pedido do usuário: qualquer
 * colaborador cria um projeto novo, e ele fica visível pra equipe toda (chat compartilhado). */
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      apiFetch<{ id: string; name: string; slug: string; status: string }>('/clients', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
