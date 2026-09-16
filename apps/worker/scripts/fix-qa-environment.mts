/**
 * fix-qa-environment.mts — marca os clientes de QA e reclassifica a cognição
 * que nasceu deles com o ambiente errado.
 *
 * O `environment` tinha default 'production' e os caminhos de escrita não
 * propagavam o ambiente da execução. Resultado medido em 16/09/2026: episódio,
 * memória e blackboard de cliente de TESTE gravados como produção — ou seja,
 * recuperáveis num turno real. Preferência inventada num teste vira regra de
 * marca na semana seguinte e ninguém acha a origem.
 *
 * A reclassificação só toca registro com PROVA: client_id apontando para
 * cliente de QA. Nada é apagado.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/fix-qa-environment.mts --aplicar
 */
import '../src/env.js';
import { db } from '@desigual-os/database';
import { sql } from 'drizzle-orm';

const APLICAR = process.argv.includes('--aplicar');
const listaQA = process.env.CLICKUP_TEST_LIST_ID ?? '';
const q = async (s: unknown) => {
  const r = (await db.execute(s as never)) as unknown as { rows?: Array<Record<string, unknown>> };
  return (r.rows ?? (r as unknown as Array<Record<string, unknown>>)) as Array<Record<string, unknown>>;
};

/** Cliente é QA quando aponta pra lista de QA ou tem nome de registro de teste. */
const SELECAO_QA = sql`
  select id, name from clients
  where deleted_at is null
    and (clickup_list_id = ${listaQA} or lower(name) like '%teste%' or lower(name) like '%case #0%')`;

const qa = await q(SELECAO_QA);
console.log(`clientes de QA identificados: ${qa.length}`);
for (const c of qa) console.log('  -', c.name);

const IDS_QA = sql`(select id from clients where deleted_at is null and (clickup_list_id = ${listaQA} or lower(name) like '%teste%' or lower(name) like '%case #0%'))`;

const TABELAS = ['agent_episodes', 'memories', 'agent_messages', 'execution_blackboards'] as const;

console.log('\nregistros de cognição de cliente QA marcados como production:');
const antes: Record<string, number> = {};
for (const t of TABELAS) {
  const r = await q(sql`select count(*)::int n from ${sql.raw(t)} where environment = 'production' and client_id in ${IDS_QA}`);
  antes[t] = Number(r[0]?.n ?? 0);
  console.log(`  ${t.padEnd(24)} -> ${antes[t]}`);
}

if (!APLICAR) {
  console.log('\nSIMULAÇÃO — rode com --aplicar para corrigir.');
  process.exit(0);
}

await db.execute(sql`update clients set environment = 'qa', updated_at = now() where id in ${IDS_QA}` as never);
console.log(`\nclientes marcados como environment=qa: ${qa.length}`);

let total = 0;
for (const t of TABELAS) {
  await db.execute(
    sql`update ${sql.raw(t)} set environment = 'qa', updated_at = now() where environment = 'production' and client_id in ${IDS_QA}` as never,
  );
  total += antes[t] ?? 0;
  console.log(`  ${t.padEnd(24)} reclassificado: ${antes[t]}`);
}
console.log(`\nAPLICADO — ${total} registros reclassificados para environment=qa. Nenhum apagado.`);
process.exit(0);
