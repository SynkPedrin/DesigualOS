import type { TeamMemberWire } from '@/lib/api/contracts';

export const mockTeamMembers: TeamMemberWire[] = [
  { id: 'user-admin-master', name: 'Instituto Almada', email: 'admin@institutoalmada.com.br', avatar_url: null, roles: ['master'] },
  { id: 'user-colaborador-1', name: 'Beatriz Souza', email: 'beatriz@institutoalmada.org', avatar_url: null, roles: ['colaborador'] },
  { id: 'user-colaborador-2', name: 'Rafael Lima', email: 'rafael@institutoalmada.org', avatar_url: null, roles: ['colaborador'] },
  { id: 'user-colaborador-3', name: 'Carla Nogueira', email: 'carla@institutoalmada.org', avatar_url: null, roles: ['colaborador'] },
];
