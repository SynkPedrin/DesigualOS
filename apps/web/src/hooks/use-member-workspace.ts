import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { MyWorkspaceWire } from './use-my-workspace';

export interface WorkspaceTemplateWire {
  id: string;
  label: string;
  modules: string[];
}

/** A lista de templates e módulos disponíveis — alimenta o editor em /people. */
export function useWorkspaceTemplates() {
  return useQuery({
    queryKey: ['workspace', 'templates'],
    queryFn: () => apiFetch<{ modules: string[]; templates: WorkspaceTemplateWire[] }>('/workspace/templates'),
    staleTime: Infinity, // vocabulário fixo no código (packages/types), não muda em runtime.
  });
}

export function useMemberWorkspace(userId: string | null) {
  return useQuery({
    queryKey: ['team', 'members', userId, 'workspace'],
    queryFn: () => apiFetch<MyWorkspaceWire>(`/team/members/${userId}/workspace`),
    enabled: Boolean(userId),
  });
}

export function useSaveMemberWorkspace(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { template_id: string | null; modules: string[] }) =>
      apiFetch<MyWorkspaceWire>(`/team/members/${userId}/workspace`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', 'members', userId, 'workspace'] });
      // Se a pessoa configurada for quem está olhando (editar o próprio workspace
      // é raro, mas possível pra um master) a sidebar dela também precisa atualizar.
      queryClient.invalidateQueries({ queryKey: ['me', 'workspace'] });
    },
  });
}
