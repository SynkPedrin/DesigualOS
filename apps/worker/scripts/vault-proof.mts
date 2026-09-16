/**
 * vault-proof.mts — prova o pipeline inteiro: conversa -> episódio -> regra
 * semântica -> vault -> read-back -> recuperação futura.
 *
 * Contra o banco e o disco REAIS: os defeitos desta camada são de integração.
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { eq, sql } from 'drizzle-orm';
import { readFile, rm } from 'node:fs/promises';
import { createLogger } from '@desigual-os/logging';
import { caminhoDoVault, recallMemories } from '@desigual-os/orchestrator';
import { runKnowledgeConsolidation } from '../src/scheduler/knowledge-consolidation.js';

const logger = createLogger({ service: 'qa' });
const RAIZ = process.env.VAULT_CLIENTES_PATH ?? './vault-clientes';
const [QA] = await db.select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
  .from(schema.clients).where(eq(schema.clients.environment, 'qa')).limit(1);
if (!QA) { console.error('nenhum cliente de QA'); process.exit(1); }

const slug = (QA.slug ?? QA.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const destinoQA = { raiz: RAIZ, clienteSlug: slug, environment: 'qa', secao: 'Preferências consolidadas' };
const destinoProd = { ...destinoQA, environment: 'production' };

const MARCA = `VAULT-${Date.now()}`;
let falhas = 0;
const checa = (n: string, ok: boolean, d = '') => { console.log(ok ? `PASS  ${n}` : `FALHA ${n} ${d}`); if (!ok) falhas++; };
const dia = 86_400_000;

// Recorrência real: mesmo assunto (legenda), três dias distintos.
for (const e of [
  { d: 3, t: `${MARCA} quero as legendas desse cliente mais diretas` },
  { d: 2, t: `${MARCA} evita introdução longa nas legendas` },
  { d: 1, t: `${MARCA} mantém sempre as legendas objetivas` },
]) {
  await db.insert(schema.agentEpisodes).values({
    occurredAt: new Date(Date.now() - e.d * dia), clientId: QA.id, eventType: 'preference',
    summary: e.t, environment: 'qa', importance: '0.900', dedupeKey: `${MARCA}-${e.d}`,
  }).onConflictDoNothing();
}

await runKnowledgeConsolidation(logger);

// 1. virou memória semântica
const regras = (await recallMemories({ clientId: QA.id, kinds: ['client.preference'], environment: 'qa' }))
  .filter((m) => m.content.includes(MARCA));
checa('episode_para_semantic_memory', regras.length === 1, `n=${regras.length}`);

// 2. escreveu no vault de QA
const caminhoQA = caminhoDoVault(destinoQA);
const textoQA = await readFile(caminhoQA, 'utf8').catch(() => '');
checa('vault_recebeu_a_regra', textoQA.includes(MARCA), caminhoQA);
checa('vault_tem_secao_deterministica', textoQA.includes('## Preferências consolidadas'));
checa('vault_carrega_proveniencia', /episode:/.test(textoQA));

// 3. NÃO escreveu no vault de produção
const textoProd = await readFile(caminhoDoVault(destinoProd), 'utf8').catch(() => '');
checa('vault_qa_nao_vaza_para_producao', !textoProd.includes(MARCA));

// 4. idempotência: rodar de novo não duplica
await runKnowledgeConsolidation(logger);
const depois = await readFile(caminhoQA, 'utf8').catch(() => '');
const ocorrencias = (depois.match(new RegExp(MARCA, 'g')) ?? []).length;
checa('vault_idempotente', ocorrencias === 1, `ocorrências=${ocorrencias}`);

// 5. read-back: o que está no disco é o que foi gravado
checa('vault_read_back', depois.includes('objetivas'));

// limpeza
await db.delete(schema.agentEpisodes).where(sql`summary like ${'%' + MARCA + '%'}`).catch(() => undefined);
await db.delete(schema.memories).where(sql`content like ${'%' + MARCA + '%'}`).catch(() => undefined);
await rm(caminhoQA, { force: true }).catch(() => undefined);

console.log(falhas === 0 ? '\nVAULT: OK' : `\nVAULT: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
