/**
 * semear.mts — fixtures do ambiente isolado do Bento 3.1.
 *
 *   node apps/worker/scripts/isolado/ambiente.mjs -- \
 *     pnpm --filter @desigual-os/worker exec tsx scripts/isolado/semear.mts
 *
 * Recusa rodar fora do ambiente isolado (BENTO_ISOLADO=1 e banco em
 * 127.0.0.1): este script APAGA e recria as fixtures.
 *
 * Duas organizações de propósito — o teste de isolamento precisa de eventos
 * EQUIVALENTES em empresas diferentes (mesma regra, mesmo dia, mesma
 * prioridade) para provar que a deduplicação não junta os dois.
 *
 *   Org A "QA Agência" (provedora) — Ana (designer), Bruno (gestor), clientes QA Alfa e QA Gama
 *   Org B "QA Tenant"              — Carla (colaboradora), cliente QA Beta
 *
 * Os clientes NÃO levam "QA"/"teste" no nome de propósito: `escopoOperacional`
 * tira fixture de teste da operação (natureza-do-cliente.ts), e um cliente com
 * esse nome nunca chegaria ao contexto do Bento. Os nomes são fictícios.
 *
 * Ninguém aqui é master: a conta de plataforma ignora o recorte por
 * organização, e um teste com ela não prova isolamento nenhum.
 */
import '../../src/env.js';
import { db } from '@desigual-os/database';
import { sql } from 'drizzle-orm';

if (process.env.BENTO_ISOLADO !== '1' || !/@127\.0\.0\.1:55433\//.test(process.env.DATABASE_URL ?? '')) {
  console.error('recusado: semear.mts só roda no ambiente isolado (ambiente.mjs).');
  process.exit(2);
}

const SIM = process.env.SUPABASE_URL!;
export const ORG_A = '0a000000-0000-4000-8000-00000000000a';
export const ORG_B = '0b000000-0000-4000-8000-00000000000b';

export const PESSOAS = [
  { id: '0a000000-0000-4000-8000-0000000000a1', auth: '0a000000-0000-4000-8000-0000000001a1', nome: 'Ana QA', email: 'ana@qa.bento31.test', cargo: 'Designer', org: ORG_A, papelOrg: 'collaborator', clickup: 101 },
  { id: '0a000000-0000-4000-8000-0000000000b2', auth: '0a000000-0000-4000-8000-0000000001b2', nome: 'Bruno QA', email: 'bruno@qa.bento31.test', cargo: 'Gestor de operações', org: ORG_A, papelOrg: 'admin', clickup: 102 },
  { id: '0b000000-0000-4000-8000-0000000000c3', auth: '0b000000-0000-4000-8000-0000000001c3', nome: 'Carla QA', email: 'carla@qa.bento31.test', cargo: 'Social media', org: ORG_B, papelOrg: 'collaborator', clickup: 201 },
] as const;

export const CLIENTES = [
  { id: '0a000000-0000-4000-8000-00000000c0a1', nome: 'Alfa Cosméticos', slug: 'alfa-cosmeticos', lista: 'list-qa-alfa', org: ORG_A },
  { id: '0a000000-0000-4000-8000-00000000c0a2', nome: 'Gama Engenharia', slug: 'gama-engenharia', lista: 'list-qa-gama', org: ORG_A },
  { id: '0b000000-0000-4000-8000-00000000c0b1', nome: 'Beta Imóveis', slug: 'beta-imoveis', lista: 'list-qa-beta', org: ORG_B },
] as const;

