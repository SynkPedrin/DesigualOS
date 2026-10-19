/**
 * reclassificar-aceite.mts — marca como TESTE o que o aceite gravou como
 * produção, SEM apagar nada.
 *
 * Medido em 30/09/2026: 5 episódios e 14 memórias em `environment='production'`
 * carregando carimbo de aceite ("marco-029857", "ACEITE-1790723321445"). Eles
 * apareciam na tela de Decisões como decisão da agência e contavam no acervo
 * institucional.
 *
 * POR QUE RECLASSIFICAR E NÃO APAGAR, como o release pediu: o histórico do
 * aceite é auditável e tem valor — é a prova de que aquele teste rodou. O que
 * ele não pode é contar como conhecimento da operação. Mudando o ambiente, a
 * linha some de toda consulta institucional (todas filtram production) e
 * continua lá pra quem for auditar.
 *
 * A PREVENÇÃO é outra e já está feita: `resolveEnvironment` passou a considerar
 * quem pergunta, não só o cliente (ver apps/worker/src/processors/environment.ts).
 * Este script cuida do que já está no banco; sem a prevenção, ele precisaria
 * rodar pra sempre.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/reclassificar-aceite.mts            # simula
 *   pnpm --filter @desigual-os/worker exec tsx scripts/reclassificar-aceite.mts --aplicar  # grava
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import { pareceArtefatoDeTeste } from '@desigual-os/context-engine';

const aplicar = process.argv.includes('--aplicar');

const memorias = await db
  .select({ id: schema.memories.id, content: schema.memories.content, env: schema.memories.environment })
  .from(schema.memories)
  .where(eq(schema.memories.environment, 'production'));
const memAlvo = memorias.filter((m) => pareceArtefatoDeTeste(m.content));

const episodios = await db
  .select({ id: schema.agentEpisodes.id, summary: schema.agentEpisodes.summary })
  .from(schema.agentEpisodes)
  .where(eq(schema.agentEpisodes.environment, 'production'));
const epAlvo = episodios.filter((e) => pareceArtefatoDeTeste(e.summary));

console.log(`memórias em produção com carimbo de aceite: ${memAlvo.length}`);
for (const m of memAlvo.slice(0, 5)) console.log('  ·', m.content.replace(/\s+/g, ' ').slice(0, 88));
console.log(`episódios em produção com carimbo de aceite: ${epAlvo.length}`);
for (const e of epAlvo.slice(0, 5)) console.log('  ·', e.summary.replace(/\s+/g, ' ').slice(0, 88));

if (!aplicar) {
  console.log('\nSIMULAÇÃO. Nada foi alterado. Use --aplicar pra gravar.');
  process.exit(0);
}

let m = 0;
for (const alvo of memAlvo) {
  await db.update(schema.memories).set({ environment: 'qa' }).where(eq(schema.memories.id, alvo.id));
  m++;
}
let e = 0;
for (const alvo of epAlvo) {
  await db.update(schema.agentEpisodes).set({ environment: 'qa' }).where(eq(schema.agentEpisodes.id, alvo.id));
  e++;
}
console.log(`\nreclassificados: ${m} memória(s) e ${e} episódio(s) para environment='qa'. Nada apagado.`);
process.exit(0);
