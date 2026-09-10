import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapAdminUser,
  type AdminUserWire,
  type InviteUserRequestWire,
  type InviteUserResponseWire,
  type RoleName,
  type UpdateUserNameResponseWire,
} from '@/lib/api/contracts';

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const wire = await apiFetch<{ users: AdminUserWire[] }>('/admin/users');
      return wire.users.map(mapAdminUser);
    },
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { email: string; name?: string | undefined; role: RoleName }) => {
      const body: InviteUserRequestWire = { email: input.email, name: input.name, role: input.role };
      return apiFetch<InviteUserResponseWire>('/admin/invite', { method: 'POST', body: JSON.stringify(body) });
    },
    // On settled, not just success: the backend can create the user and provision them for
    // real, then still return an error status because the notification email itself failed to
    // send (e.g. Resend sandbox mode). Refreshing the list either way means the table reflects
    // what actually happened in the database, regardless of what the HTTP status implied.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: RoleName }) =>
      apiFetch(`/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useUpdateUserName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, name }: { userId: string; name: string }) =>
      apiFetch<UpdateUserNameResponseWire>(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) =>
      apiFetch(`/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

/** No confirmed contract for this yet (only invite/role/status exist for sure) - follows the
 * obvious REST convention. If the backend hasn't wired it up yet this surfaces a real error
 * instead of silently pretending to succeed. */
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => apiFetch(`/admin/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
