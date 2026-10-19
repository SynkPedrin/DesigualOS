/**
 * backfill-cost-org.mts — preenche `organization_id` nas linhas de custo
 * ANTigas à migração 0049 (`token_usage` e `cost_records`).
 *
 * A migração criou a coluna; os writers novos (recordTokenUsage em
 * execute-job.ts, recordCostEvent em cost-service.ts) já gravam o dono. Isto
 * aqui resolve o passado, pela mesma escada dos writers:
 *
 *   1. EXECUTION — a linha herda a empresa da execution que a gerou;
 *   2. CLIENTE  — o que a execution não cobriu herda da empresa do cliente
 *      (só existe em cost_records; token_usage não tem client_id).
 *
 * Idempotente de propósito: só toca linha com `organization_id is null`, e
 * nunca sobrescreve um dono já gravado. Linha sem vínculo nenhum (execution
 * órfã, sem cliente) fica `null` — é uma resposta honesta, não um palpite
 * (mesmo critério de organizacaoDaEscrita em packages/auth).
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-cost-org.mts
 */
import '../src/env.js';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';

async function rodar(rotulo: string, comando: ReturnType<typeof sql>): Promise<number> {
  const bruto: unknown = await db.execute(comando);
  const linhas = (bruto as { rows?: unknown[] }).rows ?? (bruto as unknown[]);
  const n = Number((linhas[0] as { atualizadas?: number | string } | undefined)?.atualizadas ?? 0);
  console.log(`  ${rotulo}: ${n} linha(s) atualizada(s)`);
  return n;
}

console.log('Backfill de organization_id em custos (migração 0049)\n');

const tokenUsageViaExecution = await rodar(
  'token_usage ← executions',
  sql`with atualizadas as (
        update token_usage tu
        set organization_id = e.organization_id
        from executions e
        where tu.execution_id = e.id
          and tu.organization_id is null
          and e.organization_id is not null
        returning 1
      ) select count(*)::int as atualizadas from atualizadas`,
);

const costRecordsViaExecution = await rodar(
  'cost_records ← executions',
  sql`with atualizadas as (
        update cost_records cr
        set organization_id = e.organization_id
        from executions e
        where cr.execution_id = e.id
          and cr.organization_id is null
          and e.organization_id is not null
        returning 1
      ) select count(*)::int as atualizadas from atualizadas`,
);

const costRecordsViaCliente = await rodar(
  'cost_records ← clients (fallback)',
  sql`with atualizadas as (
        update cost_records cr
        set organization_id = c.organization_id
        from clients c
        where cr.client_id = c.id
          and cr.organization_id is null
          and c.organization_id is not null
        returning 1
      ) select count(*)::int as atualizadas from atualizadas`,
);

const pendentes: unknown = await db.execute(sql`
  select
    (select count(*)::int from token_usage where organization_id is null) as token_usage_sem_dono,
    (select count(*)::int from cost_records where organization_id is null) as cost_records_sem_dono
`);
const resto = (((pendentes as { rows?: unknown[] }).rows ?? (pendentes as unknown[]))[0] ?? {}) as {
  token_usage_sem_dono?: number;
  cost_records_sem_dono?: number;
};

console.log(
  `\nCONCLUÍDO — ${tokenUsageViaExecution + costRecordsViaExecution + costRecordsViaCliente} linha(s) ganharam dono. ` +
    `Restam sem vínculo nenhum (execution órfã e sem cliente): ` +
    `token_usage=${resto.token_usage_sem_dono ?? '?'}, cost_records=${resto.cost_records_sem_dono ?? '?'}.`,
);
process.exit(0);
