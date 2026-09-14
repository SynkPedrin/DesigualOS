import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { rememberFact } from '@desigual-os/orchestrator';
import {
  applyFeedbackToLearning,
  type OttoLearningPersistedState,
  type OttoLearningStage,
  type OttoFeedbackVerdict,
} from '@desigual-os/otto';

const logger = createLogger({ service: 'otto-learnings' });

/**
 * Ponte entre o feedback humano do Studio (POST /studio/assets/:id/feedback)
 * e o pipeline de confiança do Otto (packages/otto/src/learning/pipeline.ts).
 *
 * Até 11/09/2026 o pipeline estava completo e testado, mas sem NENHUM call
 * site: o feedback virava só uma memória aditiva `otto.feedback`, e o funil
 * observation -> experimental -> validated -> trusted -> core nunca rodava.
 * Aqui cada feedback vira uma EVIDÊNCIA num aprendizado persistente (as
 * regras de mapeamento verdict->kind/origem estão em
 * packages/otto/src/learning/feedback.ts, puras e testadas).
 *
 * Persistência: o pipeline é puro (sem DB), então o estado do aprendizado
 * (stage, confidence, evidences) vai em `memories.metadata.otto_learning`,
 * com `subject` determinístico por motivo — o mesmo motivo ("cliente rejeita
 * gradiente") acumula evidências na MESMA linha em vez de abrir uma por
 * feedback. A coluna `confidence` e a `importance` da memória acompanham o
 * funil, então recallMemories já ordena regra trusted acima de observação,
 * e o worker injeta as regras validated+ no histórico que deriveCreativeDNA
 * consome (apps/worker/src/processors/execute-job.ts).
 */

/** Importância por estágio: faz recallMemories devolver regra core/trusted
 * antes de observação solta quando o orçamento de contexto aperta. */
const STAGE_IMPORTANCE: Record<OttoLearningStage, number> = {
  observation: 0.5,
  experimental: 0.6,
  validated: 0.75,
  trusted: 0.85,
  core: 0.95,
};

export interface RecordOttoFeedbackLearningResult {
  stage: OttoLearningStage;
  promoted: boolean;
  memoryId: string | null;
}

/**
 * Registra o feedback no funil e persiste. NUNCA lança: aprendizado é
 * efeito colateral do feedback — se falhar, o feedback em si já foi gravado
 * e não pode cair junto.
 */
export async function recordOttoFeedbackLearning(params: {
  clientId: string;
  userId: string;
  assetId: string;
  verdict: OttoFeedbackVerdict;
  reason?: string | undefined;
  isDirector: boolean;
}): Promise<RecordOttoFeedbackLearningResult | null> {
  try {
    // Probe descartável só pra resolver kind/subject antes da query (o
    // applyFeedbackToLearning real roda depois, com o estado persistido).
    const probe = applyFeedbackToLearning(null, params, params.clientId);

    const [existing] = await db
      .select({
        id: schema.memories.id,
        content: schema.memories.content,
        metadata: schema.memories.metadata,
      })
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.kind, probe.kind),
          eq(schema.memories.clientId, params.clientId),
          eq(schema.memories.status, 'active'),
          sql`${schema.memories.metadata}->>'subject' = ${probe.subject}`,
        ),
      )
      .orderBy(desc(schema.memories.updatedAt))
      .limit(1);

    const persistedState = (existing?.metadata as { otto_learning?: OttoLearningPersistedState } | null)
      ?.otto_learning;
    const transition = applyFeedbackToLearning(
      existing && persistedState ? { content: existing.content, state: persistedState } : null,
      params,
      params.clientId,
    );
    const { learning } = transition;
    const state: OttoLearningPersistedState = {
      stage: learning.stage,
      confidence: learning.confidence,
      evidences: learning.evidences,
    };

    let memoryId: string | null = null;
    if (existing) {
      // Atualização IN PLACE: o aprendizado é um só por subject; criar linha
      // nova a cada feedback abriria duplicatas que o recall leria como
      // aprendizados distintos.
      await db
        .update(schema.memories)
        .set({
          metadata: sql`${schema.memories.metadata} || ${JSON.stringify({ otto_learning: state, last_asset_id: params.assetId })}::jsonb`,
          confidence: learning.confidence.toFixed(3),
          importance: STAGE_IMPORTANCE[learning.stage].toFixed(3),
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.memories.id, existing.id));
      memoryId = existing.id;
    } else {
      const outcome = await rememberFact({
        kind: learning.kind,
        content: learning.content,
        subject: transition.subject,
        clientId: params.clientId,
        userId: params.userId,
        // Evidência humana direta: a confiança default de 'manual' (0.95)
        // seria alta demais pra uma observação nova, então passamos a
        // confiança calculada pelo funil explicitamente.
        sourceType: 'manual',
        confidence: learning.confidence,
        importance: STAGE_IMPORTANCE[learning.stage],
        metadata: { otto_learning: state, asset_id: params.assetId },
      });
      memoryId = outcome.status === 'skipped' ? null : outcome.memoryId;
    }

    if (transition.promoted) {
      logger.info(
        { clientId: params.clientId, kind: learning.kind, stage: learning.stage, subject: transition.subject },
        'Aprendizado do Otto promovido de estágio',
      );
    }

    return { stage: learning.stage, promoted: transition.promoted, memoryId };
  } catch (error) {
    logger.error({ error, clientId: params.clientId }, 'Falha ao alimentar o funil de aprendizado do Otto (feedback segue gravado)');
    return null;
  }
}
