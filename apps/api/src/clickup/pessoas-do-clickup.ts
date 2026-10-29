import { createLogger } from '@desigual-os/logging';
import { db, schema } from '@desigual-os/database';
import { DOMINIO_DE_PESSOA_DO_CLICKUP } from '@desigual-os/auth';
import { and, eq, like, sql } from 'drizzle-orm';
import { getTeamMembers, lerClickUpCru, type ClickUpMember } from '@desigual-os/tool-gateway';
import { agendarSincroniaDaTarefa } from './sincronia-daily';

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

// ── conferência dos responsáveis ─────────────────────────────────────────────────────────────────────────────────

type Cru = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ResultadoDaConferencia {
  organizationId: string;
  lidas: number;
  pessoasNovas: number;
  agendadas: number;
  faltavam: number;
  divergiam: number;
}

/** Todas as tarefas abertas do workspace, subtarefas incluídas (100 por página). */
async function tarefasAbertasDoClickUp(): Promise<Cru[]> {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return [];
  const todas: Cru[] = [];
  for (let pagina = 0; pagina < 60; pagina++) {
    const r = await lerClickUpCru<{ tasks?: Cru[]; last_page?: boolean }>({ apiKey, teamId }, `/team/${teamId}/task?include_closed=false&subtasks=true&page=${pagina}`);
    todas.push(...(r.tasks ?? []));
    if (r.last_page || (r.tasks ?? []).length < 100) break;
  }
  return todas;
}

/**
 * O Daily confere, tarefa a tarefa, se tem as mesmas pessoas que o ClickUp (29/10/2026: o Gui tinha 49 tarefas abertas
 * no ClickUp e 38 aqui — atribuídas quando ele ainda não existia no OS e nunca mais mexidas, então nenhuma sincronia
 * as trouxe de volta). Quem aparece como responsável e não existe aqui (convidado do ClickUp, que não vem em
 * /team) é cadastrado como as outras pessoas só do ClickUp. Tarefa que falta, ou com responsáveis diferentes, vai para
 * a fila da sincronia de sempre — que lê o ClickUp e aplica, como faria com um webhook.
 */
export async function conferirResponsaveis(organizationId: string, opcoes: { tarefas?: Cru[]; agendar?: (taskId: string) => void } = {}): Promise<ResultadoDaConferencia> {
  const r: ResultadoDaConferencia = { organizationId, lidas: 0, pessoasNovas: 0, agendadas: 0, faltavam: 0, divergiam: 0 };
  const agendar = opcoes.agendar ?? ((id: string) => agendarSincroniaDaTarefa(id, 'conferencia'));
  const listasDaEmpresa = new Set((await db.select({ id: schema.workExternalMappings.externalId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')))).map((l) => l.id));
  const tarefas = (opcoes.tarefas ?? await tarefasAbertasDoClickUp()).filter((t) => listasDaEmpresa.has(String(t.list?.id ?? '')));
  r.lidas = tarefas.length;

  // Responsáveis que ainda não existem aqui (inclui convidado).
  const vistos = new Map<string, ClickUpMember>();
  for (const t of tarefas) for (const a of (t.assignees ?? []) as Cru[]) {
    if (a?.email && !vistos.has(String(a.id))) vistos.set(String(a.id), { id: Number(a.id), email: String(a.email), username: String(a.username ?? a.email), profilePicture: a.profilePicture ?? null, initials: a.initials ?? null, color: a.color ?? null });
  }
  r.pessoasNovas = (await garantirPessoasDoClickUp(organizationId, [...vistos.values()])).criadas;

  // O que o Daily tem hoje: tarefa do ClickUp → e-mails (do ClickUp) dos responsáveis.
  const vinculos = await db.select({ externo: schema.workExternalMappings.externalId, tarefa: schema.workExternalMappings.entityId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'task')));
  const tarefaDoExterno = new Map(vinculos.map((v) => [v.externo, v.tarefa]));
  const atuais = await db.select({ tarefa: schema.workTaskAssignees.taskId, email: schema.users.email, clickupEmail: schema.users.clickupEmail })
    .from(schema.workTaskAssignees).innerJoin(schema.users, eq(schema.users.id, schema.workTaskAssignees.userId))
    .where(eq(schema.workTaskAssignees.organizationId, organizationId));
  const emailsDaTarefa = new Map<string, Set<string>>();
  const quantosNaTarefa = new Map<string, number>();
  for (const a of atuais) {
    quantosNaTarefa.set(a.tarefa, (quantosNaTarefa.get(a.tarefa) ?? 0) + 1);
    const e = (a.clickupEmail ?? a.email).trim().toLowerCase();
    emailsDaTarefa.set(a.tarefa, (emailsDaTarefa.get(a.tarefa) ?? new Set()).add(e));
    if (a.clickupEmail) emailsDaTarefa.get(a.tarefa)!.add(a.email.trim().toLowerCase());
  }

  for (const t of tarefas) {
    const id = String(t.id);
    const daqui = tarefaDoExterno.get(id);
    if (!daqui) { r.faltavam++; agendar(id); r.agendadas++; continue; }
    const esperados = ((t.assignees ?? []) as Cru[]).map((a) => String(a.email ?? '').trim().toLowerCase()).filter(Boolean);
    const temAqui = emailsDaTarefa.get(daqui) ?? new Set<string>();
    if (esperados.some((e) => !temAqui.has(e)) || (quantosNaTarefa.get(daqui) ?? 0) !== esperados.length) { r.divergiam++; agendar(id); r.agendadas++; }
  }
  return r;
}

export async function conferirResponsaveisNasEmpresas(): Promise<ResultadoDaConferencia[]> {
  if (!process.env.CLICKUP_API_KEY || !process.env.CLICKUP_TEAM_ID) return [];
  const tarefas = await tarefasAbertasDoClickUp();
  const donas = await db.selectDistinct({ id: schema.workExternalMappings.organizationId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')));
  const resultados: ResultadoDaConferencia[] = [];
  for (const { id } of donas) {
    const res = await conferirResponsaveis(id, { tarefas });
    if (res.agendadas || res.pessoasNovas) logger.info(res, 'Pessoas do ClickUp: conferência dos responsáveis');
    resultados.push(res);
  }
  return resultados;
}

let ligado = false;
/** 20 s depois de subir e a cada 15 min (gente nova no ClickUp entra sozinha). Não roda em teste. */
export function iniciarPessoasDoClickUp(): void {
  if (ligado || process.env.VITEST || process.env.PESSOAS_CLICKUP_SYNC === 'off') return;
  ligado = true;
  const rodar = () => {
    garantirPessoasDoClickUpNasEmpresas()
      .then(() => conferirResponsaveisNasEmpresas())
      .catch((error: unknown) => logger.warn({ error }, 'Pessoas do ClickUp: passada falhou'));
  };
  setTimeout(rodar, 20_000).unref();
  setInterval(rodar, 15 * 60_000).unref();
}
