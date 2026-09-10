import type { CollaboratorClickUpWire, TeamMemberWire } from '@/lib/api/contracts';

export const mockTeamMembers: TeamMemberWire[] = [
  { id: 'user-admin-master', name: 'Instituto Almada', email: 'admin@institutoalmada.com.br', avatar_url: null, roles: ['master'] },
  { id: 'user-colaborador-1', name: 'Beatriz Souza', email: 'beatriz@institutoalmada.org', avatar_url: null, roles: ['colaborador'] },
  { id: 'user-colaborador-2', name: 'Rafael Lima', email: 'rafael@institutoalmada.org', avatar_url: null, roles: ['colaborador'] },
  { id: 'user-colaborador-3', name: 'Carla Nogueira', email: 'carla@institutoalmada.org', avatar_url: null, roles: ['colaborador'] },
];

// Membros do ClickUp casados por e-mail (nem todo colaborador tem conta lá),
// espelhando o join que GET /collaborators faz com users.clickup_email/email.
export const mockClickUpByUserId: Record<string, CollaboratorClickUpWire> = {
  'user-admin-master': { id: 88120001, username: 'Instituto Almada', email: 'admin@institutoalmada.com.br', profile_picture: null, initials: 'IA', color: '#e0245e' },
  'user-colaborador-1': { id: 88120002, username: 'Beatriz Souza', email: 'beatriz@institutoalmada.org', profile_picture: null, initials: 'BS', color: '#7b68ee' },
};

// Presença (users.last_seen_at): um online agora, um visto há 2h, um nunca
// visto (null). "Online" é decidido no cliente (últimos 3 min).
export const mockLastSeenByUserId: Record<string, string | null> = {
  'user-admin-master': new Date().toISOString(),
  'user-colaborador-1': new Date(Date.now() - 60_000).toISOString(),
  'user-colaborador-2': new Date(Date.now() - 2 * 3_600_000).toISOString(),
  'user-colaborador-3': null,
};
