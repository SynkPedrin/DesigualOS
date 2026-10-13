/**
 * backfill-entity-links.mts — semeia o entity graph com o que já existia solto.
 *
 * A ponte ClickUp <-> Desigual era `users.clickup_email` (texto, sem verificação).
 * Este script casa o diretório REAL do workspace (GET /team/:teamId, via
 * tool-gateway) com `users.clickup_email` e grava o vínculo forte em
 * `entity_links` (person, clickup, member.id) — um por organização da qual a
 * pessoa é membro. Depois dele, o webhook resolve autor por link (O(1)) e o
 * e-mail volta a ser só o caminho de descoberta.
 *
 * Idempotente: unique (organization_id, source, entity_type, external_id) +
 * onConflictDoNothing. Rodar duas vezes não duplica.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-entity-links.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-entity-links.mts --aplicar
 */
import '../src/env.js';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema, vincularEntidade } from '@desigual-os/database';
import { getTeamMembers } from '@desigual-os/tool-gateway';

const APLICAR = process.argv.includes('--aplicar');
const apiKey = process.env.CLICKUP_API_KEY ?? '';
const teamId = process.env.CLICKUP_TEAM_ID ?? '';
if (!apiKey || !teamId) {
  console.error('CLICKUP_API_KEY/CLICKUP_TEAM_ID ausentes.');
  process.exit(1);
}

console.log('Lendo o diretório do ClickUp...');
const members = await getTeamMembers({ apiKey, teamId });
console.log(`  ${members.length} membros no workspace`);

const usuarios = await db
  .select({ id: schema.users.id, name: schema.users.name, clickupEmail: schema.users.clickupEmail })
  .from(schema.users)
  .where(and(isNotNull(schema.users.clickupEmail), isNull(schema.users.deletedAt), eq(schema.users.active, true)));

const porEmail = new Map(usuarios.map((u) => [u.clickupEmail!.toLowerCase(), u]));

const memberships = await db
  .select({ id: schema.organizationMembers.id, organizationId: schema.organizationMembers.organizationId, userId: schema.organizationMembers.userId })
  .from(schema.organizationMembers);
const orgsDoUsuario = new Map<string, string[]>();
for (const m of memberships) {
  const atual = orgsDoUsuario.get(m.userId) ?? [];
  atual.push(m.organizationId);
  orgsDoUsuario.set(m.userId, atual);
}

let criados = 0;
let existentes = 0;
let falhas = 0;
let semMatch = 0;
let semOrg = 0;

for (const member of members) {
  const usuario = porEmail.get(member.email.toLowerCase());
  if (!usuario) {
    semMatch += 1;
    console.log(`  sem-match: ${member.username} <${member.email}> não tem users.clickup_email correspondente`);
    continue;
  }
  const orgs = orgsDoUsuario.get(usuario.id) ?? [];
  if (orgs.length === 0) {
    semOrg += 1;
    console.log(`  sem-org: ${usuario.name} casa por e-mail mas não é membro de organização nenhuma`);
    continue;
  }
  for (const organizationId of orgs) {
    if (!APLICAR) {
      console.log(`  [simulação] ${usuario.name} -> clickup user ${member.id} (org ${organizationId})`);
      criados += 1;
      continue;
    }
    try {
      const r = await vincularEntidade({
        organizationId,
        entityType: 'person',
        desigualId: usuario.id,
        source: 'clickup',
        externalId: String(member.id),
        metadata: { resolved_by: 'backfill', email: member.email, username: member.username },
      });
      if (r.status === 'created') criados += 1;
      else existentes += 1;
    } catch (error) {
      falhas += 1;
      console.error(`  falha: ${usuario.name} (org ${organizationId}): ${(error as Error).message}`);
    }
  }
}

console.log(
  `\n${APLICAR ? 'APLICADO' : 'SIMULAÇÃO'} — ${criados} vínculos ${APLICAR ? 'criados' : 'a criar'}, ${existentes} já existentes, ` +
    `${falhas} falhas, ${semMatch} membros do ClickUp sem usuário correspondente, ${semOrg} usuários sem organização`,
);
if (!APLICAR) console.log('Rode com --aplicar para gravar.');
process.exit(0);
