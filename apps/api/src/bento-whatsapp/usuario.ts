import { eq } from 'drizzle-orm';
import { hasPermission, loadUserAccess } from '@desigual-os/auth';
import { db, schema } from '@desigual-os/database';
import type { AuthenticatedUser } from '../auth/middleware';

/**
 * O MESMO usuário que o `requireAuth` montaria, a partir do id do vínculo.
 *
 * Não há JWT no WhatsApp; a prova de identidade é o vínculo (código + confirmação
 * na sessão web). Daqui em diante, tudo é igual à web: mesma linha de `users`,
 * mesmos papéis e permissões de `loadUserAccess`, mesma recusa para conta
 * desativada, e a mesma permissão `chat:write` que o `POST /chat` exige.
 *
 * Não existe usuário de serviço nem credencial compartilhada: cada mensagem
 * vira o usuário que a mandou, com o acesso que ele tem — e só esse.
 */

export type UsuarioDoCanal =
  | { tipo: 'ok'; user: AuthenticatedUser }
  | { tipo: 'inativo' }
  | { tipo: 'sem_permissao' }
  | { tipo: 'inexistente' };

export async function carregarUsuarioDoCanal(userId: string): Promise<UsuarioDoCanal> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return { tipo: 'inexistente' };
  if (!user.active || user.deletedAt) return { tipo: 'inativo' };
  const access = await loadUserAccess(user.id);
  if (!hasPermission(access.permissions, 'chat', 'write')) return { tipo: 'sem_permissao' };
  return {
    tipo: 'ok',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      language: user.language,
      theme: user.theme,
      dashboardWidgets: user.dashboardWidgets,
      clickupEmail: user.clickupEmail,
      jobTitle: user.jobTitle,
      roles: access.roles,
      permissions: access.permissions,
    },
  };
}
