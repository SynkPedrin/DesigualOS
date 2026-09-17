/**
 * provenance-trace.mts — onde a fonte da resposta ANTERIOR se perde.
 *
 * O caso: o turno 1 responde certo, citando que o fato veio da conversa. O
 * turno 2 pergunta "de onde você tirou isso?" e a resposta atribui ao ClickUp.
 * Não é o agente mentindo: a proveniência é montada com as fontes do turno
 * ATUAL, e "isso" se refere ao turno anterior — que ninguém guardou.
 *
 * Este script reproduz os três turnos na MESMA conversa e despeja o que cada
 * um deixou gravado, para provar em qual etapa a informação some antes de
 * qualquer correção.
 *
 *   pnpm --filter @desigual-os/api exec tsx src/scripts/provenance-trace.mts
 */
import '../env.js';
import { db, schema } from '@desigual-os/database';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';
import { formatOperationalContextForPrompt, resolveOperationalTurn } from '../lib/operational-context.js';

/**
 * CLIENTE DE QA, obrigatoriamente. A primeira versão deste arquivo apontava
 * para a Colpar real e ensinou "o decisor é Marcelo Ribeiro" em produção,
 * invertendo a verdade corrente do cliente. Trace não escreve no sistema que
 * investiga.
 */
const [clienteQA] = await db
  .select({ id: schema.clients.id, name: schema.clients.name })
  .from(schema.clients)
  .where(eq(schema.clients.environment, 'qa'))
  .limit(1);
if (!clienteQA) {
  console.error('nenhum cliente com environment=qa; este trace NÃO roda em produção');
  process.exit(1);
}
const COLPAR = clienteQA.id;

const [usuario] = await db
  .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);
if (!usuario) {
  console.error('usuário não encontrado');
  process.exit(1);
}

const conversas = (await db.execute(sql`
  insert into conversations (client_id, user_id, title, status)
  values (${COLPAR}::uuid, ${usuario.id}::uuid, 'trace provenance', 'open')
  returning id`)) as unknown as Array<{ id: string }>;
const conversaId = conversas[0]!.id;
console.log(`conversation_id: ${conversaId}\n`);

async function turno(fala: string): Promise<void> {
  const t0 = performance.now();
  const op = await resolveOperationalTurn(fala, usuario as never);
  const bloco = op.briefingBlock ?? formatOperationalContextForPrompt(op.context);
  const r = await dispatchChatMessage({
    message: fala,
    userId: usuario!.id,
    clientId: COLPAR,
    conversationId: conversaId,
    decision: {
      intent: 'trace de proveniência',
      primary_agent: 'bento',
      required_tools: [],
      context: [],
      estimated_complexity: 'medium',
      workflow: null,
      confidence: 1,
      source: 'manual',
    },
    ...(bloco ? { operationalContext: bloco } : {}),
  });

  let status = '';
  for (;;) {
    const l = (await db
      .execute(sql`select status from executions where execution_id = ${r.executionId}`)
      .catch(() => [] as unknown[])) as unknown as Array<{ status: string }>;
    status = l[0]?.status ?? status;
    if (status === 'completed' || status === 'failed') break;
    if (performance.now() - t0 > 300_000) { status = 'estourou'; break; }
    await new Promise((x) => setTimeout(x, 2_000));
  }

  let msg: { content: string; metadata: Record<string, unknown> } | undefined;
  for (let i = 0; i < 12 && !msg; i++) {
    if (i > 0) await new Promise((x) => setTimeout(x, 700));
    const m = (await db
      .execute(sql`
        select content, metadata from messages
        where conversation_id = ${conversaId}::uuid and role = 'assistant'
        order by created_at desc limit 1`)
      .catch(() => [] as unknown[])) as unknown as Array<{ content: string; metadata: Record<string, unknown> }>;
    msg = m[0];
  }

  console.log(`=== "${fala}" (${Math.round((performance.now() - t0) / 1000)}s, ${status})`);
  console.log(`execution_id: ${r.executionId}`);
  console.log(`escopo: ${op.scope.kind} | bloco operacional: ${bloco ? bloco.length + ' chars' : 'nenhum'}`);
  console.log(`resposta: ${(msg?.content ?? '(sem mensagem)').slice(0, 280)}`);
  console.log(`metadata gravada na MENSAGEM: ${JSON.stringify(msg?.metadata ?? {})}`);
  console.log('');
}

await turno('Anota que o decisor da Colpar é Marcelo Ribeiro.');
await turno('Quem é o decisor da Colpar?');
await turno('De onde você tirou isso?');

console.log('--- o que o turno 2 deixou pro turno 3 usar ---');
const todas = (await db.execute(sql`
  select role, left(content, 90) as texto, metadata
  from messages where conversation_id = ${conversaId}::uuid order by created_at asc`)) as unknown as Array<
  Record<string, unknown>
>;
for (const m of todas) {
  const meta = JSON.stringify(m.metadata ?? {});
  console.log(`${String(m.role).padEnd(9)} | meta=${meta.length > 2 ? meta.slice(0, 120) : 'VAZIA'} | ${m.texto}`);
}
process.exit(0);
