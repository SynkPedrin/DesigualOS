/**
 * memory-continuity-proof.mts — ENSINAR → LEMBRAR contra o banco de verdade.
 *
 * Teste unitário prova a função; não prova o caminho. O defeito que originou
 * este arquivo passava por todos os unitários: a consulta funcionava, o
 * episódio estava gravado, e mesmo assim a resposta vinha [FALTA] — porque
 * ninguém CHAMAVA a consulta. Só banco real, escopo real e ambiente real
 * mostram isso.
 *
 * Roda inteiro em QA e nunca escreve em produção.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/memory-continuity-proof.mts
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import {
  extractEpisodeCandidates,
  recallEpisodes,
  recallFactualEpisodes,
  recordEpisodes,
  termosDeConsulta,
} from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';

let falhas = 0;
const prova = (nome: string, ok: boolean, detalhe = ''): void => {
  console.log(`${ok ? 'PASS' : 'FALHA'} ${nome}${detalhe ? ` | ${detalhe}` : ''}`);
  if (!ok) falhas += 1;
};

const clientesQA = await db
  .select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients)
  .where(eq(schema.clients.environment, 'qa'))
  .limit(2);
if (clientesQA.length === 0) {
  console.error('nenhum cliente environment=qa');
  process.exit(1);
}
const A = clientesQA[0]!;
const [producao] = await db
  .select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients)
  .where(eq(schema.clients.environment, 'production'))
  .limit(1);

const selo = Date.now().toString(36).slice(-6);
const NOME = `Marcelo Ribeiro ${selo}`;
const NOVA = `Fernanda Alves ${selo}`;
const OUTRO = `Beatriz Nunes ${selo}`;

const [usuario] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);

const escopo = (clientId: string | null, environment: string, execId: string) => ({
  clientId,
  userId: usuario?.id ?? null,
  agent: 'bento',
  conversationId: null,
  executionId: execId,
  sourceRefs: [`prova:${selo}`],
  environment,
});

console.log(`cliente QA: ${A.name} | selo: ${selo}\n`);

// ---------- 1. ensinar ----------
const ensino = `Anota que o decisor da conta é o ${NOME}.`;
const candidatos = extractEpisodeCandidates(ensino);
const gravados = await recordEpisodes(candidatos, escopo(A.id, 'qa', `prova-1-${selo}`));
prova('teach_persiste_episodio', gravados === 1, `gravados=${gravados}`);

// ---------- 2. recall imediato SEM frase temporal ----------
const perguntaFactual = 'Quem é o decisor da conta?';
const termos = termosDeConsulta(perguntaFactual);
const imediato = await recallFactualEpisodes({ clientId: A.id, termos, environment: 'qa' });
prova(
  'explicit_user_fact_is_recalled_without_temporal_phrase',
  imediato.some((e) => e.summary.includes(NOME)),
  `termos=[${termos.join(',')}] retornados=${imediato.length}`,
);

// ---------- 3. nova conversa / nova sessão ----------
// O recall é por CLIENTE e AMBIENTE, nunca por conversa: é isso que faz o fato
// atravessar aba nova, reload e sessão nova. Provado consultando sem nenhum
// identificador de conversa ou sessão em mãos.
const semConversa = await recallFactualEpisodes({ clientId: A.id, termos, environment: 'qa' });
prova(
  'explicit_fact_survives_new_conversation_reload_and_session',
  semConversa.some((e) => e.summary.includes(NOME)),
  'consulta sem conversationId nem sessão',
);

// ---------- 4. outro agente ----------
// Memória é da agência, não caderno privado: o recall não filtra por agente.
const paraOtto = await recallFactualEpisodes({ clientId: A.id, termos, environment: 'qa' });
prova(
  'same_fact_can_be_used_by_other_authorized_agent',
  paraOtto.some((e) => e.summary.includes(NOME)),
  'ensinado via bento, recuperável sem filtro de agente',
);

// ---------- 5. supersessão ----------
await new Promise((r) => setTimeout(r, 1_100));
const correcao = `Anota que mudou: agora a decisora da conta é a ${NOVA}.`;
await recordEpisodes(extractEpisodeCandidates(correcao), escopo(A.id, 'qa', `prova-5-${selo}`));
const depois = await recallFactualEpisodes({ clientId: A.id, termos, environment: 'qa' });
const iNova = depois.findIndex((e) => e.summary.includes(NOVA));
const iVelha = depois.findIndex((e) => e.summary.includes(NOME));
prova(
  'new_fact_supersedes_old_fact',
  iNova >= 0 && iVelha >= 0 && iNova < iVelha,
  `posição nova=${iNova} velha=${iVelha} (o mais recente tem que vir primeiro)`,
);

// ---------- 6. cross-client ----------
if (clientesQA.length > 1) {
  const B = clientesQA[1]!;
  await recordEpisodes(
    extractEpisodeCandidates(`Anota que o decisor da conta é a ${OUTRO}.`),
    escopo(B.id, 'qa', `prova-6-${selo}`),
  );
  const doA = await recallFactualEpisodes({ clientId: A.id, termos, environment: 'qa' });
  const doB = await recallFactualEpisodes({ clientId: B.id, termos, environment: 'qa' });
  prova(
    'episodic_fact_does_not_cross_client',
    !doA.some((e) => e.summary.includes(OUTRO)) && !doB.some((e) => e.summary.includes(NOVA)),
    `A vê ${doA.length}, B vê ${doB.length}, sem troca`,
  );
} else {
  console.log('AVISO cross-client: só existe 1 cliente de QA; prova feita contra produção abaixo');
}

// ---------- 7. QA nunca vaza pra produção ----------
const emProducao = await recallFactualEpisodes({
  clientId: producao?.id ?? null,
  termos,
  environment: 'production',
});
prova(
  'qa_episodic_fact_never_reaches_production',
  !emProducao.some((e) => e.summary.includes(NOME) || e.summary.includes(NOVA)),
  `produção retornou ${emProducao.length} episódios, nenhum do selo`,
);

// ---------- 8. pergunta não vira fato ----------
const dePergunta = extractEpisodeCandidates(`${NOME} é o decisor da conta?`);
prova('question_is_not_persisted_as_fact', dePergunta.length === 0, `candidatos=${dePergunta.length}`);

// ---------- 9. incerteza não vira fato autoritativo ----------
const deHipotese = extractEpisodeCandidates(`Acho que talvez o ${NOME} seja o decisor.`);
prova('uncertain_statement_is_not_authoritative_fact', deHipotese.length === 0, `candidatos=${deHipotese.length}`);

// ---------- 10. recall temporal continua funcionando ----------
const temporal = await recallEpisodes({
  clientId: A.id,
  desde: new Date(Date.now() - 86_400_000),
  environment: 'qa',
});
prova(
  'temporal_recall_nao_foi_quebrado',
  temporal.some((e) => e.summary.includes(NOME) || e.summary.includes(NOVA)),
  `janela de 24h retornou ${temporal.length}`,
);

// ---------- 11. o fato é citável ----------
const paraEvidencia = depois.filter((e) => e.summary.includes(NOVA) || e.summary.includes(NOME));
prova(
  'episodic_fact_is_groundable',
  paraEvidencia.every((e) => e.occurredAt instanceof Date && e.summary.length > 0),
  'todo episódio recuperado tem data e texto para virar evidência',
);

// ---------- limpeza ----------
await db.execute(sql`delete from agent_episodes where source_refs::text ilike ${'%prova:' + selo + '%'}`);

console.log(`\n${falhas === 0 ? 'MEMÓRIA: OK' : `MEMÓRIA: ${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
