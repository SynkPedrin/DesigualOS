import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'learning' });

/**
 * Auto-aprendizado dos agentes (pedido do Endrigo, 03/09/2026):
 * "tudo que for feito e finalizado ele vai se auto aprendendo e guardando no
 * brain, de forma que ele sempre esteja atualizado — e isso para todos".
 *
 * Como funciona: todo evento CONCLUÍDO no Desigual OS vira um registro
 * durável em `memories` (tabela que já existia e estava sem uso), e é
 * empurrado para o brain do agente quando houver credencial configurada.
 *
 * Por que gravar local SEMPRE, e no brain remoto só quando dá: o brain de
 * cada agente vive numa máquina da Tailscale que pode estar fora do ar (o
 * Mac do Bento esteve offline hoje, medido). Se o aprendizado dependesse só
 * do remoto, TUDO que acontecesse durante a queda seria perdido em silêncio.
 * Local é a fonte durável; o push remoto é entrega, e o que falhar fica
 * pendente pra reenviar.
 */

export type LearningKind =
  | 'studio.asset_created'
  | 'clickup.clients_synced'
  | 'clickup.mention_answered'
  | 'client.access_granted'
  | 'execution.completed';

export interface LearningEvent {
  kind: LearningKind;
  /** Frase autocontida. Quem lê isso depois não tem o contexto de agora. */
  content: string;
  agent?: string | undefined;
  clientId?: string | null | undefined;
  userId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** `pushed` = já entregue ao brain remoto; `pending` = só local, a reenviar. */
type DeliveryState = 'pushed' | 'pending' | 'skipped';

async function resolveAgentId(agentName: string | undefined): Promise<string | null> {
  if (!agentName) return null;
  const [agent] = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.name, agentName as never));
  return agent?.id ?? null;
}

/**
 * ENTREGA NO BRAIN DO BENTO.
 *
 * A memory-api é SOMENTE LEITURA (conferido no código dela em 03/09/2026:
 * as rotas são /memory/search, /memory/context, /memory/doc e
 * /memory/reindex). O brain é alimentado por ARQUIVOS no vault, e o
 * `reindex` relê o que está em disco.
 *
 * Então a entrega tem dois passos: escrever o .md no vault (via o agente de
 * escrita configurado) e pedir reindex daquele caminho. O caminho é sempre
 * dentro de `aprendizados/desigual-os/`, uma pasta dedicada — nunca no meio
 * das notas escritas à mão pela equipe.
 *
 * Validado ponta a ponta: arquivo escrito, `POST /memory/reindex` com
 * `{scope:"paths", vault, paths}` devolveu 202, e a busca passou a
 * encontrar o conteúdo novo.
 *
 * Sem BENTO_VAULT_WRITER_URL configurado, o aprendizado fica `pending` e o
 * flushPendingLearnings() reenvia depois — nada se perde.
 */
async function pushToBentoBrain(event: LearningEvent): Promise<DeliveryState> {
  const writerUrl = process.env.BENTO_VAULT_WRITER_URL;
  const memoryUrl = process.env.BENTO_MEMORY_API_URL;
  const token = process.env.BENTO_MEMORY_API_TOKEN;
  if (!writerUrl || !memoryUrl || !token) return 'skipped';

  const vault = process.env.BENTO_VAULT_NAME ?? 'cerebro-desigual';
  const slug = `${event.kind.replace(/\./g, '-')}-${Date.now()}`;
  const path = `aprendizados/desigual-os/${slug}.md`;
  const markdown = [
    '---',
    'tipo: aprendizado',
    'origem: desigual-os',
    `evento: ${event.kind}`,
    `data: ${new Date().toISOString().slice(0, 10)}`,
    '---',
    '',
    event.content,
    '',
    '```json',
    JSON.stringify(event.metadata ?? {}, null, 2),
    '```',
  ].join('\n');

  try {
    const write = await fetch(writerUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vault, path, content: markdown }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!write.ok) return 'pending';

    const reindex = await fetch(`${memoryUrl}/memory/reindex`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'paths', vault, paths: [path], reason: `Desigual OS: ${event.kind}` }),
      signal: AbortSignal.timeout(20_000),
    });
    return reindex.ok ? 'pushed' : 'pending';
  } catch (error) {
    logger.warn({ error, kind: event.kind }, 'Não consegui entregar o aprendizado no brain; fica pendente');
    return 'pending';
  }
}

/**
 * Registra um aprendizado. NUNCA lança: aprender é efeito colateral do
 * trabalho real — se falhar, o trabalho não pode cair junto.
 */
export async function recordLearning(event: LearningEvent): Promise<void> {
  try {
    const delivery = await pushToBentoBrain(event);
    const agentId = await resolveAgentId(event.agent);

    await db.insert(schema.memories).values({
      agentId,
      clientId: event.clientId ?? null,
      userId: event.userId ?? null,
      kind: event.kind,
      content: event.content,
      metadata: { ...(event.metadata ?? {}), delivery, recorded_at: new Date().toISOString() },
    });

    logger.info({ kind: event.kind, delivery }, 'Aprendizado registrado');
  } catch (error) {
    logger.error({ error, kind: event.kind }, 'Falha ao registrar aprendizado (o trabalho em si continua)');
  }
}

/**
 * Reenvia pro brain o que ficou pendente enquanto a máquina do agente estava
 * fora. Idempotente: só marca `pushed` o que o remoto aceitou de fato.
 */
export async function flushPendingLearnings(limit = 100): Promise<{ tried: number; pushed: number }> {
  const rows = await db.select().from(schema.memories).limit(limit);
  const pending = rows.filter((row) => (row.metadata as Record<string, unknown>)?.delivery === 'pending');

  let pushed = 0;
  for (const row of pending) {
    const state = await pushToBentoBrain({
      kind: row.kind as LearningKind,
      content: row.content,
      metadata: row.metadata as Record<string, unknown>,
    });
    if (state === 'pushed') {
      await db
        .update(schema.memories)
        .set({ metadata: { ...(row.metadata as Record<string, unknown>), delivery: 'pushed' }, updatedAt: new Date() })
        .where(eq(schema.memories.id, row.id));
      pushed += 1;
    }
  }

  return { tried: pending.length, pushed };
}
