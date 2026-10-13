/**
 * backfill-memory-embeddings.mts — gera os vetores das memórias ATIVAS que
 * ainda não têm linha em `memory_embeddings`: tudo que existia antes da
 * busca semântica, mais o que falhou na geração fire-and-forget da escrita
 * (a ausência da linha É o estado "pendente" — ver memory-embeddings.ts).
 *
 * Um lote por chamada ao módulo; este wrapper repete até não haver pendente.
 * Aborta se um lote inteiro falhar (provável credencial/API de embeddings
 * fora) em vez de girar lotes à toa.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-memory-embeddings.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/backfill-memory-embeddings.mts --environment qa --lote 50
 */
import '../src/env.js';
import { backfillMemoryEmbeddings } from '@desigual-os/orchestrator';

const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const ENVIRONMENT = argValue('--environment');
const LOTE = Number(argValue('--lote') ?? 100);
const MAX_LOTES = Number(argValue('--max-lotes') ?? 100);

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error('OPENAI_API_KEY não configurada — sem ela nenhum vetor é gerado.');
  process.exit(1);
}

console.log(
  `Backfill de memory_embeddings${ENVIRONMENT ? ` (environment=${ENVIRONMENT})` : ''} — lotes de ${LOTE}, teto de ${MAX_LOTES} lotes.\n`,
);

let candidatas = 0;
let gravadas = 0;
for (let lote = 1; lote <= MAX_LOTES; lote++) {
  const r = await backfillMemoryEmbeddings({ batchSize: LOTE, environment: ENVIRONMENT });
  if (r.candidatas === 0) break;
  candidatas += r.candidatas;
  gravadas += r.gravadas;
  console.log(`  lote ${lote}: ${r.gravadas}/${r.candidatas} vetores gravados`);
  if (r.gravadas === 0) {
    console.error('\nLote inteiro sem gravação — provável falha na API de embeddings. Abortando; rerode depois.');
    process.exit(1);
  }
}

console.log(`\nCONCLUÍDO — ${gravadas} vetores gravados para ${candidatas} memórias pendentes.`);
process.exit(0);
