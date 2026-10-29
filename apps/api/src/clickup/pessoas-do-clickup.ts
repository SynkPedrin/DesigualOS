import { createLogger } from '@desigual-os/logging';
import { db, schema } from '@desigual-os/database';
import { DOMINIO_DE_PESSOA_DO_CLICKUP } from '@desigual-os/auth';
import { and, eq, like, sql } from 'drizzle-orm';
import { getTeamMembers, type ClickUpMember } from '@desigual-os/tool-gateway';

const logger = createLogger({ service: 'pessoas-clickup' });

/**
 * PESSOAS QUE SÓ EXISTEM NO CLICKUP.
 *
 * Quem não tinha conta aqui era descartado em todo lugar: a tarefa entrava sem responsável, a Jamile não conseguia
 * atribuir ao Gui pelo Daily e a conversa com ele virava "alguém de fora". Pedido do Pedro (29/10/2026): "mesmo que
 * muitos usuários ainda não estejam dentro do OS, as tasks continuam tendo que aparecer".
 *
 * Cada membro do workspace sem conta vira uma pessoa INATIVA da empresa: e-mail técnico `<id do ClickUp>@` +
 * {@link DOMINIO_DE_PESSOA_DO_CLICKUP} (nunca o real, que fica livre para o convite), o real em `clickup_email` (é
 * por ele que o importador e a escrita no ClickUp casam a pessoa). Inativa e sem `auth_user_id`: não entra no
 * sistema, não recebe digest nem varredura (os dois filtram `active`). Quando ela for convidada, o cadastro é
 * ADOTADO com tudo o que já tem (`adotarPessoaDoClickUp`, em @desigual-os/auth).
 *
 * Só cria pessoa nova e vínculo com a empresa; quem já tem conta não é tocado — nem posto numa empresa em que não
 * está, que seria dar acesso a alguém.
 */

export const ehEmailDePessoaDoClickUp = (email: string): boolean => email.toLowerCase().endsWith(`@${DOMINIO_DE_PESSOA_DO_CLICKUP}`);

export interface ResultadoDasPessoas {
  organizationId: string;
  criadas: number;
  naEmpresa: number;
  responsaveis: number;
}

export async function garantirPessoasDoClickUp(organizationId: string, membros: ClickUpMember[]): Promise<ResultadoDasPessoas> {
  const r: ResultadoDasPessoas = { organizationId, criadas: 0, naEmpresa: 0, responsaveis: 0 };
  const comEmail = membros.filter((m) => m.email && m.email.includes('@'));
  if (!comEmail.length) return r;
  const emails = [...new Set(comEmail.map((m) => m.email.trim().toLowerCase()))];

  const conhecidos = await db.select({ email: schema.users.email, clickupEmail: schema.users.clickupEmail }).from(schema.users)
    .where(sql`lower(${schema.users.email}) in ${emails} or lower(${schema.users.clickupEmail}) in ${emails}`);
  const jaTem = new Set<string>();
  for (const u of conhecidos) for (const e of [u.email, u.clickupEmail]) if (e) jaTem.add(e.trim().toLowerCase());

  const novas = comEmail.filter((m) => !jaTem.has(m.email.trim().toLowerCase()));
  const criadas = novas.length
    ? await db.insert(schema.users).values(novas.map((m) => ({
        email: `${m.id}@${DOMINIO_DE_PESSOA_DO_CLICKUP}`,
        name: (m.username?.trim() || m.email.split('@')[0] || m.email).slice(0, 120),
        clickupEmail: m.email.trim().toLowerCase(),
        avatarUrl: m.profilePicture && /^https:\/\//.test(m.profilePicture) ? m.profilePicture : null,
        active: false,
      }))).onConflictDoNothing().returning({ id: schema.users.id })
    : [];
  r.criadas = criadas.length;

  const daEmpresa = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(like(schema.users.email, `%@${DOMINIO_DE_PESSOA_DO_CLICKUP}`), sql`lower(${schema.users.clickupEmail}) in ${emails}`));
  if (daEmpresa.length) {
    const vinculadas = await db.insert(schema.organizationMembers)
      .values(daEmpresa.map((u) => ({ organizationId, userId: u.id, role: 'collaborator' })))
      .onConflictDoNothing().returning({ id: schema.organizationMembers.id });
    r.naEmpresa = vinculadas.length;
  }

  // Tarefas que já estavam aqui: os responsáveis que o ClickUp tinha na importação e que ficaram de fora por falta de
  // conta. Só para as pessoas criadas AGORA — depois disso quem manda é a sincronia ao vivo (se o ClickUp tirou
  // alguém, o registro da importação, que é antigo, não pode recolocar).
  if (criadas.length) {
    const ids = criadas.map((c) => c.id);
    const inseridos = await db.execute<{ task_id: string }>(sql`
      insert into work_task_assignees (task_id, user_id, organization_id)
      select distinct m.entity_id, u.id, m.organization_id
        from work_external_mappings m
        cross join lateral jsonb_array_elements(case when jsonb_typeof(m.meta->'assignees') = 'array' then m.meta->'assignees' else '[]'::jsonb end) a
        join users u on lower(u.clickup_email) = lower(a->>'email') and u.id in ${ids}
        join work_tasks t on t.id = m.entity_id and t.organization_id = m.organization_id
       where m.organization_id = ${organizationId} and m.provider = 'clickup' and m.external_type = 'task'
      on conflict do nothing
      returning task_id`);
    r.responsaveis = [...inseridos].length;
  }
  return r;
}

// ── passadas automáticas ──────────────────────────────────────────────────────────────────────────────────────────

let membrosEmCache: { em: number; membros: ClickUpMember[] } | null = null;

/** Para todas as empresas donas do workspace (as que têm listas do ClickUp no Daily). */
export async function garantirPessoasDoClickUpNasEmpresas(opcoes: { membros?: ClickUpMember[] } = {}): Promise<ResultadoDasPessoas[]> {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  let membros = opcoes.membros;
  if (!membros) {
    if (!apiKey || !teamId) return [];
    if (!membrosEmCache || Date.now() - membrosEmCache.em > 10 * 60_000) membrosEmCache = { em: Date.now(), membros: await getTeamMembers({ apiKey, teamId }) };
    membros = membrosEmCache.membros;
  }
  const donas = await db.selectDistinct({ id: schema.workExternalMappings.organizationId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')));
  const resultados: ResultadoDasPessoas[] = [];
  for (const { id } of donas) {
    const res = await garantirPessoasDoClickUp(id, membros);
    if (res.criadas || res.naEmpresa || res.responsaveis) logger.info(res, 'Pessoas do ClickUp: cadastradas na empresa');
    resultados.push(res);
  }
  return resultados;
}

let ligado = false;
/** 20 s depois de subir e a cada 15 min (gente nova no ClickUp entra sozinha). Não roda em teste. */
export function iniciarPessoasDoClickUp(): void {
  if (ligado || process.env.VITEST || process.env.PESSOAS_CLICKUP_SYNC === 'off') return;
  ligado = true;
  const rodar = () => { garantirPessoasDoClickUpNasEmpresas().catch((error: unknown) => logger.warn({ error }, 'Pessoas do ClickUp: passada falhou')); };
  setTimeout(rodar, 20_000).unref();
  setInterval(rodar, 15 * 60_000).unref();
}
