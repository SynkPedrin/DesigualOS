import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';

/**
 * Importação do ClickUp → Daily Tasks, a partir de um SNAPSHOT em disco (JSON). Dois motivos para
 * separar a leitura da escrita: (1) o ClickUp nunca é tocado por esta etapa — ela só lê arquivos; (2)
 * dá para ensaiar (`dryRun`) e repetir sem bater na API de novo.
 *
 * IDEMPOTENTE: cada entidade importada ganha uma linha em `work_external_mappings`. Reimportar
 * ATUALIZA a mesma entidade; nunca cria uma segunda. Usuário e cliente só são vinculados por
 * e-mail / nome normalizado IGUAL — nada de "parecido". O que não casa fica registrado no relatório.
 */

const PROVIDER = 'clickup';
/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

export interface ImportReport {
  dryRun: boolean;
  counts: Record<string, { novos: number; atualizados: number }>;
  usuariosNaoCasados: Array<{ clickupId: string; nome: string; email: string | null; tarefas: number }>;
  clientesCasados: Array<{ lista: string; cliente: string }>;
  listasSemCliente: string[];
  statusCriadosPorTarefa: string[];
  naoImportado: string[];
}

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ms = (v: unknown): Date | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? new Date(n) : null;
};
const categoriaDoStatus = (type: string | undefined): string => (type === 'open' ? 'todo' : type === 'done' || type === 'closed' ? 'done' : 'active');
const chunk = <T>(a: T[], n = 400): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

