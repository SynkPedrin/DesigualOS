/**
 * memory-proof.mts — prova, contra o banco REAL, o ciclo de memória da V3.
 *
 * Teste unitário com mock não serve: os defeitos desta camada foram todos de
 * integração — cast de coluna que derrubava a query, default de ambiente
 * vencendo o caminho da aplicação, supersessão que existia no código mas nunca
 * tinha sido exercitada de ponta a ponta.
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { and, eq, sql } from 'drizzle-orm';
import { recallEpisodes, recallMemories, recordEpisodes, rememberFact } from '@desigual-os/orchestrator';

const [QA] = await db.select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients).where(eq(schema.clients.environment, 'qa')).limit(1);
if (!QA) { console.error('nenhum cliente de QA'); process.exit(1); }

const MARCA = `PROVA-${Date.now()}`;
let falhas = 0;
const checa = (n: string, ok: boolean, detalhe = '') => { console.log(ok ? `PASS  ${n}` : `FALHA ${n} ${detalhe}`); if (!ok) falhas++; };

// ---------- SUPERSESSÃO ----------
// Duas preferências contraditórias sobre o MESMO aspecto não podem coexistir
// ativas: o agente escolheria em silêncio e ninguém saberia qual venceu.
const aspecto = `tom-${MARCA}`;
await rememberFact({
  kind: 'client.preference', clientId: QA.id, content: `${MARCA} usar comunicação descontraída`,
  subject: `cliente:${QA.id}:${aspecto}`, sourceType: 'chat_message', confidence: 0.9, importance: 0.9, environment: 'qa',
});
await rememberFact({
  kind: 'client.preference', clientId: QA.id, content: `${MARCA} daqui pra frente usar comunicação institucional`,
  subject: `cliente:${QA.id}:${aspecto}`, sourceType: 'chat_message', confidence: 0.95, importance: 0.95, environment: 'qa',
});

const ativas = await recallMemories({ clientId: QA.id, kinds: ['client.preference'], environment: 'qa' });
const doTeste = ativas.filter((m) => m.content.includes(MARCA));
checa('new_explicit_preference_supersedes_old_preference', doTeste.length === 1, `ativas=${doTeste.length}`);
checa('a_preferencia_ativa_e_a_NOVA', doTeste[0]?.content.includes('institucional') === true, doTeste[0]?.content ?? '');

const aposentadas: any = await db.execute(
  sql`select count(*)::int n from memories where content like ${'%' + MARCA + '%'} and status = 'superseded' and superseded_by is not null`,
);
checa('old_fact_is_marked_historical', Number(((aposentadas.rows ?? aposentadas) as any[])[0]?.n ?? 0) === 1);

// ---------- EPISÓDIO -> RECALL TEMPORAL ----------
await recordEpisodes(
  [{ eventType: 'decision', summary: `${MARCA} a campanha vai priorizar legado, sem preço como argumento`, importance: 0.95 }],
  { clientId: QA.id, environment: 'qa', sourceRefs: ['qa:prova'] },
);
const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
const recall = await recallEpisodes({ clientId: QA.id, desde: hoje, environment: 'qa' });
checa('episodic_memory_supports_temporal_query', recall.some((e) => e.summary.includes(MARCA)));
checa('episodio_carrega_source_refs', recall.find((e) => e.summary.includes(MARCA))?.sourceRefs.includes('qa:prova') === true);

// ---------- ISOLAMENTO ENTRE CLIENTES ----------
const [OUTRO] = await db.select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients).where(and(eq(schema.clients.environment, 'qa'), sql`${schema.clients.id} <> ${QA.id}`)).limit(1);
if (OUTRO) {
  const doOutro = await recallEpisodes({ clientId: OUTRO.id, desde: hoje, environment: 'qa' });
  checa('memoria_nao_cruza_cliente', !doOutro.some((e) => e.summary.includes(MARCA)));
} else {
  console.log('SKIP  memoria_nao_cruza_cliente (só um cliente de QA)');
}

// limpeza
await db.delete(schema.agentEpisodes).where(sql`summary like ${'%' + MARCA + '%'}`).catch(() => undefined);
await db.delete(schema.memories).where(sql`content like ${'%' + MARCA + '%'}`).catch(() => undefined);

console.log(falhas === 0 ? '\nMEMÓRIA: OK' : `\nMEMÓRIA: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
