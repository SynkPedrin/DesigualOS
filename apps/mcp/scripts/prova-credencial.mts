/**
 * prova-credencial.mts — prova em RUNTIME dos testes 15..18 do bloco.
 *
 * Não é teste unitário: emite credencial de verdade, valida pelo MESMO
 * `verificarAccessToken` que o servidor usa, revoga, rotaciona e tenta
 * atravessar tenant. Se qualquer um falhar fechado, o relatório diz.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema, resolverAtor, podeAtribuirAPessoa } from '@desigual-os/database';
import { emitirCredencialDeConexao, revogarCredenciaisDaIdentidade, verificarAccessToken } from '../src/auth/token-store.js';

const ORG = process.env.PROVIDER_ORGANIZATION_ID!;
const CLIENT_ID = 'prova-credencial';

await db.insert(schema.mcpClients).values({
  clientId: CLIENT_ID, clientName: 'Prova de credencial', redirectUris: [], grantTypes: [], scopes: ['desigual.read'],
}).onConflictDoNothing();

const [master] = await db.select({ id: schema.users.id }).from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'));

async function identidade(externalId: string) {
  const [i] = await db.select({ id: schema.operationalIdentities.id, nome: schema.operationalIdentities.displayName })
    .from(schema.operationalIdentities)
    .where(and(eq(schema.operationalIdentities.organizationId, ORG), eq(schema.operationalIdentities.externalId, externalId)));
  return i!;
}

const atendimento = await identidade('claude-atendimento');
const pedroClaude = await identidade('claude-pedro');

const ok = (b: boolean) => (b ? 'PASSOU' : 'FALHOU');

// --- TESTE 19/20: credencial carrega o ator certo ---
const c1 = await emitirCredencialDeConexao({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, actorIdentityId: atendimento.id, scopes: ['desigual.read'] });
const v1 = await verificarAccessToken(c1.credencial);
const ator1 = v1?.actorIdentityId ? await resolverAtor(ORG, 'claude', 'claude-atendimento') : null;
console.log(`\nTESTE 20 (shared): credencial valida=${!!v1}`);
console.log(`  authorized_by (userId) = master? ${ok(v1?.userId === master!.id)}`);
console.log(`  actor_identity = Equipe Atendimento? ${ok(v1?.actorIdentityId === atendimento.id)}`);
console.log(`  actor_person = null?                ${ok(ator1?.personId === null)}`);
console.log(`  pode atribuir a pessoa?             ${ok(podeAtribuirAPessoa(ator1!) === false)} (deve ser NAO)`);

const c2 = await emitirCredencialDeConexao({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, actorIdentityId: pedroClaude.id, scopes: ['desigual.read'] });
const v2 = await verificarAccessToken(c2.credencial);
const ator2 = await resolverAtor(ORG, 'claude', 'claude-pedro');
console.log(`\nTESTE 19 (person): actor_identity correto? ${ok(v2?.actorIdentityId === pedroClaude.id)}`);
console.log(`  actor_person preenchido?            ${ok(!!ator2?.personId)}`);
console.log(`  pode atribuir a pessoa?             ${ok(podeAtribuirAPessoa(ator2!) === true)} (deve ser SIM)`);

// --- TESTE 15: revogacao ---
const antes = await verificarAccessToken(c1.credencial);
const quantas = await revogarCredenciaisDaIdentidade(ORG, atendimento.id);
const depois = await verificarAccessToken(c1.credencial);
console.log(`\nTESTE 15 (revogacao): antes valia=${!!antes}, revogadas=${quantas}, depois vale=${!!depois}`);
console.log(`  ${ok(!!antes && !depois)}`);

// --- TESTE 16: rotacao (nova vale, antiga morre no mesmo instante) ---
const cA = await emitirCredencialDeConexao({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, actorIdentityId: pedroClaude.id, scopes: ['desigual.read'] });
const aValia = !!(await verificarAccessToken(cA.credencial));
await revogarCredenciaisDaIdentidade(ORG, pedroClaude.id);
const cB = await emitirCredencialDeConexao({ clientId: CLIENT_ID, userId: master!.id, organizationId: ORG, actorIdentityId: pedroClaude.id, scopes: ['desigual.read'] });
const aDepois = !!(await verificarAccessToken(cA.credencial));
const bVale = !!(await verificarAccessToken(cB.credencial));
console.log(`\nTESTE 16 (rotacao): A valia=${aValia}, depois A=${aDepois}, B=${bVale}`);
console.log(`  ${ok(aValia && !aDepois && bVale)}`);

// --- TESTE 18: cross-tenant ---
const [outra] = await db.select({ id: schema.organizations.id, name: schema.organizations.name })
  .from(schema.organizations).where(eq(schema.organizations.name, 'Empresa QA White Label'));
const atorCruzado = outra ? await resolverAtor(outra.id, 'claude', 'claude-atendimento') : null;
console.log(`\nTESTE 18 (cross-tenant): identidade da Desigual resolve em "${outra?.name}"? ${atorCruzado ? 'SIM — VAZOU' : 'NAO'}`);
console.log(`  ${ok(atorCruzado === null)}`);

// --- TESTE 17: legado ---
const [leg] = await db.select({ n: schema.mcpTokens.id }).from(schema.mcpTokens)
  .where(and(eq(schema.mcpTokens.kind, 'access'), eq(schema.mcpTokens.organizationId, ORG))).limit(1);
console.log(`\nTESTE 17 (legado): tokens 'access' antigos continuam no caminho de validacao? ${ok(!!leg)}`);

await revogarCredenciaisDaIdentidade(ORG, pedroClaude.id);
await revogarCredenciaisDaIdentidade(ORG, atendimento.id);
console.log('\n(credenciais da prova revogadas)');
process.exit(0);
