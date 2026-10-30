import { createLogger } from '@desigual-os/logging';
import { db, schema } from '@desigual-os/database';
import { DOMINIO_DE_PESSOA_DO_CLICKUP } from '@desigual-os/auth';
import { and, eq, like, sql } from 'drizzle-orm';
import { ClickUpHttpError, getTeamMembers, lerClickUpCru, type ClickUpMember } from '@desigual-os/tool-gateway';
import { abertaNoClickUpRecentemente, agendarSincroniaDeFundo, estaNaFilaDeFundo } from './sincronia-daily';

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
  /** Abertas aqui, mas fechadas ou apagadas no ClickUp. */
  fechadasLa: number;
  /** Amostra do que divergiu (para o log): `id campo`. */
  exemplos: string[];
  /** Divergiram igual depois de duas sincronias: não reenviadas (ver `marcar`). */
  persistentes: number;
  /** Já estavam na fila de fundo, esperando a vez. */
  aguardando: number;
  /** Listas arquivadas (ou apagadas) no ClickUp que foram arquivadas aqui. */
  listasArquivadas: number;
}

const insistencias = new Map<string, { motivo: string; vezes: number }>();

/** Todas as tarefas abertas do workspace, subtarefas incluídas (100 por página). `completa` = leu até a última página. */
async function tarefasAbertasDoClickUp(): Promise<{ tarefas: Cru[]; completa: boolean }> {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return { tarefas: [], completa: false };
  const tarefas: Cru[] = [];
  for (let pagina = 0; pagina < 60; pagina++) {
    const r = await lerClickUpCru<{ tasks?: Cru[]; last_page?: boolean }>({ apiKey, teamId }, `/team/${teamId}/task?include_closed=false&subtasks=true&page=${pagina}`);
    tarefas.push(...(r.tasks ?? []));
    if (r.last_page || (r.tasks ?? []).length < 100) return { tarefas, completa: true };
  }
  return { tarefas, completa: false };
}

/** A lista no ClickUp: `null` = não existe mais (404). */
async function lerListaDoClickUp(listaExterna: string): Promise<Cru | null> {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return undefined as unknown as Cru;
  try {
    return await lerClickUpCru<Cru>({ apiKey, teamId }, `/list/${listaExterna}`);
  } catch (e) {
    if (e instanceof ClickUpHttpError && e.status === 404) return null;
    throw e;
  }
}

const diaEmSP = (ms: number | null) => (ms === null ? null : new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10));
const msDe = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v) || null);

/**
 * O Daily confere, tarefa a tarefa, se está igual ao ClickUp — título, status, prazo, prioridade e responsáveis — e
 * manda para a fila da sincronia de sempre (que lê o ClickUp e aplica, como faria com um webhook) tudo o que diverge.
 *
 * Medido em produção em 29/10/2026: de 591 tarefas, 151 diferentes. Não era a sincronia ao vivo (118 webhooks em 3 h,
 * nenhuma falha): eram alterações de 26 e 27/10, antes de ela existir, que nunca foram relidas, e atribuições a quem
 * ainda não existia no OS. Esta conferência cura o atraso na primeira passada e impede que ele se acumule de novo
 * (webhook perdido, ClickUp fora do ar). Quem aparece como responsável e não existe aqui (convidado do ClickUp, que
 * não vem em /team) é cadastrado como as outras pessoas só do ClickUp. O inverso também: aberta aqui e fechada ou
 * apagada lá volta para a sincronia — só quando a leitura do ClickUp veio inteira, para não fechar nada por engano.
 */
