/**
 * intelligence-census.mts — censo de leitura pura: o que o Desigual OS
 * REALMENTE tem gravado sobre a agência. Nenhuma escrita.
 */
import '../src/env.js';
import { db } from '@desigual-os/database';
import { sql } from 'drizzle-orm';

async function q(label: string, statement: string) {
  try {
    const r: any = await db.execute(sql.raw(statement));
    const rows = r.rows ?? r;
    console.log(`\n### ${label}`);
    console.table ? console.log(JSON.stringify(rows, null, 1).slice(0, 4000)) : console.log(rows);
  } catch (e) {
    console.log(`\n### ${label}\n  ERRO: ${(e as Error).message}`);
  }
}

console.log('=== TABELAS E VOLUME ===');
await q('linhas por tabela (top 40)', `
  select relname as tabela, n_live_tup as linhas
  from pg_stat_user_tables where schemaname='public'
  order by n_live_tup desc limit 40`);

await q('clickup_tasks: volume e frescor', `
  select count(*) as linhas, max(updated_at) as ultima_atualizacao from clickup_tasks`);

await q('clickup_spaces / lists / workspaces', `
  select 'workspaces' t, count(*) n from clickup_workspaces
  union all select 'spaces', count(*) from clickup_spaces
  union all select 'lists', count(*) from clickup_lists`);

await q('memories por kind', `
  select kind, status, count(*) n from memories group by 1,2 order by n desc limit 30`);

await q('agent_episodes por agente', `
  select agent_name, count(*) n, max(created_at) ultimo from agent_episodes group by 1 order by n desc limit 20`);

await q('operational events (se existir)', `
  select event_type, count(*) n, max(created_at) ultimo from operational_events group by 1 order by n desc limit 20`);

await q('people: tipo de vinculo', `
  select employment_type, active_status, count(*) n from people group by 1,2 order by n desc`);

await q('person_client_relations por tipo', `
  select relation_type, count(*) n from person_client_relations group by 1 order by n desc`);

await q('messages: volume por agente', `
  select metadata->>'agent' as agente, count(*) n, max(created_at) ultimo
  from messages group by 1 order by n desc limit 15`);

await q('conversas e turnos', `
  select count(distinct conversation_id) conversas, count(*) mensagens from messages`);

await q('client_knowledge_sync por fonte/status', `
  select source, status, count(*) n, max(last_sync_at) ultimo from client_knowledge_sync group by 1,2 order by n desc`);

process.exit(0);
