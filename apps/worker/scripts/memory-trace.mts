/**
 * memory-trace.mts — rastrear ENSINAR → LEMBRAR sem alterar nada.
 *
 * O caso: ensinar "o decisor é X", perguntar "quem é o decisor?" minutos
 * depois, e receber [FALTA]. O episódio ESTÁ no banco — então a escrita
 * funciona e o que falha é a recuperação. Este script existe para dizer em qual
 * etapa exata o fato deixa de existir, antes de qualquer correção: patch feito
 * sobre suposição conserta o sintoma e deixa a causa.
 *
 * Roda inteiro em QA. A pergunta é feita duas vezes de propósito: uma sem
 * marcador temporal (o caso quebrado) e uma com ("o que conversamos"), porque a
 * diferença entre as duas é a evidência que separa as hipóteses.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/memory-trace.mts
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { extractEpisodeCandidates, janelaDoTexto, recallEpisodes } from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';

const MARCA = `Marcelo Ribeiro QA ${Date.now().toString(36).slice(-5)}`;
const ENSINO = `Anota que o decisor da Colpar QA é ${MARCA}.`;
const PERGUNTA_FACTUAL = 'Quem é o decisor da Colpar QA?';
const PERGUNTA_TEMPORAL = 'O que conversamos sobre o decisor da Colpar QA?';

const [qa] = await db
  .select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients)
  .where(eq(schema.clients.environment, 'qa'))
  .limit(1);
if (!qa) {
  console.error('nenhum cliente marcado como environment=qa');
  process.exit(1);
}
const [usuario] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);

console.log(`cliente QA: ${qa.name} (${qa.id})`);
console.log(`marca única: ${MARCA}\n`);

// ---------- ETAPA 1: extração de candidatos ----------
const candidatos = extractEpisodeCandidates(ENSINO);
console.log('== 1. EXTRAÇÃO DE CANDIDATOS ==');
console.log(`candidatos: ${candidatos.length}`);
for (const c of candidatos) console.log(`  eventType=${c.eventType} importance=${c.importance} summary=${c.summary}`);
if (candidatos.length === 0) {
  console.log('>>> SOME AQUI: a frase de ensino não virou candidato a episódio.');
  process.exit(0);
}

// ---------- ETAPA 2: persistência ----------
const { recordEpisodes } = await import('@desigual-os/orchestrator');
const gravados = await recordEpisodes(candidatos, {
  clientId: qa.id,
  userId: usuario?.id ?? null,
  agent: 'bento',
  conversationId: null,
  executionId: `trace-${Date.now()}`,
  sourceRefs: ['memory-trace'],
  environment: 'qa',
});
console.log(`\n== 2. PERSISTÊNCIA ==\ngravados: ${gravados}`);

const linhas = (await db.execute(sql`
  select id, environment, user_id, client_id, campaign_id, event_type, summary,
         facts, source_refs, occurred_at, importance, dedupe_key, agent
  from agent_episodes where summary ilike ${'%' + MARCA + '%'}
  order by occurred_at desc limit 3`)) as unknown as Array<Record<string, unknown>>;
console.log(`linhas no banco: ${linhas.length}`);
for (const l of linhas) {
  console.log(`  id=${l.id}`);
  console.log(`  environment=${l.environment} | agent=${l.agent} | event_type=${l.event_type}`);
  console.log(`  user=${l.user_id} | client=${l.client_id} | campaign=${l.campaign_id}`);
  console.log(`  occurred_at=${l.occurred_at} | importance=${l.importance}`);
  console.log(`  dedupe_key=${l.dedupe_key}`);
  console.log(`  source_refs=${JSON.stringify(l.source_refs)}`);
  console.log(`  facts=${JSON.stringify(l.facts)}`);
  console.log(`  summary=${l.summary}`);
}
if (linhas.length === 0) {
  console.log('>>> SOME AQUI: episódio não persistiu.');
  process.exit(0);
}

// ---------- ETAPA 3: decisão de recall ----------
console.log('\n== 3. DECISÃO DE RECALL (janelaDoTexto) ==');
const janelaFactual = janelaDoTexto(PERGUNTA_FACTUAL);
const janelaTemporal = janelaDoTexto(PERGUNTA_TEMPORAL);
console.log(`pergunta factual  "${PERGUNTA_FACTUAL}"`);
console.log(`  janela: ${janelaFactual ? janelaFactual.rotulo : 'NULL — recallEpisodes NÃO é chamado'}`);
console.log(`pergunta temporal "${PERGUNTA_TEMPORAL}"`);
console.log(`  janela: ${janelaTemporal ? janelaTemporal.rotulo : 'NULL'}`);

// ---------- ETAPA 4: a consulta, quando chamada ----------
console.log('\n== 4. CONSULTA (forçada, para separar "gate" de "query") ==');
const desde = new Date(Date.now() - 7 * 86_400_000);
const recuperados = await recallEpisodes({
  userId: usuario?.id ?? null,
  clientId: qa.id,
  desde,
  environment: 'qa',
});
const achou = recuperados.filter((e) => e.summary.includes(MARCA));
console.log(`episódios retornados na janela de 7 dias: ${recuperados.length}`);
console.log(`contendo a marca: ${achou.length}`);
for (const e of achou) console.log(`  [${e.occurredAt.toISOString()}] (${e.eventType}) ${e.summary}`);

// ---------- VEREDITO ----------
console.log('\n== VEREDITO ==');
if (achou.length > 0 && !janelaFactual) {
  console.log('A CONSULTA ACHA. O GATE É QUE NÃO DEIXA CONSULTAR.');
  console.log('Primeira etapa onde o fato some: DECISÃO DE RECALL (janelaDoTexto == null');
  console.log('para pergunta factual sem marcador temporal, em agentic-dispatch.ts).');
} else if (achou.length === 0) {
  console.log('A CONSULTA NÃO ACHA mesmo com janela ampla — o problema é query/scope, não gate.');
} else {
  console.log('Gate abriu e consulta achou: investigar ranking/ContextPack/evidência.');
}
process.exit(0);
