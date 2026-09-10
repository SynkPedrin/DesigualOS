import type { AuthenticatedUser } from '../auth/middleware';

/**
 * Projetos (clientes) são compartilhados por toda a equipe (pedido do
 * usuário, 2026-09-03, revertendo a decisão anterior "só master + convite
 * explícito via client_users"): qualquer autenticado com `clients:read` -
 * hoje master e colaborador, os únicos dois papéis - vê o workspace de
 * qualquer cliente. A rota já checou `clients:read` via requirePermission
 * antes de chamar esta função, então não há mais nada a decidir aqui.
 *
 * `client_users`/POST /clients/:id/access continuam existindo no schema e
 * na API (não removidos), só deixaram de ser um gate obrigatório - dá pra
 * reintroduzir escopo por pessoa no futuro sem migração nova.
 */
export async function hasClientAccess(_user: AuthenticatedUser, _clientId: string): Promise<boolean> {
  return true;
}
