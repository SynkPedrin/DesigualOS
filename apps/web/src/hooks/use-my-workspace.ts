import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

export interface MyWorkspaceWire {
  template_id: string | null;
  modules: string[];
  configured: boolean;
}

/**
 * GET /me/workspace — alimenta a sidebar e o ⌘K (Workspace Builder, §5-13).
 * `staleTime` alto: o workspace de alguém muda quando a gestão mexe nele, não
 * a cada navegação — não faz sentido reconsultar com a mesma agressividade
 * de um painel com número que muda sozinho.
 */
export function useMyWorkspace() {
  return useQuery({
    queryKey: ['me', 'workspace'],
    queryFn: () => apiFetch<MyWorkspaceWire>('/me/workspace'),
    staleTime: 5 * 60_000,
  });
}
