import type { AdminUserWire, RoleName } from '@/lib/api/contracts';
import { mockTeamMembers } from './team';

/** Mirrors the real backend's rule (2026-09-02): a user with real activity can't be
 * hard-deleted (would break the audit trail / FK-restrict on executions), only deactivated.
 * `user-admin-master` stands in for "has history" here since it's the seeded account. */
export const USERS_WITH_HISTORY = new Set(['user-admin-master']);

export const mockAdminUsers: AdminUserWire[] = mockTeamMembers.map((member) => ({
  id: member.id,
  email: member.email,
  name: member.name,
  active: true,
  roles: member.roles as RoleName[],
  avatar_url: member.avatar_url,
  client_access:
    member.id === 'user-colaborador-1'
      ? [{ client_id: 'client-clinica-x', client_name: 'Clínica X', role: 'viewer' }]
      : [],
  created_at: new Date(Date.now() - 20 * 24 * 60 * 60_000).toISOString(),
}));

let inviteSeq = 0;

export function inviteMockUser(email: string, name: string | undefined, role: RoleName): AdminUserWire {
  inviteSeq += 1;
  const user: AdminUserWire = {
    id: `user-invited-${inviteSeq}`,
    email,
    name: name ?? email.split('@')[0] ?? email,
    active: true,
    roles: [role],
    avatar_url: null,
    client_access: [],
    integrations: [],
    created_at: new Date().toISOString(),
  };
  mockAdminUsers.push(user);
  return user;
}
