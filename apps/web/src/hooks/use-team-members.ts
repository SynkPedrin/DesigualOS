import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapTeamMember, type TeamMemberWire } from '@/lib/api/contracts';

export function useTeamMembers() {
  return useQuery({
    queryKey: ['team', 'members'],
    queryFn: async () => {
      const wire = await apiFetch<{ members: TeamMemberWire[] }>('/team/members');
      return wire.members.map(mapTeamMember);
    },
    staleTime: 60_000,
  });
}
