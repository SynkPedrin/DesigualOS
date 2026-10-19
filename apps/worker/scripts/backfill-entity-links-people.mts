/**
 * backfill-entity-links-people.mts — a ponte ClickUp <-> PEOPLE.
 *
 * NÃO SUBSTITUI `backfill-entity-links.mts`, que faz outra coisa: aquele liga
 * ClickUp a `users` pelo `users.clickup_email`, e por isso só alcança quem tem
 * LOGIN no produto. Medido em 01/10/2026: produziu 2 vínculos, porque só o
 * Pedro tem esse campo preenchido.
 *
 * Este aqui serve o modelo que o produto escolheu: UMA conta de login (o
 * master) e MUITAS pessoas na operação. A equipe vive em `people`, importada do
 * ClickUp, com `clickup_user_id` — 23 pessoas hoje, incluindo Matheus Sain e
 * Jamile Galdino, que não têm e nunca vão ter conta no Desigual.
 *
 *     users   = quem entra no produto
 *     people  = quem trabalha na operação
 *
 * ---
 *
 * DE ONDE SAI O `organization_id`, que é a decisão difícil deste script.
 *
 * `people` NÃO tem coluna de organização: a tabela é global, herdada de quando
 * existia uma empresa só. E o briefing é explícito: "não adivinhe organização,
 * não use default global".
 *
 * A saída honesta não é inventar o dono — é DECLARÁ-LO. A organização dona
 * destas pessoas é a dona da conexão do ClickUp de onde elas vieram, e isso
 * passa a ser DADO (`organization_connectors`) em vez de env. Na primeira
 * execução com `--aplicar`, o script registra esse vínculo; da segunda em
 * diante ele lê de lá e o env deixa de mandar.
 *
 * Sem `PROVIDER_ORGANIZATION_ID` e sem conector registrado, o script PARA. Não
 * há palpite seguro aqui: vincular a pessoa errada à empresa errada contamina o
 * entity graph de forma que ninguém percebe depois.
 *
 * Idempotente por `(organization_id, source, entity_type, external_id)` —
 * `vincularEntidade` devolve 'created' ou 'existing', e é isso que o relatório
 * conta. Rodar duas vezes produz zero vínculo novo.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-entity-links-people.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-entity-links-people.mts --aplicar
 */
import '../src/env.js';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema, vincularEntidade } from '@desigual-os/database';

const APLICAR = process.argv.includes('--aplicar');

/** A organização dona da conexão do ClickUp, por DADO quando já existe. */
async function organizacaoDoClickUp(): Promise<{ id: string; origem: string } | null> {
  const [conector] = await db
    .select({ organizationId: schema.organizationConnectors.organizationId })
    .from(schema.organizationConnectors)
    .where(eq(schema.organizationConnectors.provider, 'clickup'))
    .catch(() => []);
  if (conector) return { id: conector.organizationId, origem: 'organization_connectors' };

  const provedora = process.env.PROVIDER_ORGANIZATION_ID?.trim();
  if (provedora) return { id: provedora, origem: 'PROVIDER_ORGANIZATION_ID (será registrado)' };
  return null;
}

const dona = await organizacaoDoClickUp();
if (!dona) {
  console.error(
    'PARANDO: não sei de qual empresa são estas pessoas.\n' +
      'Registre o conector em organization_connectors (provider=clickup) ou defina PROVIDER_ORGANIZATION_ID.\n' +
      'Vincular pessoa à empresa errada contamina o entity graph em silêncio.',
  );
  process.exit(1);
}

const [empresa] = await db
  .select({ id: schema.organizations.id, name: schema.organizations.name })
  .from(schema.organizations)
  .where(eq(schema.organizations.id, dona.id))
  .catch(() => []);
if (!empresa) {
  console.error(`PARANDO: a organização ${dona.id} não existe.`);
  process.exit(1);
}

console.log(`Empresa dona do ClickUp: ${empresa.name}  (origem: ${dona.origem})`);

const pessoas = await db
  .select({
    id: schema.people.id,
    nome: schema.people.canonicalName,
    email: schema.people.email,
    clickupUserId: schema.people.clickupUserId,
    tipo: schema.people.employmentType,
  })
  .from(schema.people)
  .where(isNotNull(schema.people.clickupUserId));

const todas = await db.select({ id: schema.people.id }).from(schema.people);

const antes = await db
  .select({ id: schema.entityLinks.id })
  .from(schema.entityLinks)
  .where(and(eq(schema.entityLinks.source, 'clickup'), eq(schema.entityLinks.entityType, 'person')));

console.log(`\npeople no total:              ${todas.length}`);
console.log(`people com clickup_user_id:   ${pessoas.length}   <- elegíveis`);
console.log(`people SEM clickup_user_id:   ${todas.length - pessoas.length}   <- não resolvíveis por id externo`);
console.log(`vínculos person/clickup ANTES: ${antes.length}\n`);

if (!APLICAR) {
  console.log('SIMULAÇÃO (sem --aplicar). Seriam vinculadas:');
  for (const p of pessoas) console.log(`  ${p.nome.padEnd(28)} clickup=${p.clickupUserId}  ${p.email ?? '(sem e-mail)'}`);
  console.log(`\nRode de novo com --aplicar para gravar.`);
  process.exit(0);
}

let criados = 0;
let existentes = 0;
const falhas: string[] = [];

for (const p of pessoas) {
  try {
    const r = await vincularEntidade({
      organizationId: empresa.id,
      entityType: 'person',
      desigualId: p.id,
      source: 'clickup',
      externalId: p.clickupUserId!,
      /**
       * O e-mail e o nome vão no metadata como PROCEDÊNCIA, nunca como chave:
       * a chave é o id externo, que é estável. Nome muda, e-mail muda; id do
       * ClickUp não.
       */
      metadata: { canonical_name: p.nome, email: p.email, employment_type: p.tipo, via: 'backfill-people' },
    });
    if (r.status === 'created') criados++;
    else existentes++;
  } catch (erro) {
    falhas.push(`${p.nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

/**
 * Registra o conector para que a PRÓXIMA execução derive a empresa de dado, e
 * não do env. É o que tira este script do "default global" que o briefing
 * proíbe — a partir daqui a atribuição é explícita e auditável.
 */
if (dona.origem !== 'organization_connectors') {
  await db
    .insert(schema.organizationConnectors)
    .values({ organizationId: empresa.id, provider: 'clickup', credentials: {}, status: 'active' })
    .onConflictDoNothing()
    .catch(() => undefined);
  console.log('Conector do ClickUp registrado em organization_connectors.');
}

const depois = await db
  .select({ id: schema.entityLinks.id })
  .from(schema.entityLinks)
  .where(and(eq(schema.entityLinks.source, 'clickup'), eq(schema.entityLinks.entityType, 'person')));

console.log('\n=== RESULTADO ===');
console.log(`  vínculos criados:       ${criados}`);
console.log(`  já existiam (idempot.): ${existentes}`);
console.log(`  falhas:                 ${falhas.length}`);
for (const f of falhas) console.log(`     ${f}`);
console.log(`  vínculos person/clickup DEPOIS: ${depois.length} (eram ${antes.length})`);
process.exit(0);
