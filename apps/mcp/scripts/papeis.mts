/**
 * papeis.mts — quem é o quê no MCP.
 *
 * O papel decide o TETO de acesso de cada funcionário (packages/mcp-domain/
 * src/scopes.ts) e é lido do banco a CADA chamada. Mudar aqui vale no turno
 * seguinte: ninguém precisa reconectar, e um rebaixamento tem efeito imediato
 * sem esperar o token de uma hora expirar.
 *
 *   listar:  pnpm --filter @desigual-os/mcp exec tsx scripts/papeis.mts
 *   definir: pnpm --filter @desigual-os/mcp exec tsx scripts/papeis.mts <email> <PAPEL>
 */
import '../src/env.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { isMcpRole, papelDaMembership, scopesDoPapel, MCP_ROLES } from '@desigual-os/mcp-domain';

const [email, papelBruto] = process.argv.slice(2);

async function listar(): Promise<void> {
  const linhas = await db
    .select({
      email: schema.users.email,
      ativo: schema.users.active,
      role: schema.organizationMembers.role,
    })
    .from(schema.users)
    .leftJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
    .where(isNull(schema.users.deletedAt));

  console.log('\nPAPÉIS NO MCP\n');
  console.log('    e-mail                                  papel efetivo      acesso');
  console.log('    ' + '-'.repeat(82));
  for (const l of linhas.sort((a, b) => a.email.localeCompare(b.email))) {
    const papel = papelDaMembership(l.role);
    const bruto = (l.role ?? '').toUpperCase();
    const nota = isMcpRole(bruto) ? '' : `  (derivado de "${l.role ?? 'sem membership'}")`;
    console.log(`  ${l.ativo ? ' ' : '✗'} ${l.email.padEnd(38)} ${papel.padEnd(17)} ${scopesDoPapel(papel).length} scope(s)${nota}`);
  }
  console.log('\n  ✗ = conta inativa: não conecta, mesmo com papel definido.\n');
  console.log('  Definir:  pnpm --filter @desigual-os/mcp exec tsx scripts/papeis.mts <email> <PAPEL>');
  console.log(`  Papéis:   ${MCP_ROLES.join(' · ')}\n`);
}

async function definir(alvoEmail: string, papel: string): Promise<void> {
  const alvo = papel.toUpperCase().replace(/[\s-]+/g, '_');
  if (!isMcpRole(alvo)) {
    console.error(`Papel desconhecido: "${papel}".\nUse um destes: ${MCP_ROLES.join(', ')}`);
    process.exit(1);
  }

  const [usuario] = await db
    .select({ id: schema.users.id, ativo: schema.users.active })
    .from(schema.users)
    .where(and(eq(schema.users.email, alvoEmail), isNull(schema.users.deletedAt)));
  if (!usuario) {
    console.error(`Não achei ninguém com o e-mail "${alvoEmail}".`);
    process.exit(1);
  }

  const [membership] = await db
    .select({ id: schema.organizationMembers.id, atual: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, usuario.id));
  if (!membership) {
    console.error(`"${alvoEmail}" não é membro de nenhuma organização. Crie a membership antes.`);
    process.exit(1);
  }

  await db
    .update(schema.organizationMembers)
    .set({ role: alvo })
    .where(eq(schema.organizationMembers.id, membership.id));

  console.log(`\n  ${alvoEmail}`);
  console.log(`  ${papelDaMembership(membership.atual)} -> ${alvo}`);
  console.log(`  scopes: ${scopesDoPapel(alvo).join(' ')}`);
  console.log('\n  Vale já no próximo turno — o papel é lido do banco a cada chamada, não do token.');
  if (!usuario.ativo) console.log('  ATENÇÃO: esta conta está INATIVA e não vai conseguir conectar.\n');
  else console.log('');
}

if (email && papelBruto) await definir(email, papelBruto);
else await listar();
process.exit(0);
