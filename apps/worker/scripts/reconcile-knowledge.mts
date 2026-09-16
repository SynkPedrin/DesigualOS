/**
 * reconcile-knowledge.mts — reconciliação FONTE -> ÍNDICE para todos os clientes.
 *
 * Responde a pergunta que o sistema não sabia responder: "o que existe na fonte
 * e não está no conhecimento do agente?". Antes só dava para perguntar "a busca
 * devolveu alguma coisa?", e foi por isso que uma campanha com 253 tasks, viva e
 * atualizada no mesmo dia, simplesmente não existia para o Otto.
 *
 * Deriva do ClickUp: campanhas, pessoas, relações pessoa<->cliente (cada uma com
 * evidência e tipo) e o estado de sync por cliente e fonte.
 *
 * Idempotente: roda quantas vezes quiser. Chave natural por (cliente, nome
 * normalizado) e por nome de pessoa; reimportar ATUALIZA.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/reconcile-knowledge.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/reconcile-knowledge.mts --aplicar
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { derivarCampanhas, dobrar } from '@desigual-os/context-engine';
import { crawlClickUp, type CrawlTask } from './lib/clickup-crawl.mjs';

const APLICAR = process.argv.includes('--aplicar');
const apiKey = process.env.CLICKUP_API_KEY ?? '';
const teamId = process.env.CLICKUP_TEAM_ID ?? '';
if (!apiKey || !teamId) { console.error('CLICKUP_API_KEY/CLICKUP_TEAM_ID ausentes.'); process.exit(1); }

/** Task parada há mais de 180 dias não sustenta "faz parte do time HOJE". */
const DIAS_PARA_HISTORICO = 180;
const agora = Date.now();
const ehRecente = (d: Date | null | undefined) =>
  d instanceof Date && agora - d.getTime() < DIAS_PARA_HISTORICO * 86_400_000;

console.log('Lendo o ClickUp inteiro...');
const crawl = await crawlClickUp(apiKey, teamId, (m) => console.log('  ' + m));

const clientes = await db
  .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
  .from(schema.clients)
  .where(isNull(schema.clients.deletedAt));

const porLista = new Map<string, { id: string; name: string }>();
for (const c of clientes) if (c.listId) porLista.set(c.listId, { id: c.id, name: c.name });

const tasksPorCliente = new Map<string, CrawlTask[]>();
for (const t of crawl.tasks) {
  const c = porLista.get(t.listId);
  if (!c) continue;
  const atual = tasksPorCliente.get(c.id) ?? [];
  atual.push(t);
  tasksPorCliente.set(c.id, atual);
}

// ---------- PESSOAS ----------
// Membro do workspace é fato de diretório; quem só aparece como responsável de
// task entra como 'external'. Volume de trabalho NUNCA vira vínculo.
interface PessoaDerivada {
  canonicalName: string; normalizedName: string; email: string | null;
  clickupUserId: string | null; employmentType: string; lastSeenAt: Date | null;
  sourceRefs: string[];
}
const pessoas = new Map<string, PessoaDerivada>();
function registrarPessoa(nome: string, dados: Partial<PessoaDerivada>) {
  const norm = dobrar(nome);
  if (norm.length < 2) return;
  const atual = pessoas.get(norm) ?? {
    canonicalName: nome, normalizedName: norm, email: null, clickupUserId: null,
    employmentType: 'unknown', lastSeenAt: null, sourceRefs: [],
  };
  pessoas.set(norm, {
    ...atual,
    email: dados.email ?? atual.email,
    clickupUserId: dados.clickupUserId ?? atual.clickupUserId,
    employmentType: dados.employmentType ?? atual.employmentType,
    lastSeenAt: dados.lastSeenAt && (!atual.lastSeenAt || dados.lastSeenAt > atual.lastSeenAt) ? dados.lastSeenAt : atual.lastSeenAt,
    sourceRefs: [...new Set([...atual.sourceRefs, ...(dados.sourceRefs ?? [])])].slice(0, 200),
  });
}
for (const m of crawl.members) {
  registrarPessoa(m.username, { email: m.email, clickupUserId: m.id, employmentType: 'agency_member', sourceRefs: ['clickup:member'] });
}
for (const t of crawl.tasks) {
  for (const a of t.assignees) registrarPessoa(a.username, { clickupUserId: a.id, lastSeenAt: t.updatedAt, sourceRefs: [`task:${t.id}`] });
}

