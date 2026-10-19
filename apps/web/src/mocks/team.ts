import type { CollaboratorClickUpWire, TeamMemberWire } from '@/lib/api/contracts';
import { dicebearAvatarUrl } from './avatar';

/**
 * Persona da demo (07/10/2026): Pedro Gabriel, dono/super da agência —
 * "user-admin-master" é só o id histórico do fixture (usado em dezenas de
 * outros registros); o papel real dele aqui é master (só ele cria acesso
 * novo e dá permissão de admin/colaborador).
 */
export const mockTeamMembers: TeamMemberWire[] = [
  { id: 'user-admin-master', name: 'Pedro Gabriel', email: 'pedro@desigual.com.br', avatar_url: dicebearAvatarUrl('Pedro Gabriel'), roles: ['master'] },
  { id: 'user-colaborador-1', name: 'Matheus Rial', email: 'matheus@desigual.com.br', avatar_url: dicebearAvatarUrl('Matheus Rial'), roles: ['colaborador'] },
  { id: 'user-colaborador-2', name: 'Tami Alves', email: 'tami@desigual.com.br', avatar_url: dicebearAvatarUrl('Tami Alves'), roles: ['colaborador'] },
  { id: 'user-colaborador-3', name: 'Julia Prado', email: 'julia@desigual.com.br', avatar_url: dicebearAvatarUrl('Julia Prado'), roles: ['colaborador'] },
];

// Membros do ClickUp casados por e-mail (nem todo colaborador tem conta lá),
// espelhando o join que GET /collaborators faz com users.clickup_email/email.
export const mockClickUpByUserId: Record<string, CollaboratorClickUpWire> = {
  'user-admin-master': { id: 88120001, username: 'Pedro Gabriel', email: 'pedro@desigual.com.br', profile_picture: null, initials: 'PG', color: '#e0245e' },
  'user-colaborador-1': { id: 88120002, username: 'Matheus Rial', email: 'matheus@desigual.com.br', profile_picture: null, initials: 'MR', color: '#7b68ee' },
};

// Presença (users.last_seen_at): um online agora, um visto há 2h, um nunca
// visto (null). "Online" é decidido no cliente (últimos 3 min).
export const mockLastSeenByUserId: Record<string, string | null> = {
  'user-admin-master': new Date().toISOString(),
  'user-colaborador-1': new Date(Date.now() - 60_000).toISOString(),
  'user-colaborador-2': new Date(Date.now() - 2 * 3_600_000).toISOString(),
  'user-colaborador-3': null,
};
