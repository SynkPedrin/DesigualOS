import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapCollaborator, type CollaboratorsResponseWire } from '@/lib/api/contracts';

/**
 * Diretório de colaboradores (GET /collaborators): usuários + roles enriquecidos
 * com o membro do ClickUp casado por e-mail e presença (last_seen_at - "online"
 * é computado no cliente, ver lib/presence.ts). Quando o ClickUp está fora ou
 * não configurado, o backend responde clickup: null em todos + clickup_synced:
 * false - a lista continua funcionando com dados locais.
 */
export function useCollaborators() {
  return useQuery({
    queryKey: ['collaborators'],
    queryFn: async () => {
      const wire = await apiFetch<CollaboratorsResponseWire>('/collaborators');
      return { collaborators: wire.collaborators.map(mapCollaborator), clickupSynced: wire.clickup_synced };
    },
    staleTime: 60_000,
    // Presença envelhece rápido (janela de 3min): o poll de 1min mantém os dots
    // honestos sem depender de ação do usuário.
    refetchInterval: 60_000,
  });
}
