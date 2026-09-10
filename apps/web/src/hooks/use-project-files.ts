import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapProjectFile, type ProjectFileKind, type ProjectFileWire } from '@/lib/api/contracts';

/** Arquivos de referência do projeto (identidade visual, briefing, referências),
 * listados na tela de Projeto do chat. */
export function useProjectFiles(projectId: string | null) {
  return useQuery({
    queryKey: ['projects', projectId, 'files'],
    queryFn: async () => {
      const wire = await apiFetch<{ files: ProjectFileWire[] }>(`/projects/${projectId}/files`);
      return wire.files.map(mapProjectFile);
    },
    enabled: Boolean(projectId),
  });
}

/** Upload multipart: o campo de texto `kind` precisa vir ANTES do campo `file`
 * no FormData, senão o @fastify/multipart não o popula no backend. */
export function useUploadProjectFile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, file }: { kind: ProjectFileKind; file: File }) => {
      const formData = new FormData();
      formData.append('kind', kind);
      formData.append('file', file);
      return mapProjectFile(
        (
          await apiFetch<{ file: ProjectFileWire }>(`/projects/${projectId}/files`, {
            method: 'POST',
            body: formData,
          })
        ).file,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'files'] });
    },
  });
}

export function useDeleteProjectFile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => apiFetch<void>(`/projects/${projectId}/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'files'] });
    },
  });
}
