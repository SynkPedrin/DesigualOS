import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  MOTION_FORMATS,
  TERMINAL_MOTION_STATUSES,
  UI_STAGE,
  type MotionAssetsSummary,
  type MotionFormat,
  type MotionFps,
  type MotionQuality,
  type MotionQualityScore,
  type MotionRenderVersion,
  type MotionSession,
  type MotionStatus,
  type MotionStatusView,
} from '../types.js';
import { MotionError } from '../errors.js';

type SessionRow = typeof schema.motionSessions.$inferSelect;

function toSession(row: SessionRow): MotionSession {
  return {
    id: row.id,
    clientId: row.clientId,
    conversationId: row.conversationId,
    projectId: row.projectId,
    requestedBy: row.requestedBy,
    workspacePath: row.workspacePath,
    status: row.status as MotionStatus,
    stageDetail: row.stageDetail,
    prompt: row.prompt,
    durationSeconds: row.durationSeconds,
    fps: row.fps as MotionFps,
    width: row.width,
    height: row.height,
    format: row.format as MotionFormat,
    model: row.model,
    renderVersion: row.renderVersion,
    error: row.error,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createSession(input: {
  /**
   * Id gerado por quem chama, não pelo banco.
   *
   * O diretório do job é `motion_<id>` e o pipeline o localiza por
   * `workspaceFor(motionId)`. Deixar o Postgres sortear o id fazia o
   * workspace nascer com um uuid e ser procurado por outro: o request.json e
   * o metadata.json ficavam num diretório órfão, e `workspace_path` no banco
   * apontava pra um lugar que ninguém mais abria.
   */
  id: string;
  /** `null` no modo AD_HOC. */
  clientId: string | null;
  conversationId: string | null;
  projectId: string | null;
  requestedBy: string | null;
  workspacePath: string;
  prompt: string;
  durationSeconds: number;
  fps: MotionFps;
  format: MotionFormat;
  model: string;
  metadata?: Record<string, unknown>;
}): Promise<MotionSession> {
  const preset = MOTION_FORMATS[input.format];
  const [row] = await db
    .insert(schema.motionSessions)
    .values({
      id: input.id,
      clientId: input.clientId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      requestedBy: input.requestedBy,
      workspacePath: input.workspacePath,
      status: 'queued',
      prompt: input.prompt,
      durationSeconds: input.durationSeconds,
      fps: input.fps,
      width: preset.width,
      height: preset.height,
      format: input.format,
      model: input.model,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!row) throw new MotionError('INTERNAL', 'Não consegui abrir o projeto do motion.', { detail: 'insert sem retorno' });
  return toSession(row);
}

export async function getSession(motionId: string): Promise<MotionSession | null> {
  const [row] = await db.select().from(schema.motionSessions).where(eq(schema.motionSessions.id, motionId)).limit(1);
  return row ? toSession(row) : null;
}

export async function requireSession(motionId: string): Promise<MotionSession> {
  const session = await getSession(motionId);
  if (!session) {
    throw new MotionError('SESSION_NOT_FOUND', 'Não achei esse motion. Ele pode ter sido removido.', {
      detail: `motion_session ${motionId} inexistente`,
    });
  }
  return session;
}

/**
 * §17/§18 — a sessão ATIVA de uma conversa.
 *
 * "Ativa" inclui a que acabou de terminar: "ficou muito parado" vem DEPOIS do
 * motion pronto, e restringir a sessões em andamento faria exatamente o
 * pedido de ajuste mais comum não achar nada. Ordena pela mais recente.
 */
export async function findActiveSessionForConversation(conversationId: string): Promise<MotionSession | null> {
  const [row] = await db
    .select()
    .from(schema.motionSessions)
    .where(
      and(
        eq(schema.motionSessions.conversationId, conversationId),
        inArray(schema.motionSessions.status, ['queued', 'resolving_context', 'preparing_assets', 'planning', 'coding', 'building', 'rendering_preview', 'reviewing', 'fixing', 'rendering_final', 'completed']),
      ),
    )
    .orderBy(desc(schema.motionSessions.updatedAt))
    .limit(1);
  return row ? toSession(row) : null;
}

export async function updateStatus(
  motionId: string,
  status: MotionStatus,
  options: { stageDetail?: string | null; error?: string | null; errorCode?: string | null } = {},
): Promise<void> {
  await db
    .update(schema.motionSessions)
    .set({
      status,
      stageDetail: options.stageDetail ?? null,
      ...(options.error !== undefined ? { error: options.error } : {}),
      ...(options.errorCode !== undefined ? { errorCode: options.errorCode } : {}),
    })
    .where(eq(schema.motionSessions.id, motionId));
}

export async function mergeMetadata(motionId: string, patch: Record<string, unknown>): Promise<void> {
  // Merge no banco (|| do jsonb) em vez de read-modify-write: dois estágios
  // gravando metadata perto um do outro se sobrescreveriam.
  await db
    .update(schema.motionSessions)
    .set({ metadata: sql`${schema.motionSessions.metadata} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(schema.motionSessions.id, motionId));
}

export async function getMetadata(motionId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ metadata: schema.motionSessions.metadata })
    .from(schema.motionSessions)
    .where(eq(schema.motionSessions.id, motionId))
    .limit(1);
  return row?.metadata ?? {};
}

/** §41 — nova versão nunca sobrescreve a anterior. */
export async function nextRenderVersion(motionId: string): Promise<number> {
  const [row] = await db
    .update(schema.motionSessions)
    .set({ renderVersion: sql`${schema.motionSessions.renderVersion} + 1` })
    .where(eq(schema.motionSessions.id, motionId))
    .returning({ renderVersion: schema.motionSessions.renderVersion });
  return row?.renderVersion ?? 1;
}

export async function recordRender(input: {
  motionSessionId: string;
  version: number;
  quality: MotionQuality;
  storageUrl: string | null;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
  renderTimeMs: number;
  qualityScore: MotionQualityScore | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(schema.motionRenders).values({
    motionSessionId: input.motionSessionId,
    version: input.version,
    quality: input.quality,
    storageUrl: input.storageUrl,
    durationSeconds: Math.round(input.durationSeconds),
    width: input.width,
    height: input.height,
    fps: input.fps,
    sizeBytes: input.sizeBytes,
    renderTimeMs: input.renderTimeMs,
    qualityScore: input.qualityScore as Record<string, number> | null,
    metadata: input.metadata ?? {},
  });
}

export async function latestRenders(motionId: string): Promise<{ preview: string | null; final: string | null }> {
  const rows = await db
    .select({
      quality: schema.motionRenders.quality,
      storageUrl: schema.motionRenders.storageUrl,
      version: schema.motionRenders.version,
    })
    .from(schema.motionRenders)
    .where(eq(schema.motionRenders.motionSessionId, motionId))
    .orderBy(desc(schema.motionRenders.version), desc(schema.motionRenders.createdAt));

  const preview = rows.find((row) => row.quality === 'preview' && row.storageUrl)?.storageUrl ?? null;
  const final = rows.find((row) => row.quality === 'final' && row.storageUrl)?.storageUrl ?? null;
  return { preview, final };
}

/** Valida o que veio do jsonb: metadata é livre e um shape errado não pode derrubar o status. */
function parseAssetsSummary(value: unknown): MotionAssetsSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const summary = value as Record<string, unknown>;
  if (typeof summary.logo !== 'boolean') return null;
  if (typeof summary.images !== 'number' || typeof summary.videos !== 'number') return null;
  return { logo: summary.logo, images: summary.images, videos: summary.videos };
}

export async function statusView(motionId: string): Promise<MotionStatusView | null> {
  const session = await getSession(motionId);
  if (!session) return null;

  // Três leituras independentes em paralelo: o status é chamado em polling e
  // cada round-trip sequencial a mais é latência visível no chat.
  const [renderRows, clientRows, metadata] = await Promise.all([
    db
      .select({
        version: schema.motionRenders.version,
        quality: schema.motionRenders.quality,
        storageUrl: schema.motionRenders.storageUrl,
        createdAt: schema.motionRenders.createdAt,
      })
      .from(schema.motionRenders)
      .where(eq(schema.motionRenders.motionSessionId, motionId))
      .orderBy(asc(schema.motionRenders.version), asc(schema.motionRenders.createdAt)),
    // AD_HOC (session.clientId null): sem cliente pra buscar, nem vale a
    // query — clientName sai null abaixo, o mesmo resultado de uma busca
    // vazia, só sem o round-trip ao banco.
    session.clientId
      ? db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, session.clientId)).limit(1)
      : Promise.resolve([]),
    getMetadata(motionId),
  ]);

  const versions: MotionRenderVersion[] = renderRows.map((row) => ({
    version: row.version,
    quality: row.quality as MotionQuality,
    url: row.storageUrl,
    createdAt: row.createdAt,
  }));
  // Os campos previewUrl/finalUrl continuam sendo a versão MAIS RECENTE — a
  // web já consome assim; a lista completa fica em `versions`.
  const latest = (quality: MotionQuality): string | null =>
    [...versions].reverse().find((row) => row.quality === quality && row.url)?.url ?? null;

  const brief = metadata.brief as { campaignName?: unknown } | undefined;
  const campaignName =
    typeof brief?.campaignName === 'string' && brief.campaignName.trim() !== '' ? brief.campaignName : null;

  return {
    motionId: session.id,
    status: session.status,
    stage: UI_STAGE[session.status],
    stageDetail: session.stageDetail,
    format: session.format,
    durationSeconds: session.durationSeconds,
    fps: session.fps,
    width: session.width,
    height: session.height,
    renderVersion: session.renderVersion,
    previewUrl: latest('preview'),
    finalUrl: latest('final'),
    error: session.error,
    errorCode: session.errorCode,
    updatedAt: session.updatedAt.toISOString(),
    versions,
    clientName: clientRows[0]?.name ?? null,
    campaignName,
    assets: parseAssetsSummary(metadata.assets_summary),
  };
}

export function isTerminal(status: MotionStatus): boolean {
  return TERMINAL_MOTION_STATUSES.has(status);
}
