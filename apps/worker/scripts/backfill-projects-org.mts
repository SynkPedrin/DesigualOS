/**
 * backfill-projects-org.mts — preenche `organization_id` nas linhas de
 * `projects` ANTigas à migração 0054.
 *
 * A migração criou a coluna; o writer novo (POST /projects) já grava a empresa
 * de trabalho. Isto aqui resolve o passado, pelo único vínculo que a tabela
 * sempre teve:
 *
 *   CLIENTE — a linha herda a empresa do cliente (`client_id ->
 *   clients.organization_id`).
 *
 * Idempotente de propósito: só toca linha com `organization_id is null`, e
 * nunca sobrescreve um dono já gravado. Projeto SEM cliente (deck/material
 * solto da agência) fica `null` — legado da provedora, visível só no contexto
 * dela (mesma regra de memories, ver recorteDaOrganizacaoDeTrabalho em
 * apps/api/src/lib/escopo-de-organizacao.ts). Carimbar por dedução
 * (`created_by` -> empresa da pessoa) foi descartado: quem criou pode ter
 * vínculo com várias empresas, e dono errado é vazamento, não resposta.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-projects-org.mts
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

console.log('Backfill de organization_id em projects (migração 0054)\n');

const viaCliente = await rodar(
  'projects ← clients',
  sql`with atualizadas as (
        update projects p
        set organization_id = c.organization_id
        from clients c
        where p.client_id = c.id
          and p.organization_id is null
          and c.organization_id is not null
        returning 1
      ) select count(*)::int as atualizadas from atualizadas`,
);

const pendentes: unknown = await db.execute(sql`
  select
    count(*)::int as total,
    count(*) filter (where organization_id is null)::int as sem_dono,
    count(*) filter (where organization_id is null and client_id is null)::int as sem_dono_sem_cliente
  from projects
`);
const resto = (((pendentes as { rows?: unknown[] }).rows ?? (pendentes as unknown[]))[0] ?? {}) as {
  total?: number;
  sem_dono?: number;
  sem_dono_sem_cliente?: number;
};

console.log(
  `\nCONCLUÍDO — ${viaCliente} de ${resto.total ?? '?'} projeto(s) ganharam dono. ` +
    `Restam NULL (legado da provedora): ${resto.sem_dono ?? '?'}, ` +
    `destes sem cliente nenhum: ${resto.sem_dono_sem_cliente ?? '?'}.`,
);
process.exit(0);