export async function conferirComOClickUp(organizationId: string, opcoes: { tarefas?: Cru[]; completa?: boolean; agendar?: (taskId: string, motivo: string) => void; lerLista?: (listaExterna: string) => Promise<Cru | null> } = {}): Promise<ResultadoDaConferencia> {
  const r: ResultadoDaConferencia = { organizationId, lidas: 0, pessoasNovas: 0, agendadas: 0, faltavam: 0, divergiam: 0, fechadasLa: 0, exemplos: [], persistentes: 0, aguardando: 0, listasArquivadas: 0 };
  const agendar = opcoes.agendar ?? ((id: string, motivo: string) => agendarSincroniaDeFundo(id, motivo === 'fechada-no-clickup' ? 'fechada' : 'geral'));
  const esperando = opcoes.agendar ? () => false : estaNaFilaDeFundo;
  const marcar = (id: string, motivo: string) => {
    // A mesma divergência depois de duas sincronias não é atraso, é algo que a sincronia não sabe aplicar (ex.: status
    // que não existe no espaço daqui). Para de reenviar — senão viraria um laço a cada 15 min — e avisa uma vez.
    const chave = `${organizationId}:${id}`;
    if (esperando(id)) { r.aguardando++; return; } // ainda na fila de fundo: não é "a sincronia não resolveu"
    const antes = insistencias.get(chave);
    const vezes = antes && antes.motivo === motivo ? antes.vezes + 1 : 1;
    insistencias.set(chave, { motivo, vezes });
    if (vezes > 2) {
      if (vezes === 3) logger.warn({ organizationId, taskId: id, motivo }, 'Daily × ClickUp: divergência persiste depois de duas sincronias; parei de reenviar');
      r.persistentes++;
      return;
    }
    agendar(id, motivo); r.agendadas++; if (r.exemplos.length < 15) r.exemplos.push(`${id} ${motivo}`);
  };
  const vistasAgora = new Set<string>();
  const listasDaEmpresa = new Set((await db.select({ id: schema.workExternalMappings.externalId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')))).map((l) => l.id));
  let lidas = opcoes.tarefas;
  let completa = opcoes.completa ?? Boolean(opcoes.tarefas);
  if (!lidas) ({ tarefas: lidas, completa } = await tarefasAbertasDoClickUp());
  const tarefas = lidas.filter((t) => listasDaEmpresa.has(String(t.list?.id ?? '')));
  r.lidas = tarefas.length;

  // Responsáveis que ainda não existem aqui (inclui convidado).
  const vistos = new Map<string, ClickUpMember>();
  for (const t of tarefas) for (const a of (t.assignees ?? []) as Cru[]) {
    if (a?.email && !vistos.has(String(a.id))) vistos.set(String(a.id), { id: Number(a.id), email: String(a.email), username: String(a.username ?? a.email), profilePicture: a.profilePicture ?? null, initials: a.initials ?? null, color: a.color ?? null });
  }
  r.pessoasNovas = (await garantirPessoasDoClickUp(organizationId, [...vistos.values()])).criadas;

  // O que o Daily tem hoje.
  const vinculos = await db.select({ externo: schema.workExternalMappings.externalId, tarefa: schema.workExternalMappings.entityId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'task')));
  const tarefaDoExterno = new Map(vinculos.map((v) => [v.externo, v.tarefa]));
  const estado = new Map((await db.select({
    id: schema.workTasks.id, lista: schema.workTasks.listId, titulo: schema.workTasks.title, prioridade: schema.workTasks.priority, prazo: schema.workTasks.dueAt,
    concluida: schema.workTasks.completedAt, arquivada: schema.workTasks.archivedAt, status: schema.workTaskStatuses.name,
  }).from(schema.workTasks).innerJoin(schema.workTaskStatuses, eq(schema.workTaskStatuses.id, schema.workTasks.statusId))
    .where(eq(schema.workTasks.organizationId, organizationId))).map((e) => [e.id, e]));
  const atuais = await db.select({ tarefa: schema.workTaskAssignees.taskId, email: schema.users.email, clickupEmail: schema.users.clickupEmail })
    .from(schema.workTaskAssignees).innerJoin(schema.users, eq(schema.users.id, schema.workTaskAssignees.userId))
    .where(eq(schema.workTaskAssignees.organizationId, organizationId));
  const emailsDaTarefa = new Map<string, Set<string>>();
  const quantosNaTarefa = new Map<string, number>();
  for (const a of atuais) {
    quantosNaTarefa.set(a.tarefa, (quantosNaTarefa.get(a.tarefa) ?? 0) + 1);
    const conjunto = emailsDaTarefa.get(a.tarefa) ?? new Set<string>();
    conjunto.add(a.email.trim().toLowerCase());
    if (a.clickupEmail) conjunto.add(a.clickupEmail.trim().toLowerCase());
    emailsDaTarefa.set(a.tarefa, conjunto);
  }

  const abertasLa = new Set<string>();
  for (const t of tarefas) {
    const id = String(t.id);
    abertasLa.add(id);
    const daqui = tarefaDoExterno.get(id);
    const e = daqui ? estado.get(daqui) : undefined;
    if (!daqui || !e) { r.faltavam++; vistasAgora.add(`${organizationId}:${id}`); marcar(id, 'falta'); continue; }
    const diferencas: string[] = [];
    if (e.arquivada) diferencas.push('arquivada');
    if (String(t.name ?? '(sem título)').slice(0, 500).trim() !== e.titulo.trim()) diferencas.push('título');
    if (String(t.status?.status ?? '').trim().toLowerCase() !== e.status.trim().toLowerCase()) diferencas.push('status');
    if (diaEmSP(msDe(t.due_date)) !== diaEmSP(e.prazo ? e.prazo.getTime() : null)) diferencas.push('prazo');
    if ((Number(t.priority?.id ?? 0) || 0) !== e.prioridade) diferencas.push('prioridade');
    const esperados = ((t.assignees ?? []) as Cru[]).map((a) => String(a.email ?? '').trim().toLowerCase()).filter(Boolean);
    const temAqui = emailsDaTarefa.get(daqui) ?? new Set<string>();
    if (esperados.some((x) => !temAqui.has(x)) || (quantosNaTarefa.get(daqui) ?? 0) !== esperados.length) diferencas.push('responsáveis');
    if (diferencas.length) { r.divergiam++; vistasAgora.add(`${organizationId}:${id}`); marcar(id, diferencas.join('+')); }
  }

  // Aberta aqui, mas não está entre as abertas do ClickUp: fechada ou apagada lá — ou a LISTA dela foi arquivada lá
  // (o ClickUp esconde as tarefas de lista arquivada, mesmo abertas). Pergunta pela lista UMA vez antes de mandar as
  // tarefas para a fila: 727 de uma lista arquivada iam para a sincronia completa, ~25 s cada, à toa (30/10/2026).
  if (completa) {
    const listasArquivadasAqui = new Set((await db.select({ id: schema.workLists.id }).from(schema.workLists)
      .where(and(eq(schema.workLists.organizationId, organizationId), sql`${schema.workLists.archivedAt} is not null`))).map((l) => l.id));
    const suspeitasPorLista = new Map<string, string[]>();
    for (const [externo, daqui] of tarefaDoExterno) {
      const e = estado.get(daqui);
      if (!e || e.concluida || e.arquivada || abertasLa.has(externo) || listasArquivadasAqui.has(e.lista)) continue;
      if (!opcoes.agendar && abertaNoClickUpRecentemente(externo)) continue; // já lida aberta lá: o Daily está certo
      suspeitasPorLista.set(e.lista, [...(suspeitasPorLista.get(e.lista) ?? []), externo]);
    }
    const listaExterna = new Map((await db.select({ externo: schema.workExternalMappings.externalId, daqui: schema.workExternalMappings.entityId }).from(schema.workExternalMappings)
      .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')))).map((l) => [l.daqui, l.externo]));
    const lerLista = opcoes.lerLista ?? lerListaDoClickUp;
    for (const [lista, externos] of suspeitasPorLista) {
      const ext = listaExterna.get(lista);
      const noClickUp = ext ? await lerLista(ext).catch(() => undefined) : undefined;
      if (noClickUp === null || noClickUp?.archived) {
        await db.update(schema.workLists).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.workLists.id, lista), sql`${schema.workLists.archivedAt} is null`));
        r.listasArquivadas++;
        logger.info({ organizationId, lista, listaNoClickUp: ext, tarefas: externos.length, motivo: noClickUp === null ? 'apagada' : 'arquivada' }, 'Daily × ClickUp: lista arquivada no ClickUp, arquivada aqui');
        continue;
      }
      for (const externo of externos) { r.fechadasLa++; vistasAgora.add(`${organizationId}:${externo}`); marcar(externo, 'fechada-no-clickup'); }
    }
  }
  // Ficou igual: esquece a insistência (se divergir de novo um dia, volta a tentar).
  for (const chave of [...insistencias.keys()]) if (chave.startsWith(`${organizationId}:`) && !vistasAgora.has(chave)) insistencias.delete(chave);
  return r;
}

/** Nome antigo, mantido para quem já chamava. */
export const conferirResponsaveis = conferirComOClickUp;

export async function conferirResponsaveisNasEmpresas(): Promise<ResultadoDaConferencia[]> {
  if (!process.env.CLICKUP_API_KEY || !process.env.CLICKUP_TEAM_ID) return [];
  const { tarefas, completa } = await tarefasAbertasDoClickUp();
  const donas = await db.selectDistinct({ id: schema.workExternalMappings.organizationId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'list')));
  const resultados: ResultadoDaConferencia[] = [];
  for (const { id } of donas) {
    const res = await conferirComOClickUp(id, { tarefas, completa });
    if (res.agendadas || res.pessoasNovas) logger.info(res, 'Daily × ClickUp: conferência mandou divergências para a sincronia');
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
