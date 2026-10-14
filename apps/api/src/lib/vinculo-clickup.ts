import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { casarMembroDoClickUp, getTeamMembers } from '@desigual-os/tool-gateway';
import { resolveSharedClickUpAccess } from '../integrations/access';

/**
 * O e-mail do ClickUp da pessoa, vinculando sozinho no primeiro uso
 * (14/10/2026). Sem isto, todo colaborador novo via Tarefas em vermelho ("No
 * ClickUp email linked") e ficava fora dos avisos proativos e do "minhas
 * tarefas" do Bento — porque ninguém preenche esse campo à mão.
 *
 * Só grava quando o casamento é único (casarMembroDoClickUp). Sem casamento,
 * devolve null e a tela explica; nunca liga a pessoa errada.
 */
export async function garantirEmailDoClickUp(userId: string): Promise<string | null> {
  const [u] = await db
    .select({ email: schema.users.email, nome: schema.users.name, clickupEmail: schema.users.clickupEmail })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!u) return null;
  if (u.clickupEmail) return u.clickupEmail;
  const acesso = resolveSharedClickUpAccess();
  if (!acesso) return null;
  const membros = await getTeamMembers({ apiKey: acesso.token, teamId: acesso.teamId }).catch(() => []);
  const achado = casarMembroDoClickUp({ email: u.email, nome: u.nome }, membros);
  if (!achado) return null;
  await db.update(schema.users).set({ clickupEmail: achado.email.toLowerCase(), updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return achado.email.toLowerCase();
}
