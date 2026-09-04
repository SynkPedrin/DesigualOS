import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapProject,
  type CreateProjectRequestWire,
  type ProjectWire,
  type UpdateProjectRequestWire,
} from '@/lib/api/contracts';

/** Projetos do chat (seção "Projetos" da sidebar). Compartilhados pela equipe. */
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => mapProjectList(await apiFetch<{ projects: ProjectWire[] }>('/projects')),
  });
}

function mapProjectList(wire: { projects: ProjectWire[] }) {
  return wire.projects.map(mapProject);
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProjectRequestWire) =>
      mapProject(
        (
          await apiFetch<{ project: ProjectWire }>('/projects', {
            method: 'POST',
            body: JSON.stringify(body),
          })
        ).project,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateProjectRequestWire & { id: string }) =>
      mapProject(
        (
          await apiFetch<{ project: ProjectWire }>(`/projects/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        ).project,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/** DELETE desvincula as conversas (elas voltam pra seção "Conversas"), não apaga nada além do projeto. */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