// ---------- RELAÇÕES pessoa <-> cliente ----------
// TASK_ASSIGNEE e nada além disso. "Responsável pela conta" exige uma fonte que
// diga isso; a fonte atual não diz, então o sistema NÃO afirma.
const relacoes = new Map<string, { pessoa: string; clientId: string; tipo: string; refs: string[]; primeira: Date | null; ultima: Date | null }>();
for (const [clientId, ts] of tasksPorCliente) {
  for (const t of ts) {
    for (const a of t.assignees) {
      const pessoa = dobrar(a.username);
      if (pessoa.length < 2) continue;
      const chave = `${pessoa}|${clientId}|TASK_ASSIGNEE`;
      const atual = relacoes.get(chave) ?? { pessoa, clientId, tipo: 'TASK_ASSIGNEE', refs: [], primeira: null, ultima: null };
      atual.refs = [...new Set([...atual.refs, t.id])].slice(0, 300);
      if (t.createdAt && (!atual.primeira || t.createdAt < atual.primeira)) atual.primeira = t.createdAt;
      if (t.updatedAt && (!atual.ultima || t.updatedAt > atual.ultima)) atual.ultima = t.updatedAt;
      relacoes.set(chave, atual);
    }
  }
}

// ---------- CAMPANHAS ----------
const campanhasPorCliente = new Map<string, ReturnType<typeof derivarCampanhas>>();
for (const [clientId, ts] of tasksPorCliente) {
  const nomeDoCliente = clientes.find((c) => c.id === clientId)?.name;
  campanhasPorCliente.set(clientId, derivarCampanhas(
    ts.map((t) => ({
      id: t.id, name: t.name, description: t.description, status: t.status, closed: t.closed, updatedAt: t.updatedAt,
    })),
    nomeDoCliente ? { clientName: nomeDoCliente } : {},
  ));
}

const totalCampanhas = [...campanhasPorCliente.values()].reduce((s, c) => s + c.length, 0);
console.log(`\nDerivado: ${pessoas.size} pessoas | ${relacoes.size} relações | ${totalCampanhas} campanhas em ${campanhasPorCliente.size} clientes`);
console.log(`Clientes sem lista no ClickUp: ${clientes.length - porLista.size}`);

if (!APLICAR) {
  const amostra = [...campanhasPorCliente.entries()].slice(0, 3);
  for (const [cid, cs] of amostra) {
    const nome = clientes.find((c) => c.id === cid)?.name;
    console.log(`  ${nome}: ${cs.slice(0, 5).map((c) => c.canonicalName).join(' | ')}`);
  }
  console.log('\nSIMULAÇÃO — rode com --aplicar para gravar.');
  process.exit(0);
}

// ---------- GRAVAÇÃO ----------
const idDaPessoa = new Map<string, string>();
for (const p of pessoas.values()) {
  const [row] = await db
    .insert(schema.people)
    .values({
      canonicalName: p.canonicalName, normalizedName: p.normalizedName, email: p.email,
      clickupUserId: p.clickupUserId, employmentType: p.employmentType,
      activeStatus: p.employmentType === 'agency_member' ? 'active' : 'unknown',
      sourceRefs: p.sourceRefs, lastSeenAt: p.lastSeenAt, lastSyncAt: new Date(), updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.people.normalizedName,
      set: {
        canonicalName: p.canonicalName, email: p.email, clickupUserId: p.clickupUserId,
        employmentType: p.employmentType, sourceRefs: p.sourceRefs, lastSeenAt: p.lastSeenAt,
        lastSyncAt: new Date(), updatedAt: new Date(),
      },
    })
    .returning({ id: schema.people.id });
  if (row) idDaPessoa.set(p.normalizedName, row.id);
}

