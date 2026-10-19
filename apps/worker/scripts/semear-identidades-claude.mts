/**
 * semear-identidades-claude.mts — cria as identidades operacionais reais.
 *
 * É a prova de que o modelo "uma conta de login, muitas pessoas na operação"
 * funciona com os nomes de verdade da agência. Idempotente: roda duas vezes
 * sem duplicar (unique em organization_id + source + external_id).
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/semear-identidades-claude.mts --aplicar
 */
import '../src/env.js';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema, resolverAtor, descreverAtor, podeAtribuirAPessoa } from '@desigual-os/database';

const APLICAR = process.argv.includes('--aplicar');
const ORG = process.env.PROVIDER_ORGANIZATION_ID?.trim();
if (!ORG) { console.error('PROVIDER_ORGANIZATION_ID ausente.'); process.exit(1); }

/** As contas Claude que a agência usa de fato, e o que cada uma representa. */
const IDENTIDADES = [
  { externalId: 'claude-pedro', displayName: 'Pedro Claude', actorType: 'person' as const, pessoa: 'Pedro Gabriel', membros: [] as string[] },
  { externalId: 'claude-atendimento', displayName: 'Equipe Atendimento', actorType: 'shared_account' as const, pessoa: null, membros: ['Tammy', 'Alicia', 'Jamile Galdino'] },
  { externalId: 'claude-criativo', displayName: 'Equipe Criativa', actorType: 'shared_account' as const, pessoa: null, membros: ['Matheus Sain'] },
];

const nomes = [...new Set(IDENTIDADES.flatMap((i) => [...(i.pessoa ? [i.pessoa] : []), ...i.membros]))];
const pessoas = await db.select({ id: schema.people.id, nome: schema.people.canonicalName })
  .from(schema.people).where(inArray(schema.people.canonicalName, nomes));
const porNome = new Map(pessoas.map((p) => [p.nome, p.id]));

const faltando = nomes.filter((n) => !porNome.has(n));
if (faltando.length) { console.error('PARANDO: pessoas não encontradas em people:', faltando.join(', ')); process.exit(1); }

if (!APLICAR) {
  console.log('SIMULAÇÃO. Seriam criadas:');
  for (const i of IDENTIDADES) console.log(`  ${i.displayName.padEnd(22)} ${i.actorType.padEnd(15)} ${i.pessoa ?? i.membros.join(', ')}`);
  process.exit(0);
}

for (const i of IDENTIDADES) {
  const [ident] = await db.insert(schema.operationalIdentities).values({
    organizationId: ORG, source: 'claude', externalId: i.externalId,
    displayName: i.displayName, actorType: i.actorType,
    personId: i.pessoa ? porNome.get(i.pessoa)! : null,
    metadata: { via: 'semear-identidades-claude' },
  }).onConflictDoNothing({ target: [schema.operationalIdentities.organizationId, schema.operationalIdentities.source, schema.operationalIdentities.externalId] }).returning({ id: schema.operationalIdentities.id });

  const id = ident?.id ?? (await db.select({ id: schema.operationalIdentities.id }).from(schema.operationalIdentities)
    .where(and(eq(schema.operationalIdentities.organizationId, ORG), eq(schema.operationalIdentities.source, 'claude'), eq(schema.operationalIdentities.externalId, i.externalId))))[0]?.id;
  if (!id) { console.error('falha em', i.displayName); continue; }

  for (const m of i.membros) {
    await db.insert(schema.operationalIdentityMembers)
      .values({ identityId: id, personId: porNome.get(m)! })
      .onConflictDoNothing({ target: [schema.operationalIdentityMembers.identityId, schema.operationalIdentityMembers.personId] });
  }
  console.log(`  ${ident ? 'criada ' : 'existia'} ${i.displayName}`);
}

console.log('\n=== PROVA EM RUNTIME: como o sistema descreve cada ator ===');
for (const i of IDENTIDADES) {
  const ator = await resolverAtor(ORG, 'claude', i.externalId);
  if (!ator) { console.log(`  ${i.displayName}: NAO RESOLVEU`); continue; }
  console.log(`\n  [${ator.actorType}] ${descreverAtor(ator)}`);
  console.log(`     pode atribuir a uma pessoa? ${podeAtribuirAPessoa(ator) ? 'SIM' : 'NAO'}  | person_id: ${ator.personId ?? 'null'}`);
}
process.exit(0);