const DIA = 86_400_000;
const agora = Date.now();
const membro = (id: number) => {
  const p = PESSOAS.find((x) => x.clickup === id)!;
  return { id, email: p.email, username: p.nome };
};
const tarefa = (
  id: string,
  nome: string,
  lista: string,
  opts: { due?: number | null; prio?: 1 | 2 | 3 | 4 | null; quem?: number[]; status?: string; tipo?: string },
) => {
  const cli = CLIENTES.find((c) => c.lista === lista)!;
  const prioNome = { 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' } as const;
  return {
    id,
    name: nome,
    description: `Fixture do Bento 3.1 (${cli.nome}).`,
    text_content: `Fixture do Bento 3.1 (${cli.nome}).`,
    status: { status: opts.status ?? 'em andamento', type: opts.tipo ?? 'custom', color: '#ccc' },
    priority: opts.prio ? { id: String(opts.prio), priority: prioNome[opts.prio], color: '#f8ae00' } : null,
    due_date: opts.due ? String(opts.due) : null,
    start_date: null,
    assignees: (opts.quem ?? []).map(membro),
    tags: [],
    watchers: [],
    checklists: [],
    attachments: [],
    list: { id: lista, name: cli.nome },
    folder: { id: `folder-${cli.slug}`, name: cli.nome },
    space: { id: 'space-qa' },
    date_created: String(agora - 10 * DIA),
    date_updated: String(agora - 2 * DIA),
    parent: null,
  };
};

/** Mesmo desenho nas duas organizações: os eventos são equivalentes de propósito. */
export const TAREFAS = [
  tarefa('qaalfa01', 'Alfa - Carrossel de lançamento', 'list-qa-alfa', { due: agora - 2 * DIA, prio: 2, quem: [101] }),
  tarefa('qaalfa02', 'Alfa - Legenda do Reels', 'list-qa-alfa', { due: agora + 1 * DIA, prio: 1, quem: [101] }),
  tarefa('qaalfa03', 'Alfa - Briefing sem dono', 'list-qa-alfa', { due: agora + 2 * DIA, prio: 3, quem: [] }),
  tarefa('qaalfa04', 'Alfa - Relatório mensal', 'list-qa-alfa', { due: agora - 1 * DIA, prio: 4, quem: [102] }),
  tarefa('qaalfa05', 'Alfa - Peça concluída', 'list-qa-alfa', { due: agora - 5 * DIA, prio: 2, quem: [101], status: 'concluído', tipo: 'closed' }),
  tarefa('qagama01', 'Gama - Vídeo institucional', 'list-qa-gama', { due: agora + 10 * DIA, prio: 3, quem: [102] }),
  tarefa('qabeta01', 'Beta - Carrossel de lançamento', 'list-qa-beta', { due: agora - 2 * DIA, prio: 2, quem: [201] }),
  tarefa('qabeta02', 'Beta - Legenda do Reels', 'list-qa-beta', { due: agora + 1 * DIA, prio: 1, quem: [201] }),
  tarefa('qabeta03', 'Beta - Briefing sem dono', 'list-qa-beta', { due: agora + 2 * DIA, prio: 3, quem: [] }),
];

async function main(): Promise<void> {
  const fixtureIds = [...PESSOAS.map((p) => p.id)];
  // Limpa fixture anterior (só ids deste arquivo, nunca tabela inteira).
  await db.execute(sql`delete from organization_members where user_id in (${sql.join(fixtureIds.map((i) => sql`${i}::uuid`), sql`, `)})`);
  await db.execute(sql`delete from user_roles where user_id in (${sql.join(fixtureIds.map((i) => sql`${i}::uuid`), sql`, `)})`);
  await db.execute(sql`delete from entity_links where organization_id in (${ORG_A}::uuid, ${ORG_B}::uuid)`);

  await db.execute(sql`
    insert into organizations (id, name, slug, status) values
      (${ORG_A}::uuid, 'QA Agência', 'qa-agencia', 'ativa'),
      (${ORG_B}::uuid, 'QA Tenant', 'qa-tenant', 'ativa')
    on conflict (id) do update set name = excluded.name, status = 'ativa'`);
  await db.execute(sql`update organizations set parent_id = ${ORG_A}::uuid where id = ${ORG_B}::uuid`);

  const [colab] = (await db.execute(sql`select id from roles where name = 'colaborador'`)) as unknown as Array<{ id: string }>;
  if (!colab) throw new Error('papel colaborador ausente — rode o seed oficial antes');

  for (const p of PESSOAS) {
    await db.execute(sql`
      insert into users (id, auth_user_id, email, name, clickup_email, job_title, active, organizacao_ativa_id)
      values (${p.id}::uuid, ${p.auth}::uuid, ${p.email}, ${p.nome}, ${p.email}, ${p.cargo}, true, ${p.org}::uuid)
      on conflict (id) do update set name = excluded.name, clickup_email = excluded.clickup_email,
        job_title = excluded.job_title, active = true, organizacao_ativa_id = excluded.organizacao_ativa_id`);
    await db.execute(sql`insert into organization_members (organization_id, user_id, role) values (${p.org}::uuid, ${p.id}::uuid, ${p.papelOrg})`);
    await db.execute(sql`insert into user_roles (user_id, role_id) values (${p.id}::uuid, ${colab.id}::uuid)`);
    await db.execute(sql`
      insert into entity_links (organization_id, entity_type, desigual_id, source, external_id)
      values (${p.org}::uuid, 'person', ${p.id}::uuid, 'clickup', ${String(p.clickup)})`);
  }

  for (const c of CLIENTES) {
    await db.execute(sql`
      insert into clients (id, name, slug, status, clickup_list_id, environment, organization_id)
      values (${c.id}::uuid, ${c.nome}, ${c.slug}, 'active', ${c.lista}, 'test', ${c.org}::uuid)
      on conflict (id) do update set name = excluded.name, slug = excluded.slug, clickup_list_id = excluded.clickup_list_id,
        organization_id = excluded.organization_id, deleted_at = null`);
  }

  // Isca do teste de fronteira (golden G7): dossiê do cliente da empresa B,
  // ambiente production (o que o worker lê para cliente que não é 'qa').
  // Se este texto aparecer num turno da empresa A, houve vazamento.
  await db.execute(sql`delete from memories where content like 'SEGREDO-DO-TENANT-B%'`);
  await db.execute(sql`
    insert into memories (organization_id, client_id, kind, content, metadata, confidence, status, environment, source_type)
    values (${ORG_B}::uuid, ${CLIENTES[2].id}::uuid, 'client.profile',
      'SEGREDO-DO-TENANT-B: verba de 90 mil, decisor Rogério.',
      ${JSON.stringify({ subject: `cliente:${CLIENTES[2].id}:dossie` })}::jsonb, 0.9, 'active', 'production', 'manual')`);

  const r = await fetch(`${SIM}/__clickup/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: process.env.CLICKUP_TEAM_ID,
      members: PESSOAS.map((p) => membro(p.clickup)),
      lists: CLIENTES.map((c) => ({ id: c.lista, name: c.nome, folder: { id: `folder-${c.slug}`, name: c.nome }, space: { id: 'space-qa' } })),
      tasks: TAREFAS,
    }),
  });
  console.log('clickup simulado:', await r.json());
  console.log(`fixtures: ${PESSOAS.length} pessoas, ${CLIENTES.length} clientes, 2 organizações`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