for (const r of relacoes.values()) {
  const personId = idDaPessoa.get(r.pessoa);
  if (!personId) continue;
  await db
    .insert(schema.personClientRelations)
    .values({
      personId, clientId: r.clientId, relationType: r.tipo,
      temporalStatus: ehRecente(r.ultima) ? 'current' : 'historical',
      evidenceRefs: r.refs, evidenceCount: r.refs.length,
      firstSeenAt: r.primeira, lastSeenAt: r.ultima, updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.personClientRelations.personId, schema.personClientRelations.clientId, schema.personClientRelations.relationType],
      set: {
        temporalStatus: ehRecente(r.ultima) ? 'current' : 'historical',
        evidenceRefs: r.refs, evidenceCount: r.refs.length,
        firstSeenAt: r.primeira, lastSeenAt: r.ultima, updatedAt: new Date(),
      },
    });
}

let gravadas = 0;
for (const [clientId, cs] of campanhasPorCliente) {
  const lista = clientes.find((c) => c.id === clientId)?.listId ?? null;
  for (const c of cs) {
    await db
      .insert(schema.campaigns)
      .values({
        clientId, canonicalName: c.canonicalName, normalizedName: c.normalizedName,
        aliases: c.aliases, status: c.openTaskCount > 0 ? 'active' : 'historical',
        sourceType: 'clickup', sourceListId: lista, taskRefs: c.taskRefs, recentTasks: c.recentTasks,
        taskCount: c.taskCount, openTaskCount: c.openTaskCount,
        lastSourceUpdateAt: c.lastSourceUpdateAt, lastSyncAt: new Date(), updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.campaigns.clientId, schema.campaigns.normalizedName],
        set: {
          canonicalName: c.canonicalName, aliases: c.aliases,
          status: c.openTaskCount > 0 ? 'active' : 'historical',
          taskRefs: c.taskRefs, recentTasks: c.recentTasks, taskCount: c.taskCount, openTaskCount: c.openTaskCount,
          lastSourceUpdateAt: c.lastSourceUpdateAt, lastSyncAt: new Date(), updatedAt: new Date(),
        },
      });
    gravadas += 1;
  }
}

// ---------- ÍNDICE VELHO ----------
// Campanha é 100% DERIVADA da fonte: se deixou de ser derivada, ou o nome mudou
// ou as tasks sumiram, e a linha antiga vira concorrente da nova na resolução —
// foi assim que "Campanha Operação Blindada" e "Operação Blindada" passaram a
// disputar o mesmo pedido. Reconciliar sem remover o que não existe mais é
// deixar índice velho decidir.
let removidas = 0;
for (const [clientId, cs] of campanhasPorCliente) {
  const vivas = new Set(cs.map((c) => c.normalizedName));
  const atuais = await db
    .select({ id: schema.campaigns.id, nome: schema.campaigns.normalizedName })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.clientId, clientId))
    .catch(() => []);
  for (const a of atuais) {
    if (vivas.has(a.nome)) continue;
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, a.id)).catch(() => undefined);
    removidas += 1;
  }
}

// ---------- ESTADO DE SYNC ----------
for (const c of clientes) {
  const ts = tasksPorCliente.get(c.id) ?? [];
  const cs = campanhasPorCliente.get(c.id) ?? [];
  const datas = ts.map((t) => t.updatedAt).filter((d): d is Date => d instanceof Date);
  const ultima = datas.length > 0 ? new Date(Math.max(...datas.map((d) => d.getTime()))) : null;
  const linhas = [
    { source: 'clickup', status: c.listId ? (ts.length > 0 ? 'ok' : 'empty') : 'error', count: ts.length, detail: c.listId ? null : 'cliente sem clickup_list_id' },
    { source: 'campaigns', status: cs.length > 0 ? 'ok' : 'empty', count: cs.length, detail: null },
  ];
  for (const l of linhas) {
    await db
      .insert(schema.clientKnowledgeSync)
      .values({ clientId: c.id, source: l.source, status: l.status, documentCount: l.count, lastSourceUpdateAt: ultima, lastSyncAt: new Date(), detail: l.detail, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.clientKnowledgeSync.clientId, schema.clientKnowledgeSync.source],
        set: { status: l.status, documentCount: l.count, lastSourceUpdateAt: ultima, lastSyncAt: new Date(), detail: l.detail, updatedAt: new Date() },
      });
  }
}

console.log(`\nAPLICADO — ${idDaPessoa.size} pessoas, ${relacoes.size} relações, ${gravadas} campanhas gravadas, ${removidas} campanhas obsoletas removidas, ${clientes.length} clientes com estado de sync`);
process.exit(0);
