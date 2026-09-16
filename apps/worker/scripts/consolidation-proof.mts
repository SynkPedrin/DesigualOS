/**
 * consolidation-proof.mts — prova o loop episódio -> regra do cliente.
 *
 * Não basta contar: três feedbacks quaisquer não são uma preferência. A prova
 * exige que episódios do MESMO assunto, em dias distintos, virem uma regra com
 * proveniência, e que um assunto diferente NÃO seja arrastado junto.
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { eq, sql } from 'drizzle-orm';
import { createLogger } from '@desigual-os/logging';
import { recallMemories } from '@desigual-os/orchestrator';
import { runKnowledgeConsolidation } from '../src/scheduler/knowledge-consolidation.js';

const logger = createLogger({ service: 'qa' });
const [QA] = await db.select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients).where(eq(schema.clients.environment, 'qa')).limit(1);
if (!QA) { console.error('nenhum cliente de QA'); process.exit(1); }

const MARCA = `CONSOL-${Date.now()}`;
let falhas = 0;
const checa = (n: string, ok: boolean, d = '') => { console.log(ok ? `PASS  ${n}` : `FALHA ${n} ${d}`); if (!ok) falhas++; };
const dia = 86_400_000;

// Três pedidos do MESMO assunto (legenda), em três dias distintos.
const recorrentes = [
  { d: 3, t: `${MARCA} para esse cliente quero as legendas mais diretas` },
  { d: 2, t: `${MARCA} evita introdução longa nas legendas desse cliente` },
  { d: 1, t: `${MARCA} continua mantendo as legendas mais objetivas` },
];
// Um assunto diferente, isolado: NÃO pode virar regra.
const isolado = { d: 1, t: `${MARCA} a paleta dessa peça ficou escura demais` };

for (const e of [...recorrentes, isolado]) {
  await db.insert(schema.agentEpisodes).values({
    occurredAt: new Date(Date.now() - e.d * dia),
    clientId: QA.id, eventType: 'preference', summary: e.t,
    environment: 'qa', importance: '0.900',
    dedupeKey: `${MARCA}-${e.t.slice(-20)}`,
  }).onConflictDoNothing();
}
console.log(`episódios plantados: ${recorrentes.length} recorrentes (3 dias) + 1 isolado\n`);

await runKnowledgeConsolidation(logger);

const regras = await recallMemories({ clientId: QA.id, kinds: ['client.preference'], environment: 'qa' });
const daLegenda = regras.filter((m) => m.content.includes(MARCA) && /legenda/i.test(m.content));
const daPaleta = regras.filter((m) => m.content.includes(MARCA) && /paleta/i.test(m.content));

checa('episodios_recorrentes_viram_regra', daLegenda.length === 1, `encontradas=${daLegenda.length}`);
checa('regra_usa_a_formulacao_mais_recente', daLegenda[0]?.content.includes('objetivas') === true, daLegenda[0]?.content ?? '');
checa('assunto_isolado_NAO_vira_regra', daPaleta.length === 0, `encontradas=${daPaleta.length}`);

const meta = (daLegenda[0]?.metadata ?? {}) as Record<string, unknown>;
checa('regra_carrega_proveniencia', Array.isArray(meta.source_refs) && (meta.source_refs as unknown[]).length >= 3, JSON.stringify(meta.source_refs ?? null));
checa('regra_registra_dias_distintos', Number(meta.dias_distintos ?? 0) >= 2, String(meta.dias_distintos));

// READ-BACK: a regra tem que estar recuperável como qualquer outra.
const relido = await recallMemories({ clientId: QA.id, kinds: ['client.preference'], environment: 'qa' });
checa('read_back_da_regra', relido.some((m) => m.content.includes(MARCA) && /objetivas/i.test(m.content)));

// E não pode vazar para produção.
const emProd = await recallMemories({ clientId: QA.id, kinds: ['client.preference'], environment: 'production' });
checa('regra_de_qa_nao_vaza_para_producao', !emProd.some((m) => m.content.includes(MARCA)));

await db.delete(schema.agentEpisodes).where(sql`summary like ${'%' + MARCA + '%'}`).catch(() => undefined);
await db.delete(schema.memories).where(sql`content like ${'%' + MARCA + '%'}`).catch(() => undefined);

console.log(falhas === 0 ? '\nCONSOLIDAÇÃO: OK' : `\nCONSOLIDAÇÃO: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
