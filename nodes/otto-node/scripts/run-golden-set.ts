/**
 * Runner do mini golden set (Otto Senior 20Y, Missão 22) — SÓ deve ser
 * executado depois que o caso real Cosentino passar o gate (>=90, script/
 * copy/executability >=9). NÃO é chamado automaticamente por nada; é uma
 * ferramenta de dev pra rodar as 5 fixtures representativas ao vivo contra
 * Ollama, uma de cada vez (latência observada: 200-430s por turno nesta
 * máquina — não rodar em paralelo, o Ollama local é single-model/single-slot).
 *
 * Uso: npx tsx scripts/run-golden-set.ts [id1,id2,...]
 * Sem argumento: roda o mini-set fixo (5 casos, Missão 22).
 * Resultados salvos em scripts/.golden-results/<id>.json (git-ignorado).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CREATIVE_GOLDEN_SET, type CreativeGoldenBrief } from '../../../packages/otto/test-fixtures/creative-golden-set.js';
import { loadConfig } from '../src/config.js';
import { createDefaultDeps, executeTask } from '../src/execute.js';

const MINI_SET_IDS = [
  'reel-launch-imobiliario',
  'carrossel-venda',
  'meta-ad-direct-response',
  'briefing-designer',
  'rewrite-feedback-generico',
];

const requestedIds = process.argv[2]?.split(',') ?? MINI_SET_IDS;
const briefs = requestedIds.map((id) => {
  const brief = CREATIVE_GOLDEN_SET.find((b) => b.id === id);
  if (!brief) throw new Error(`brief não encontrado no golden set: ${id}`);
  return brief;
});

function buildMessage(brief: CreativeGoldenBrief): string {
  const base = brief.previousArtifact
    ? `${brief.message}\n\n(peça anterior entregue: "${brief.previousArtifact.deliverable}")`
    : brief.message;
  return `${base}\n\n---\nContexto:\n${brief.clientContext}`;
}

process.env.NODE_SECRET = process.env.NODE_SECRET ?? 'golden-set-local-only';
process.env.OTTO_MODEL = process.env.OTTO_MODEL ?? 'qwen3.5:4b';
process.env.OTTO_OLLAMA_URL = process.env.OTTO_OLLAMA_URL ?? 'http://localhost:11434';
process.env.OTTO_BRAIN_PATH = process.env.OTTO_BRAIN_PATH ?? new URL('../../../Brain-Marketing', import.meta.url).pathname;

const config = loadConfig();
const deps = createDefaultDeps(config);
const outDir = new URL('.golden-results/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const results: Array<{ id: string; category: string; elapsedMs: number; status: string }> = [];

for (const brief of briefs) {
  const message = buildMessage(brief);
  console.log(`\n=== ${brief.id} (${brief.category}) — iniciando ===`);
  const startedAt = Date.now();
  let response: unknown;
  try {
    response = await executeTask(
      { execution_id: `golden-${brief.id}-${Date.now()}`, message, context_refs: [], client_feedback_history: [], attachments: [] },
      config,
      deps,
      { info: () => {}, warn: (...a: unknown[]) => console.error('[warn]', ...a), error: (...a: unknown[]) => console.error('[error]', ...a) } as never,
    );
  } catch (error) {
    response = { status: 'threw', error: error instanceof Error ? error.message : String(error) };
  }
  const elapsedMs = Date.now() - startedAt;
  const status = (response as { status?: string })?.status ?? 'unknown';
  results.push({ id: brief.id, category: brief.category, elapsedMs, status });
  writeFileSync(new URL(`${brief.id}.json`, outDir), JSON.stringify({ brief, elapsedMs, response }, null, 2), 'utf-8');
  console.log(`=== ${brief.id}: ${status} em ${Math.round(elapsedMs / 1000)}s ===`);
}

console.log('\n=== RESUMO ===');
console.table(results);
