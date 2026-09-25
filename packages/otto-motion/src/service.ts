import { randomUUID } from 'node:crypto';
import type { Logger } from '@desigual-os/logging';
import { ottoMotionEnabled } from './flag.js';
import { resolveBriefFormat, type CampaignBrief } from './brief/schema.js';
import { extractLockedFacts } from './brief/locked-facts.js';
import { MotionError } from './errors.js';
import { MOTION_MODEL_ID } from './model.js';
import { checkClaudeConnection } from './providers/connection.js';
import { enqueueMotionJob } from './queue.js';
import * as store from './store/sessions.js';
import { createWorkspace, writeJson } from './workspace/workspace.js';
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_FPS,
  DEFAULT_MOTION_FORMAT,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  type CreateMotionInput,
  type MotionSession,
  type MotionStatusView,
  type UpdateMotionInput,
} from './types.js';

/**
 * §14 — a superfície que o Otto enxerga.
 *
 * Nenhuma destas funções menciona Remotion, webpack, frame ou codec, e é
 * deliberado: o Otto é diretor criativo, e o dia em que ele precisar saber o
 * que é um bundle é o dia em que essa fronteira vazou.
 */

function assertEnabled(): void {
  if (!ottoMotionEnabled()) {
    throw new MotionError('MOTION_DISABLED', 'O Motion Engine está desligado neste ambiente.', {
      detail: 'OTTO_MOTION_ENABLED != true',
    });
  }
}

/**
 * §5 fail closed, cobrado ANTES de abrir a sessão.
 *
 * Checar aqui (e não no meio do pipeline) é o que evita o pior desfecho:
 * a pessoa vê "criando seu motion", espera dois minutos e só então descobre
 * que o modelo obrigatório nunca esteve disponível.
 */
async function assertProviderReady(): Promise<void> {
  const connection = await checkClaudeConnection();
  if (connection.state !== 'CONNECTED') {
    throw new MotionError(
      connection.state === 'OPUS_UNAVAILABLE' ? 'OPUS_UNAVAILABLE' : 'PROVIDER_DISCONNECTED',
      `${connection.message}${connection.remedy ? ` ${connection.remedy}` : ''}`,
      {
        actions: [{ label: 'Reconectar Claude', action: 'reconnect_claude' }],
        detail: JSON.stringify(connection.details),
      },
    );
  }
}

function clampDuration(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DURATION_SECONDS;
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(value)));
}

export async function createMotion(input: CreateMotionInput, logger: Logger): Promise<MotionSession> {
  assertEnabled();
  await assertProviderReady();

  // Modo AD_HOC (adendo chat-first, regra nova): clientId agora é opcional
  // aqui de propósito. A DECISÃO de exigir cliente ou seguir sem ele é do
  // CALLER (motion-guard.ts), que já sabe se o pedido trouxe anexo/direção
  // suficiente — createMotion só executa o que foi decidido, não impõe
  // outra regra por trás.

  // Um id só para a sessão e para o diretório do job: é o que garante que
  // `workspaceFor(session.id)` no pipeline abre o workspace que acabou de ser
  // criado, e não um vizinho vazio.
  const motionId = randomUUID();
  // O briefing manda no formato: ele é a decisão mais explícita e mais
  // recente da pessoa sobre a peça (§6).
  const brief: CampaignBrief | null = input.brief ?? null;
  const resolvido = resolveBriefFormat(brief, {
    format: input.format,
    durationSeconds: input.durationSeconds,
    fps: input.fps,
  });
  const lockedFacts = extractLockedFacts(brief);

  const workspace = await createWorkspace(motionId);
  const session = await store.createSession({
    id: motionId,
    clientId: input.clientId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    requestedBy: input.requestedBy,
    workspacePath: workspace.root,
    prompt: input.prompt,
    durationSeconds: clampDuration(resolvido.duration),
    fps: resolvido.fps,
    format: resolvido.aspectRatio,
    model: MOTION_MODEL_ID,
    metadata: {
      references: input.references ?? [],
      execution_id: input.executionId,
      brief,
      // Gravados junto porque o QA (§16) precisa comparar o que foi
      // entregue com o que foi PEDIDO, e o briefing pode ser editado depois.
      locked_facts: lockedFacts,
    },
  });

  await writeJson(workspace.requestFile, { ...input, motionId: session.id });
  await writeJson(workspace.metadataFile, {
    motionId: session.id,
    clientId: session.clientId,
    model: MOTION_MODEL_ID,
    createdAt: session.createdAt.toISOString(),
  });

  await enqueueMotionJob({ motionId: session.id, mode: 'create', executionId: input.executionId });
  logger.info({ motionId: session.id, clientId: session.clientId }, 'Motion: sessão criada e enfileirada');
  return session;
}

/** §17/§43 — edita o projeto existente. Nunca recria. */
export async function updateMotion(input: UpdateMotionInput, logger: Logger): Promise<MotionSession> {
  assertEnabled();
  await assertProviderReady();

  const session = await store.requireSession(input.motionId);
  if (input.references?.length) {
    await store.mergeMetadata(session.id, { references: input.references });
  }
  await store.updateStatus(session.id, 'queued', { stageDetail: null, error: null, errorCode: null });
  await enqueueMotionJob({
    motionId: session.id,
    mode: 'update',
    instruction: input.instruction,
    executionId: input.executionId,
  });
  logger.info({ motionId: session.id }, 'Motion: ajuste enfileirado');
  return session;
}

/**
 * §14 — re-render da versão atual.
 *
 * Não chama o Opus: o projeto já está escrito e o pedido é "gera o arquivo de
 * novo". Por isso também NÃO passa pelo assertProviderReady — sem agente, não
 * há modelo pra estar disponível, e barrar aqui impediria alguém de baixar o
 * próprio trabalho só porque o Claude caiu.
 */
export async function renderMotionAgain(motionId: string, logger: Logger): Promise<MotionSession> {
  assertEnabled();
  const session = await store.requireSession(motionId);
  await store.updateStatus(session.id, 'queued', { stageDetail: null, error: null, errorCode: null });
  await enqueueMotionJob({ motionId: session.id, mode: 'render' });
  logger.info({ motionId }, 'Motion: re-render enfileirado (sem agente)');
  return session;
}

export async function getMotionStatus(motionId: string): Promise<MotionStatusView | null> {
  return store.statusView(motionId);
}

export async function findConversationMotion(conversationId: string): Promise<MotionSession | null> {
  return store.findActiveSessionForConversation(conversationId);
}