function ler(dir: string, nome: string): Raw {
  const p = join(dir, `${nome}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export async function importClickUp(ctx: WorkContext, opts: { snapshotDir: string; dryRun?: boolean }): Promise<ImportReport> {
  const dryRun = opts.dryRun ?? false;
  const team = ler(opts.snapshotDir, 'team');
  const spaces: Raw[] = ler(opts.snapshotDir, 'spaces') ?? [];
  const lists: Raw[] = ler(opts.snapshotDir, 'lists') ?? [];
  const tasks: Raw[] = ler(opts.snapshotDir, 'tasks') ?? [];
  const extras: Record<string, Raw> = ler(opts.snapshotDir, 'extras') ?? {};
  const timeEntries: Raw[] = (() => { const t = ler(opts.snapshotDir, 'time_entries'); return Array.isArray(t) ? t : []; })();
  if (!team) throw new Error('Snapshot sem team.json.');

  const org = ctx.organizationId;
  const report: ImportReport = { dryRun, counts: {}, usuariosNaoCasados: [], clientesCasados: [], listasSemCliente: [], statusCriadosPorTarefa: [], naoImportado: [] };
  const bump = (k: string, novo: boolean) => { (report.counts[k] ??= { novos: 0, atualizados: 0 })[novo ? 'novos' : 'atualizados']++; };

  // ── usuários por e-mail IGUAL
  // Casa por e-mail IGUAL no e-mail do sistema OU no `clickup_email` (o vínculo oficial da pessoa com o ClickUp).
  // E-mail que aponta para MAIS DE UMA conta é ambíguo: não vincula a nenhuma (melhor sem responsável que na pessoa errada).
  const dbUsers = await db.select({ id: schema.users.id, email: schema.users.email, clickupEmail: schema.users.clickupEmail }).from(schema.users);
  const candidatos = new Map<string, Set<string>>();
  for (const u of dbUsers) for (const e of [u.email, u.clickupEmail]) { if (e) { const k = e.trim().toLowerCase(); candidatos.set(k, (candidatos.get(k) ?? new Set()).add(u.id)); } }
  const porEmail = new Map<string, string>();
  for (const [e, ids] of candidatos) if (ids.size === 1) porEmail.set(e, [...ids][0]!);
  const userDoClickUp = new Map<string, string | null>();
  const membroInfo = new Map<string, { nome: string; email: string | null }>();
  for (const m of team.members ?? []) {
    const u = m.user ?? m;
    membroInfo.set(String(u.id), { nome: u.username ?? u.email ?? String(u.id), email: u.email ?? null });
    userDoClickUp.set(String(u.id), u.email ? (porEmail.get(String(u.email).toLowerCase()) ?? null) : null);
  }
  // Foto do colaborador: só PREENCHE quando o perfil ainda não tem foto (nunca troca uma que a pessoa já tem).
  const fotos: Array<{ id: string; url: string }> = [];
  for (const m of team.members ?? []) {
    const u = m.user ?? m;
    const id = userDoClickUp.get(String(u.id));
    if (id && typeof u.profilePicture === 'string' && /^https:\/\//.test(u.profilePicture)) fotos.push({ id, url: u.profilePicture });
  }
  report.counts['fotos_de_colaborador'] = { novos: 0, atualizados: 0 };
  const nomeDe = (u: Raw): string | null => (u ? (u.username ?? u.email ?? null) : null);
  const resolverUsuario = (u: Raw): string | null => (u ? (userDoClickUp.get(String(u.id)) ?? (u.email ? (porEmail.get(String(u.email).toLowerCase()) ?? null) : null)) : null);
  const naoCasadoCount = new Map<string, number>();
  const contarNaoCasado = (u: Raw) => { if (u && !resolverUsuario(u)) { const k = String(u.id); naoCasadoCount.set(k, (naoCasadoCount.get(k) ?? 0) + 1); if (!membroInfo.has(k)) membroInfo.set(k, { nome: nomeDe(u) ?? k, email: u.email ?? null }); } };

  // ── clientes por nome normalizado IGUAL
  const clientes = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.organizationId, org));
  const clientePorNome = new Map<string, { id: string; name: string }>();
  for (const c of clientes) { const k = normalizar(c.name); if (k && !clientePorNome.has(k)) clientePorNome.set(k, c); }

  // ── mapeamentos existentes
  const maps = await db.select().from(schema.workExternalMappings).where(and(eq(schema.workExternalMappings.organizationId, org), eq(schema.workExternalMappings.provider, PROVIDER)));
  const mapa = new Map<string, string>(maps.map((m) => [`${m.externalType}:${m.externalId}`, m.entityId]));
  const novosMapas: Array<typeof schema.workExternalMappings.$inferInsert> = [];
  const registrar = (externalType: string, externalId: string, entityType: string, entityId: string, meta: Record<string, unknown> = {}) => {
    mapa.set(`${externalType}:${externalId}`, entityId);
    novosMapas.push({ organizationId: org, provider: PROVIDER, externalType, externalId, entityType, entityId, meta });
  };
  const idDe = (t: string, ext: string) => mapa.get(`${t}:${ext}`);

  const run = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    for (const f of fotos) {
      const r = await tx.update(schema.users).set({ avatarUrl: f.url }).where(and(eq(schema.users.id, f.id), sql`${schema.users.avatarUrl} is null`)).returning({ id: schema.users.id });
      if (r.length) bump('fotos_de_colaborador', true);
    }
    // ── espaços + status
    const statusPorEspaco = new Map<string, Map<string, string>>(); // spaceId(work) -> nome minúsculo -> id
    const espacoDaLista = new Map<string, string>();
    for (const [i, s] of spaces.entries()) {
      let id = idDe('space', s.id);
      const arquivado = s._archived ? new Date() : null;
      if (id) { await tx.update(schema.workSpaces).set({ name: s.name, color: s.color ?? null, archivedAt: arquivado }).where(eq(schema.workSpaces.id, id)); bump('espacos', false); }
      else { id = randomUUID(); await tx.insert(schema.workSpaces).values({ id, organizationId: org, name: s.name, color: s.color ?? null, position: (i + 1) * 1000, archivedAt: arquivado, createdBy: ctx.userId }); registrar('space', s.id, 'space', id); bump('espacos', true); }
      const existentes = await tx.select().from(schema.workTaskStatuses).where(eq(schema.workTaskStatuses.spaceId, id));
      const porNome = new Map(existentes.map((x) => [x.name.toLowerCase(), x.id]));
      for (const [j, st] of (s.statuses ?? []).entries()) {
        if (porNome.has(String(st.status).toLowerCase())) continue;
        const sid = randomUUID();
        await tx.insert(schema.workTaskStatuses).values({ id: sid, organizationId: org, spaceId: id, name: st.status, color: st.color ?? '#6b7280', category: categoriaDoStatus(st.type), position: (j + 1) * 1000, isInitial: j === 0, isFinal: st.type === 'closed' || st.type === 'done' });
        porNome.set(String(st.status).toLowerCase(), sid); bump('status', true);
      }
      statusPorEspaco.set(id, porNome);
      for (const l of lists.filter((x) => x._space === s.id)) espacoDaLista.set(l.id, id);
      // pastas
      for (const [k, f] of (s._folders ?? []).entries()) {
        const fid = idDe('folder', f.id);
        const farq = f._archived ? new Date() : null;
        if (fid) { await tx.update(schema.workFolders).set({ name: f.name, archivedAt: farq }).where(eq(schema.workFolders.id, fid)); bump('pastas', false); }
        else { const nid = randomUUID(); await tx.insert(schema.workFolders).values({ id: nid, organizationId: org, spaceId: id, name: f.name, position: (k + 1) * 1000, archivedAt: farq, createdBy: ctx.userId }); registrar('folder', f.id, 'folder', nid); bump('pastas', true); }
      }
    }

    // ── listas (+ cliente por nome igual)
    const clienteDaLista = new Map<string, string>();
    for (const [i, l] of lists.entries()) {
      const spaceId = idDe('space', l._space)!;
      const folderId = l._folder ? (idDe('folder', l._folder) ?? null) : null;
      const larq = l._archived ? new Date() : null;
      const cli = clientePorNome.get(normalizar(l.name));
      if (cli) { clienteDaLista.set(l.id, cli.id); report.clientesCasados.push({ lista: l.name, cliente: cli.name }); } else report.listasSemCliente.push(l.name);
      const lid = idDe('list', l.id);
      if (lid) { await tx.update(schema.workLists).set({ name: l.name, description: l.content ?? null, folderId, ...(cli ? { clientId: cli.id } : {}), archivedAt: larq }).where(eq(schema.workLists.id, lid)); bump('listas', false); }
      else { const nid = randomUUID(); await tx.insert(schema.workLists).values({ id: nid, organizationId: org, spaceId, folderId, clientId: cli?.id ?? null, name: l.name, description: l.content ?? null, position: (i + 1) * 1000, archivedAt: larq, createdBy: ctx.userId }); registrar('list', l.id, 'list', nid); bump('listas', true); }
    }

    // ── campos personalizados (definição por espaço)
    const campoPorExterno = new Map<string, { id: string; type: string; opcoes: Map<string, string>; porIndice: Map<number, string> }>();
    for (const l of lists) {
      const spaceId = idDe('space', l._space)!;
      for (const f of l._fields ?? []) {
        if (campoPorExterno.has(f.id)) continue;
        const tipo = String(f.type);
        const opcoes = ((f.type_config?.options ?? []) as Raw[]).map((o) => ({ id: String(o.id), label: String(o.name ?? o.label ?? ''), color: o.color ?? null }));
        let fid = idDe('custom_field', f.id);
        if (!fid) {
          const [ja] = await tx.select({ id: schema.workCustomFields.id }).from(schema.workCustomFields).where(and(eq(schema.workCustomFields.spaceId, spaceId), eq(schema.workCustomFields.name, f.name), eq(schema.workCustomFields.fieldType, tipo)));
          fid = ja?.id;
          if (fid) registrar('custom_field', f.id, 'custom_field', fid);
        }
        if (!fid) { fid = randomUUID(); await tx.insert(schema.workCustomFields).values({ id: fid, organizationId: org, spaceId, name: f.name, fieldType: tipo, options: opcoes, position: campoPorExterno.size + 1 }); registrar('custom_field', f.id, 'custom_field', fid); bump('campos_personalizados', true); }
        else bump('campos_personalizados', false);
        campoPorExterno.set(f.id, { id: fid, type: tipo, opcoes: new Map(opcoes.map((o) => [o.id, o.label])), porIndice: new Map(((f.type_config?.options ?? []) as Raw[]).map((o, ix) => [Number(o.orderindex ?? ix), String(o.name ?? o.label ?? '')])) });
      }
    }

    // ── tarefas: pais antes de filhos, número na ordem de criação
    const porId = new Map(tasks.map((t) => [t.id, t]));
    const ordenadas: Raw[] = [];
    const colocada = new Set<string>();
    const colocar = (t: Raw, pilha = 0) => {
      if (colocada.has(t.id)) return;
      if (t.parent && porId.has(t.parent) && pilha < 20) colocar(porId.get(t.parent), pilha + 1);
      colocada.add(t.id); ordenadas.push(t);
    };
    [...tasks].sort((a, b) => Number(a.date_created) - Number(b.date_created)).forEach((t) => colocar(t));

    const [{ value: contadorAtual } = { value: 0 }] = await tx.execute(sql`select value from work_counters where organization_id = ${org} and key = 'task'`) as unknown as Array<{ value: number }>;
    let proximo = Number(contadorAtual ?? 0);
    const profundidade = new Map<string, number>();
    const novasTarefas: Array<typeof schema.workTasks.$inferInsert> = [];
    const eventos: Array<typeof schema.workActivityEvents.$inferInsert> = [];

    for (const t of ordenadas) {
      const listId = idDe('list', t.list?.id);
      if (!listId) { report.naoImportado.push(`tarefa ${t.id} sem lista importada`); continue; }
      const spaceId = espacoDaLista.get(t.list.id)!;
      const statuses = statusPorEspaco.get(spaceId)!;
      const nomeStatus = String(t.status?.status ?? 'to do');
      let statusId = statuses.get(nomeStatus.toLowerCase());
      if (!statusId) {
        statusId = randomUUID();
        await tx.insert(schema.workTaskStatuses).values({ id: statusId, organizationId: org, spaceId, name: nomeStatus, color: t.status?.color ?? '#6b7280', category: categoriaDoStatus(t.status?.type), position: 9000 + statuses.size, isFinal: t.status?.type === 'closed' || t.status?.type === 'done' });
        statuses.set(nomeStatus.toLowerCase(), statusId); report.statusCriadosPorTarefa.push(`${nomeStatus} (espaço ${spaceId.slice(0, 8)})`); bump('status', true);
      }
      const fechada = categoriaDoStatus(t.status?.type) === 'done';
      const paiId = t.parent ? (idDe('task', t.parent) ?? null) : null;
      const depth = paiId ? Math.min((profundidade.get(t.parent) ?? 0) + 1, 5) : 0;
      profundidade.set(t.id, depth);
      const prioridade = Number(t.priority?.id ?? 0) || 0;
      const base = {
        listId, parentTaskId: paiId, depth, clientId: clienteDaLista.get(t.list.id) ?? null, title: String(t.name ?? '(sem título)').slice(0, 500),
        description: t.markdown_description || t.text_content || t.description || null, statusId, priority: prioridade > 4 ? 0 : prioridade,
        startAt: ms(t.start_date), dueAt: ms(t.due_date), completedAt: fechada ? (ms(t.date_closed) ?? ms(t.date_done) ?? ms(t.date_updated)) : null,
        estimateMinutes: Number(t.time_estimate) > 0 ? Math.round(Number(t.time_estimate) / 60000) : null,
        tags: ((t.tags ?? []) as Raw[]).map((x) => String(x.name)), position: Number(t.orderindex) || 0, archivedAt: t.archived ? new Date() : null,
      };
      const existente = idDe('task', t.id);
      if (existente) { await tx.update(schema.workTasks).set({ ...base, version: sql`${schema.workTasks.version} + 1` }).where(eq(schema.workTasks.id, existente)); bump('tarefas', false); continue; }
      const nid = randomUUID();
      proximo += 1;
      novasTarefas.push({ id: nid, organizationId: org, number: proximo, ...base, createdBy: resolverUsuario(t.creator), createdAt: ms(t.date_created) ?? new Date(), updatedAt: ms(t.date_updated) ?? new Date() });
      registrar('task', t.id, 'task', nid, { url: t.url ?? null, custom_id: t.custom_id ?? null, creator: nomeDe(t.creator), assignees: ((t.assignees ?? []) as Raw[]).map((a) => ({ nome: nomeDe(a), email: a.email ?? null, vinculado: Boolean(resolverUsuario(a)) })) });
      eventos.push({ organizationId: org, entityType: 'task', entityId: nid, taskId: nid, action: 'imported', actorId: ctx.userId, actorKind: 'system', data: { provider: PROVIDER, externalId: t.id } });
      bump('tarefas', true);
    }
    for (const c of chunk(novasTarefas, 200)) await tx.insert(schema.workTasks).values(c);
    for (const c of chunk(eventos)) await tx.insert(schema.workActivityEvents).values(c);
    if (proximo > Number(contadorAtual ?? 0)) await tx.execute(sql`insert into work_counters (organization_id, key, value) values (${org}, 'task', ${proximo}) on conflict (organization_id, key) do update set value = greatest(work_counters.value, ${proximo})`);

    // ── filhos das tarefas: responsáveis, campos, checklists, dependências, comentários, anexos
    const tarefaId = (ext: string) => idDe('task', ext);
    const assignees: Array<typeof schema.workTaskAssignees.$inferInsert> = [];
    const valoresCampo: Array<typeof schema.workCustomFieldValues.$inferInsert> = [];
    const deps: Array<typeof schema.workTaskDependencies.$inferInsert> = [];
    const checklists: Array<typeof schema.workChecklists.$inferInsert> = [];
    const itens: Array<typeof schema.workChecklistItems.$inferInsert> = [];
    const comentarios: Array<typeof schema.workComments.$inferInsert> = [];
    const anexos: Array<typeof schema.workAttachments.$inferInsert> = [];
    const tempos: Array<typeof schema.workTimeEntries.$inferInsert> = [];
    const jaImportadoFilho = (tipo: string, ext: string) => mapa.has(`${tipo}:${ext}`);

    for (const t of tasks) {
      const tid = tarefaId(t.id);
      if (!tid) continue;
      for (const a of t.assignees ?? []) { contarNaoCasado(a); const uid = resolverUsuario(a); if (uid) assignees.push({ taskId: tid, userId: uid, organizationId: org, assignedBy: ctx.userId }); }
      for (const cf of t.custom_fields ?? []) {
        const def = campoPorExterno.get(cf.id);
        if (!def || cf.value === undefined || cf.value === null || cf.value === '') continue;
        let valor: unknown = cf.value;
        if (def.type === 'drop_down') valor = def.opcoes.get(String(cf.value)) ?? def.porIndice.get(Number(cf.value)) ?? cf.value;
        else if (def.type === 'labels' && Array.isArray(cf.value)) valor = cf.value.map((v: string) => def.opcoes.get(String(v)) ?? v);
        else if (def.type === 'users' && Array.isArray(cf.value)) valor = cf.value.map((u: Raw) => u.email ?? u.username ?? u.id);
        else if (def.type === 'date') valor = ms(cf.value)?.toISOString() ?? cf.value;
        valoresCampo.push({ organizationId: org, taskId: tid, fieldId: def.id, value: valor });
      }
      for (const d of t.dependencies ?? []) {
        const outra = d.task_id === t.id ? d.depends_on : d.task_id;
        const dependente = d.task_id === t.id ? t.id : d.task_id; // task_id espera depends_on
        const bloqueador = d.depends_on;
        const a = tarefaId(dependente); const b = tarefaId(bloqueador);
        if (a && b && a !== b && outra) deps.push({ organizationId: org, taskId: a, dependsOnTaskId: b, kind: 'blocking' });
      }
      for (const lk of t.linked_tasks ?? []) { const a = tid; const b = tarefaId(lk.task_id === t.id ? lk.link_id : lk.task_id); if (b && a !== b) deps.push({ organizationId: org, taskId: a < b ? a : b, dependsOnTaskId: a < b ? b : a, kind: 'related' }); }
      for (const [ci, ch] of (t.checklists ?? []).entries()) {
        if (jaImportadoFilho('checklist', ch.id)) { bump('checklists', false); continue; }
        const cid = randomUUID(); registrar('checklist', ch.id, 'checklist', cid);
        checklists.push({ id: cid, organizationId: org, taskId: tid, name: String(ch.name ?? 'Checklist'), position: ci + 1 });
        const empilhar = (lista: Raw[], pai: string | null) => lista.forEach((it, ix) => {
          const iid = randomUUID(); registrar('checklist_item', it.id, 'checklist_item', iid);
          itens.push({ id: iid, organizationId: org, checklistId: cid, parentItemId: pai, text: String(it.name ?? ''), done: Boolean(it.resolved), assigneeId: resolverUsuario(it.assignee), position: ix + 1 });
          if (it.children?.length) empilhar(it.children, iid);
        });
        empilhar(ch.items ?? [], null); bump('checklists', true);
      }
      const ex = extras[t.id];
      for (const c of ex?.comments ?? []) {
        if (jaImportadoFilho('comment', String(c.id))) { bump('comentarios', false); continue; }
        const cid = randomUUID(); registrar('comment', String(c.id), 'comment', cid);
        contarNaoCasado(c.user);
        const corpo = String(c.comment_text ?? '').trim();
        if (!corpo) continue;
        comentarios.push({ id: cid, organizationId: org, taskId: tid, authorId: resolverUsuario(c.user), authorLabel: nomeDe(c.user), body: corpo, resolvedAt: c.resolved ? new Date() : null, createdAt: ms(c.date) ?? new Date(), updatedAt: ms(c.date) ?? new Date() });
        bump('comentarios', true);
      }
      for (const a of ex?.attachments ?? []) {
        if (jaImportadoFilho('attachment', String(a.id))) { bump('anexos', false); continue; }
        const aid = randomUUID(); registrar('attachment', String(a.id), 'attachment', aid);
        anexos.push({ id: aid, organizationId: org, taskId: tid, fileName: String(a.title ?? a.id).slice(0, 300), mimeType: a.mimetype ?? null, sizeBytes: Number(a.size) || null, url: String(a.url ?? a.url_w_query ?? ''), storage: 'external', uploadedBy: resolverUsuario(a.user), createdAt: ms(a.date) ?? new Date() });
        bump('anexos', true);
      }
    }
    for (const te of timeEntries) {
      const tid = te.task?.id ? tarefaId(String(te.task.id)) : undefined;
      if (!tid || jaImportadoFilho('time_entry', String(te.id))) continue;
      const eid = randomUUID(); registrar('time_entry', String(te.id), 'time_entry', eid);
      const ini = ms(te.start); if (!ini) continue;
      tempos.push({ id: eid, organizationId: org, taskId: tid, userId: resolverUsuario(te.user), userLabel: nomeDe(te.user), startedAt: ini, endedAt: ms(te.end), durationMs: Math.max(0, Math.min(Number(te.duration) || 0, 2_000_000_000)), billable: Boolean(te.billable), note: te.description || null });
      bump('tempo', true);
    }

    for (const c of chunk(assignees)) await tx.insert(schema.workTaskAssignees).values(c).onConflictDoNothing();
    for (const c of chunk(valoresCampo)) await tx.insert(schema.workCustomFieldValues).values(c).onConflictDoUpdate({ target: [schema.workCustomFieldValues.taskId, schema.workCustomFieldValues.fieldId], set: { value: sql`excluded.value`, updatedAt: new Date() } });
    for (const c of chunk(deps)) await tx.insert(schema.workTaskDependencies).values(c).onConflictDoNothing();
    for (const c of chunk(checklists)) await tx.insert(schema.workChecklists).values(c);
    // itens: pais antes dos filhos (parent_item_id é FK) — a ordem de empilhar já garante isso
    for (const c of chunk(itens)) await tx.insert(schema.workChecklistItems).values(c);
    for (const c of chunk(comentarios)) await tx.insert(schema.workComments).values(c);
    for (const c of chunk(anexos)) await tx.insert(schema.workAttachments).values(c);
    for (const c of chunk(tempos)) await tx.insert(schema.workTimeEntries).values(c);
    bump('dependencias', true); report.counts['dependencias'] = { novos: deps.length, atualizados: 0 };
    report.counts['responsaveis_vinculados'] = { novos: assignees.length, atualizados: 0 };
    report.counts['valores_de_campo'] = { novos: valoresCampo.length, atualizados: 0 };
    for (const c of chunk(novosMapas)) await tx.insert(schema.workExternalMappings).values(c).onConflictDoUpdate({ target: [schema.workExternalMappings.organizationId, schema.workExternalMappings.provider, schema.workExternalMappings.externalType, schema.workExternalMappings.externalId], set: { syncedAt: new Date() } });
    if (dryRun) throw new DryRunRollback();
  };

  try { await db.transaction(run as never); } catch (e) { if (!(e instanceof DryRunRollback)) throw e; }

  for (const [k, n] of naoCasadoCount) { const i = membroInfo.get(k); report.usuariosNaoCasados.push({ clickupId: k, nome: i?.nome ?? k, email: i?.email ?? null, tarefas: n }); }
  report.naoImportado.push('Docs, Goals, Views salvas, automações e templates do ClickUp: não importados nesta versão (não há equivalente 1:1 ainda).');
  return report;
}

class DryRunRollback extends Error {}
