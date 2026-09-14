import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { rememberFact, type MemorySourceType } from './memory-engine';

const logger = createLogger({ service: 'learning' });

/**
 * Auto-aprendizado dos agentes (pedido do Endrigo, 03/09/2026):
 * "tudo que for feito e finalizado ele vai se auto aprendendo e guardando no
 * brain, de forma que ele sempre esteja atualizado - e isso para todos".
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
  | 'execution.completed'
  // Ciclo criativo do Otto (Fase do otto-node): plano gerado, spec despachada
  // pra fila studio-jobs e feedback humano sobre o asset produzido.
  | 'otto.creative_plan_created'
  | 'otto.studio_handoff'
  | 'otto.feedback';

export interface LearningEvent {
  kind: LearningKind;
  /** Frase autocontida. Quem lê isso depois não tem o contexto de agora. */
  content: string;
  agent?: string | undefined;
  clientId?: string | null | undefined;
  userId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  /**
   * Identidade do FATO (ex: `cliente:3net:direcao-estetica`), não do texto -
   * ver memory-engine.ts. Só quando o chamador QUER que um fato novo aposente
   * o anterior sobre o mesmo assunto (ex: "a direção estética mudou pra X").
   * Sem subject (o padrão, e o comportamento de todo chamador já existente),
   * o registro é aditivo - vira mais um item de histórico, nunca substitui
   * nada. Nunca usar subject pra eventos que devem se ACUMULAR (ex: cada
   * asset gerado, cada feedback) - isso apagaria o histórico que o
   * aprendizado de identidade visual do Otto precisa.
   */
  subject?: string | null | undefined;
  /** Default 'agent' (evidência de agente, não confirmação humana direta) -
   * ver DEFAULT_CONFIDENCE em memory-engine.ts. */
  sourceType?: MemorySourceType | undefined;
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
 * dentro de `aprendizados/desigual-os/`, uma pasta dedicada - nunca no meio
 * das notas escritas à mão pela equipe.
 *
 * Validado ponta a ponta: arquivo escrito, `POST /memory/reindex` com
 * `{scope:"paths", vault, paths}` devolveu 202, e a busca passou a
 * encontrar o conteúdo novo.
 *
 * Sem BENTO_VAULT_WRITER_URL configurado, o aprendizado fica `pending` e o
 * flushPendingLearnings() reenvia depois - nada se perde.
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
 * trabalho real - se falhar, o trabalho não pode cair junto.
 */
/**
 * Achado real (2026-09-11, "melhore o sistema de autoaprendizagem dos 4
 * agentes"): isto gravava direto em `memories` com um INSERT cru - sem
 * dedup (o mesmo fato registrado 40 vezes virava 40 linhas soltas) e sem
 * supersessão (um fato atualizado, ex: nova direção estética do cliente,
 * nunca aposentava o anterior; a leitura em build-context.ts pegava um dos
 * dois por ordenação, o que na prática é aleatório). `rememberFact`
 * (memory-engine.ts) já resolvia tudo isso - dedup por conteúdo normalizado
 * + escopo, supersessão determinística por `subject`, confiança que sobe
 * com reconfirmação de OUTRA fonte, filtro de relevância (não guarda
 * "beleza, obrigado") - só nunca tinha sido chamado de lugar nenhum, apesar
 * de testado e pronto. Passa a ser o motor de escrita real por baixo de
 * `recordLearning`, SEM mudar a assinatura pública: os 7 chamadores
 * existentes (Studio, ClickUp, Otto) e qualquer chamador novo ganham dedup/
 * supersessão de graça, sem precisar saber que isso mudou por baixo.
 */
export async function recordLearning(event: LearningEvent): Promise<void> {
  try {
    const delivery = await pushToBentoBrain(event);
    const agentId = await resolveAgentId(event.agent);
    const recordedAt = new Date().toISOString();

    const outcome = await rememberFact({
      kind: event.kind,
      content: event.content,
      subject: event.subject ?? null,
      clientId: event.clientId ?? null,
      agentId,
      userId: event.userId ?? null,
      sourceType: event.sourceType ?? 'agent',
      metadata: { ...(event.metadata ?? {}), delivery, recorded_at: recordedAt },
    });

    if (outcome.status === 'skipped') {
      logger.info({ kind: event.kind, reason: outcome.reason }, 'Aprendizado descartado (sem fato operacional novo)');
      return;
    }

    // `rememberFact` só regrava `metadata` no caminho de escrita nova - no
    // caminho de reconfirmação (fato idêntico já existia) ele só atualiza
    // confiança/timestamp, então `delivery` desta tentativa específica
    // ficaria perdido sem isto (a linha continuaria com o status de entrega
    // da vez ANTERIOR, o que quebraria flushPendingLearnings - uma entrega
    // que passou a funcionar nunca sairia de "pending", ou uma que passou a
    // falhar ficaria erradamente marcada "pushed").
    await db
      .update(schema.memories)
      .set({ metadata: sql`${schema.memories.metadata} || ${JSON.stringify({ delivery, recorded_at: recordedAt })}::jsonb` })
      .where(eq(schema.memories.id, outcome.memoryId));

    logger.info({ kind: event.kind, delivery, outcome: outcome.status }, 'Aprendizado registrado');
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
