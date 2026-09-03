import { useMe } from './use-me';

/**
 * `costs:read` is master-only on the backend (confirmed 2026-09-01): colaborador gets a 403.
 * Gate cost-related nav and widgets on this instead of surfacing that error to the user.
 */
export function useIsMaster() {
  const { data: me, isPending } = useMe();
  return { isMaster: me?.roles.includes('master') ?? false, isPending };
}
