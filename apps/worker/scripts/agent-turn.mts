/**
 * agent-turn.mts — dispara um turno REAL de agente pelo mesmo caminho do chat.
 *
 * Existe porque provar o gateway com `curl` no Ollama não prova nada sobre o
 * sistema: o que interessa é o turno inteiro — router, contexto, ferramentas,
 * inferência, aterramento — atravessando o controle de admissão junto com todo
 * mundo. É esse caminho que a Tammy usa.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/agent-turn.mts <agente> "<pergunta>" [clienteId]
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';

const agente = (process.argv[2] ?? 'bento') as 'bento' | 'otto';
const pergunta = process.argv[3] ?? 'Responda apenas: ok';
const clienteId = process.argv[4] ?? null;

const [usuario] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);

if (!usuario) {
  console.error('usuário não encontrado');
  process.exit(1);
}

/**
 * Conversa criada AQUI, e não deixada a cargo do dispatch. Duas execuções
 * simultâneas disputando "a conversa mais nova do usuário" liam a resposta uma
 * da outra — a medição precisa ser determinística ou não vale como prova.
 */
const conversas = (await db.execute(sql`
  insert into conversations (client_id, user_id, title, status)
  values (${clienteId}::uuid, ${usuario.id}::uuid, ${'bateria: ' + agente}, 'open')
  returning id`)) as unknown as Array<{ id: string }>;
const conversaId = conversas[0]?.id ?? null;
if (!conversaId) { console.error('não criei a conversa'); process.exit(1); }

const t0 = performance.now();
const resultado = await dispatchChatMessage({
  message: pergunta,
  userId: usuario.id,
  clientId: clienteId,
  conversationId: conversaId,
  decision: {
    intent: 'bateria de infraestrutura',
    primary_agent: agente,
    required_tools: [],
    context: [],
    estimated_complexity: 'medium',
    workflow: null,
    confidence: 1,
    source: 'manual',
  },
});

const execucaoId = (resultado as { executionId?: string }).executionId ?? null;
console.log(`[${agente}] enfileirado execution=${execucaoId ?? '?'}`);

if (!execucaoId) {
  console.log(JSON.stringify(resultado).slice(0, 400));
  process.exit(1);
}

/** Espera o worker terminar. Teto alto porque turno real de agente é longo. */
const TETO_MS = 300_000;
let ultimo = '';
for (;;) {
  const linhas = (await db.execute(sql`
    select id, status from executions where execution_id = ${execucaoId}`)) as unknown as Array<{
    id: string;
    status: string;
  }>;
  const l = linhas[0];
  if (l?.status && l.status !== ultimo) {
    ultimo = l.status;
    console.log(`  status=${l.status} (${Math.round((performance.now() - t0) / 1000)}s)`);
  }
  if (l && (l.status === 'completed' || l.status === 'failed')) {
    /**
     * Pela CONVERSA desta execução, não pela última linha da tabela. Ler a
     * mensagem mais recente sem filtro fez duas execuções simultâneas
     * reportarem o mesmo texto — e por um instante pareceu defeito dos
     * agentes, quando era defeito da medição.
     */
    /**
     * Espera curta antes de ler: o worker marca a execução como concluída e
     * grava a mensagem logo depois. Ler no mesmo instante devolvia "(sem
     * mensagem)" para o agente mais rápido — e isso parecia falha do agente.
     */
    let msgs: Array<{ content: string }> = [];
    for (let tentativa = 0; tentativa < 10 && msgs.length === 0; tentativa++) {
      if (tentativa > 0) await new Promise((r) => setTimeout(r, 500));
      msgs = (await db.execute(sql`
      select m.content from messages m
      where m.conversation_id = ${conversaId}::uuid and m.role = 'assistant'
        order by m.created_at desc limit 1`)) as unknown as Array<{ content: string }>;
    }
    const texto = msgs[0]?.content ?? '(sem mensagem)';
    console.log(`\n--- ${agente.toUpperCase()} (${Math.round((performance.now() - t0) / 1000)}s, ${l.status}) ---`);
    console.log(texto.slice(0, 1400));
    process.exit(l.status === 'completed' ? 0 : 1);
  }
  if (performance.now() - t0 > TETO_MS) {
    console.log(`\nESTOUROU ${TETO_MS / 1000}s sem concluir (status=${ultimo})`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
