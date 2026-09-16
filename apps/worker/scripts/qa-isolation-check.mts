/**
 * qa-isolation-check.mts — prova, contra o banco REAL, que QA não vaza.
 *
 * Teste unitário com mock não serve aqui: o defeito era exatamente o default
 * silencioso do banco vencendo o caminho da aplicação. A prova precisa ser
 * feita onde o dado mora.
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { and, eq, sql } from 'drizzle-orm';
import { recallEpisodes, recordEpisodes, rememberFact, recallMemories } from '@desigual-os/orchestrator';

const QA_CLIENT = (await db.select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients).where(eq(schema.clients.environment, 'qa')).limit(1))[0];
if (!QA_CLIENT) { console.error('nenhum cliente de QA marcado'); process.exit(1); }

const MARCA = `ISOLAMENTO-${Date.now()}`;
let falhas = 0;
const checa = (nome: string, ok: boolean) => { console.log(ok ? `PASS  ${nome}` : `FALHA ${nome}`); if (!ok) falhas++; };

// 1. episódio de QA
await recordEpisodes(
  [{ eventType: 'decision', summary: `${MARCA} decisao de teste`, importance: 0.9 }],
  { clientId: QA_CLIENT.id, environment: 'qa', sourceRefs: ['qa:isolation'] },
);
const emQA = await recallEpisodes({ clientId: QA_CLIENT.id, desde: new Date(Date.now() - 3_600_000), environment: 'qa' });
const emProd = await recallEpisodes({ clientId: QA_CLIENT.id, desde: new Date(Date.now() - 3_600_000), environment: 'production' });
checa('qa_episode_visivel_em_qa', emQA.some((e) => e.summary.includes(MARCA)));
checa('qa_episode_never_recalled_in_production', !emProd.some((e) => e.summary.includes(MARCA)));

// 2. memória de QA
await rememberFact({
  kind: 'client.preference', clientId: QA_CLIENT.id, content: `${MARCA} preferencia de teste`,
  subject: `qa:${MARCA}`, sourceType: 'manual', confidence: 0.9, importance: 0.9, environment: 'qa',
});
const memQA = await recallMemories({ clientId: QA_CLIENT.id, kinds: ['client.preference'], environment: 'qa' });
const memProd = await recallMemories({ clientId: QA_CLIENT.id, kinds: ['client.preference'], environment: 'production' });
checa('qa_memory_visivel_em_qa', memQA.some((m) => m.content.includes(MARCA)));
checa('qa_memory_never_recalled_in_production', !memProd.some((m) => m.content.includes(MARCA)));

// 3. nenhum registro de cliente QA sobrou como production
for (const t of ['agent_episodes', 'memories', 'execution_blackboards'] as const) {
  const r: any = await db.execute(
    sql`select count(*)::int n from ${sql.raw(t)} where environment = 'production' and client_id in (select id from clients where environment = 'qa')`,
  );
  const n = Number(((r.rows ?? r) as any[])[0]?.n ?? 0);
  checa(`production_knowledge_never_written_by_qa:${t}`, n === 0);
}

// limpeza do que este check criou
await db.delete(schema.agentEpisodes).where(sql`${schema.agentEpisodes.summary} like ${'%' + MARCA + '%'}`).catch(() => undefined);
await db.delete(schema.memories).where(sql`${schema.memories.content} like ${'%' + MARCA + '%'}`).catch(() => undefined);

console.log(falhas === 0 ? '\nISOLAMENTO QA: OK' : `\nISOLAMENTO QA: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
