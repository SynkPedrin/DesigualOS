import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { DOMINIO_DE_PESSOA_DO_CLICKUP } from '@desigual-os/auth';
import { createLogger } from '@desigual-os/logging';
import { casarMembroDoClickUp, decryptToken, getTeamMembers } from '@desigual-os/tool-gateway';
import { resolveSharedClickUpAccess } from '../integrations/access';

const logger = createLogger({ service: 'vinculo-clickup' });

/**
 * O e-mail do ClickUp da pessoa, vinculando sozinho no primeiro uso
 * (14/10/2026). Sem isto, todo colaborador novo via Tarefas em vermelho ("No
 * ClickUp email linked") e ficava fora dos avisos proativos e do "minhas
 * tarefas" do Bento — porque ninguém preenche esse campo à mão.
 *
 * Só grava quando o casamento é único (casarMembroDoClickUp). Sem casamento,
 * devolve null e a tela explica; nunca liga a pessoa errada.
 */
/**
 * E-mail já vinculado não muda sozinho: guardado por 10 min, `/me` (chamado em
 * toda navegação) e "minhas tarefas" deixam de ler `users` para isto. Quem
 * ainda não tem vínculo continua sendo conferido a cada chamada.
 */
const vinculadosEmCache = new Map<string, { email: string; em: number }>();

export async function garantirEmailDoClickUp(userId: string): Promise<string | null> {
  const guardado = vinculadosEmCache.get(userId);
  if (guardado && Date.now() - guardado.em < 10 * 60_000) return guardado.email;
  // Conectou o ClickUp dela? Quem é ela lá vem do próprio token — sem chute.
  const peloToken = await vincularPelaConexao(userId).catch(() => null);
  if (peloToken) return peloToken;
  const email = await resolverEmailDoClickUp(userId);
  if (email) vinculadosEmCache.set(userId, { email, em: Date.now() });
  return email;
}

async function resolverEmailDoClickUp(userId: string): Promise<string | null> {
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
  const email = achado.email.toLowerCase();
  // O palpite (parte antes do @, nome) nunca toma o e-mail do ClickUp de OUTRA conta: com duas contas no mesmo e-mail
  // a sincronia não sabe de quem é a tarefa e tira a responsável das duas — foi o que esvaziou o Daily da Ana
  // (12/11/2026). Quem tem direito de tomar é o token do ClickUp da própria pessoa (vincularIdentidadeDoClickUp).
  const [deOutro] = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(ne(schema.users.id, userId), sql`(lower(${schema.users.clickupEmail}) = ${email} or lower(${schema.users.email}) = ${email})`))
    .limit(1);
  if (deOutro) return null;
  await db.update(schema.users).set({ clickupEmail: email, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return email;
}

/**
 * QUEM A PESSOA É NO CLICKUP, PELO TOKEN DELA (12/11/2026).
 *
 * A Ana Luiza entrou com uma conta nova e conectou o ClickUp; a conta antiga (criada para ela antes) tinha o mesmo
 * e-mail do ClickUp. Com duas contas no mesmo e-mail a sincronia não atribuía a nenhuma, e o Daily dela mostrava a
 * agência inteira. O token OAuth é prova de identidade: GET /user diz de quem ele é. Com isso:
 *  - esta conta fica com o e-mail do ClickUp;
 *  - quem mais o tinha perde o vínculo, e as tarefas e acompanhamentos dela passam para esta conta;
 *  - cadastro técnico do "Pessoas do ClickUp" (nunca entrou no sistema) sai da equipe.
 * Conta real antiga continua existindo (pode ter histórico); só deixa de ser "ela no ClickUp".
 */
export async function vincularIdentidadeDoClickUp(userId: string, email: string): Promise<{ transferidas: number; desvinculadas: number }> {
  const alvo = email.trim().toLowerCase();
  const r = await db.transaction(async (tx) => {
    const outros = await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users)
      .where(and(ne(schema.users.id, userId), sql`lower(${schema.users.clickupEmail}) = ${alvo}`));
    let transferidas = 0;
    for (const o of outros) {
      const movidas = await tx.execute(sql`
        insert into work_task_assignees (task_id, user_id, organization_id, assigned_by, assigned_at)
        select task_id, ${userId}::uuid, organization_id, assigned_by, assigned_at from work_task_assignees where user_id = ${o.id}::uuid
        on conflict do nothing returning task_id`);
      transferidas += [...movidas].length;
      await tx.execute(sql`delete from work_task_assignees where user_id = ${o.id}::uuid`);
      await tx.execute(sql`
        insert into work_task_followers (organization_id, task_id, user_id, created_at)
        select organization_id, task_id, ${userId}::uuid, created_at from work_task_followers where user_id = ${o.id}::uuid
        on conflict do nothing`);
      await tx.execute(sql`delete from work_task_followers where user_id = ${o.id}::uuid`);
      const tecnico = o.email.toLowerCase().endsWith(`@${DOMINIO_DE_PESSOA_DO_CLICKUP}`);
      await tx.update(schema.users).set({ clickupEmail: null, ...(tecnico ? { active: false } : {}), updatedAt: new Date() }).where(eq(schema.users.id, o.id));
    }
    await tx.update(schema.users).set({ clickupEmail: alvo, updatedAt: new Date() }).where(eq(schema.users.id, userId));
    return { transferidas, desvinculadas: outros.length };
  });
  vinculadosEmCache.set(userId, { email: alvo, em: Date.now() });
  if (r.desvinculadas) logger.info({ userId, ...r }, 'ClickUp: vínculo pela conta conectada; tarefas passaram para ela');
  return r;
}

/** Dono do token: GET /user só identifica quem é, não lê o workspace. */
async function donoDoToken(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.clickup.com/api/v2/user', { headers: { Authorization: token }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const corpo = (await res.json()) as { user?: { email?: string | null } };
    const email = corpo.user?.email?.trim().toLowerCase();
    return email && email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

/** Liga a conta ao ClickUp pelo token recém-recebido no OAuth. */
export async function vincularPeloTokenDoClickUp(userId: string, token: string): Promise<string | null> {
  const email = await donoDoToken(token);
  if (!email) return null;
  await vincularIdentidadeDoClickUp(userId, email);
  return email;
}

// Uma conferência pelo token a cada 6 h por conta (o dono do token não muda; isto só pega quem conectou antes).
const conferidasPeloToken = new Map<string, number>();

async function vincularPelaConexao(userId: string): Promise<string | null> {
  const ultima = conferidasPeloToken.get(userId);
  if (ultima && Date.now() - ultima < 6 * 3_600_000) return null;
  conferidasPeloToken.set(userId, Date.now());
  const [c] = await db.select({ token: schema.integrationConnections.accessTokenEncrypted }).from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, 'clickup'), eq(schema.integrationConnections.status, 'connected')))
    .limit(1);
  if (!c) return null;
  let token: string;
  try { token = decryptToken(c.token); } catch { return null; }
  return vincularPeloTokenDoClickUp(userId, token);
}

/** Todas as contas com ClickUp conectado (passada periódica, antes da conferência dos responsáveis). */
export async function vincularContasConectadasAoClickUp(): Promise<number> {
  const contas = await db.select({ userId: schema.integrationConnections.userId }).from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.provider, 'clickup'), eq(schema.integrationConnections.status, 'connected')));
  let ligadas = 0;
  for (const { userId } of contas) if (await vincularPelaConexao(userId).catch(() => null)) ligadas += 1;
  return ligadas;
}
