import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@desigual-os/logging';
import { publishWsEvent } from '@desigual-os/orchestrator';
import { resolveClientContext } from './client-context/resolver.js';
import { prepareAssets } from './client-context/prepare-assets.js';
import { hasUsableVisuals, selectAssets } from './client-context/asset-index.js';
import { MotionError, isMotionError, userMessageFor } from './errors.js';
import { MOTION_MODEL_ID } from './model.js';
import { buildCreationPrompt, buildFixPrompt, buildPatchPrompt, buildVisualQaPrompt } from './prompts/briefing.js';
import { MOTION_PATCH_SYSTEM_PROMPT, MOTION_SYSTEM_PROMPT } from './prompts/system.js';
import { runClaudeCode } from './providers/claude-code.js';
import { bundleMotion } from './render/bundle.js';
import { extractReviewFrames, renderMotion } from './render/render.js';
import { restoreProtectedFiles, writeScaffold, type ScaffoldConfig } from './render/scaffold.js';
import { findMissingStaticFiles, runTechnicalQa } from './qa/technical.js';
import { buildQualityScore, parseVisualQa, shouldBlockDelivery, type VisualQaReport } from './qa/visual.js';
import * as store from './store/sessions.js';
import { motionStoragePath, uploadMotionFile } from './store/storage.js';
import { UI_STAGE, type MotionQualityScore, type MotionSession, type MotionStatus } from './types.js';
import { appendLog, workspaceFor, writeJson, type MotionWorkspace } from './workspace/workspace.js';

/** Quantas vezes tentar consertar uma build quebrada antes de desistir (§22). */
const MAX_BUILD_FIXES = 3;
/** Quantas passadas de correção visual (§24). Duas já custam caro; três raramente muda o veredito. */
const MAX_VISUAL_FIXES = 2;

const CODEGEN_TIMEOUT_MS = 25 * 60 * 1000;
const FIX_TIMEOUT_MS = 12 * 60 * 1000;
const QA_TIMEOUT_MS = 15 * 60 * 1000;
/** Teto de gasto por passada do agente. Loop de agente sem teto é conta aberta. */
const MAX_BUDGET_USD = Number(process.env.OTTO_MOTION_MAX_BUDGET_USD ?? '6');

export interface PipelineDeps {
  logger: Logger;
}

/**
 * §22 — o pipeline inteiro.
 *
 *   contexto -> assets -> Opus 5.5 escreve -> build -> preview ->
 *   QA técnico + QA visual -> correção -> render final -> MP4 -> chat
 *
 * Cada transição publica um evento de WS com o texto de UI do §39. O que a
 * pessoa lê é "Renderizando preview", nunca "webpack compilou em 8.2s".
 */
export async function runMotionPipeline(params: {
  motionId: string;
  mode: 'create' | 'update' | 'render';
  instruction?: string | undefined;
  deps: PipelineDeps;
}): Promise<{ status: MotionStatus; finalUrl: string | null; previewUrl: string | null; summary: string }> {
  const { motionId, mode, deps } = params;
  const { logger } = deps;
  const session = await store.requireSession(motionId);
  const workspace = workspaceFor(motionId);

  try {
    const result = await execute({ session, workspace, mode, instruction: params.instruction, logger });
    return result;
  } catch (error) {
    const code = isMotionError(error) ? error.code : 'INTERNAL';
    const message = userMessageFor(error);
    const detail = isMotionError(error) ? (error.detail ?? '') : error instanceof Error ? error.stack ?? error.message : String(error);

    logger.error({ motionId, code, detail }, 'Motion: pipeline falhou');
    await appendLog(workspace, 'pipeline.log', `[${new Date().toISOString()}] FAILED ${code}\n${detail}`);
    await store.updateStatus(motionId, 'failed', { error: message, errorCode: code });
    await publishStage(motionId, session.conversationId, 'failed', message);
    throw error;
  }
}

async function execute(params: {
  session: MotionSession;
  workspace: MotionWorkspace;
  mode: 'create' | 'update' | 'render';
  instruction: string | undefined;
  logger: Logger;
}): Promise<{ status: MotionStatus; finalUrl: string | null; previewUrl: string | null; summary: string }> {
  const { session, workspace, mode, instruction, logger } = params;
  const motionId = session.id;

  // ---- 1. CONTEXTO DO CLIENTE (§10) ---------------------------------------
  await stage(session, 'resolving_context');
  const storedReferences = ((await store.getMetadata(motionId)).references ?? []) as {
    url: string;
    filename: string;
    contentType: string;
  }[];

  const context = await resolveClientContext(session.clientId, storedReferences);
  await writeJson(workspace.contextFile, {
    brand: context.brand,
    sources: context.sources,
    missing: context.missing,
    assetCount: context.assets.length,
  });

  // ---- 2. ASSETS (§11/§31) -------------------------------------------------
  await stage(session, 'preparing_assets');
  const selection = selectAssets(context.assets);
  const prepared = await prepareAssets({ workspace, assets: selection.selected, logger });

  if (mode === 'create' && !hasUsableVisuals(prepared.assets) && context.assets.length === 0) {
    // §26/§47-E: erro amigável com ação, não "Error 500". Peça sem nenhum
    // material ainda É possível (tipografia + cor), mas a pessoa precisa
    // saber que vai sair assim antes de ver o resultado.
    logger.info({ motionId, clientId: session.clientId }, 'Motion: cliente sem nenhum asset');
  }

  await store.mergeMetadata(motionId, {
    context: {
      sources: context.sources,
      missing: context.missing,
      selected: prepared.assets.map((asset) => ({ kind: asset.kind, path: asset.projectPath, origin: asset.origin })),
      skipped: selection.skipped,
      failed: prepared.failed,
    },
  });

  // ---- 3. SCAFFOLD --------------------------------------------------------
  const scaffold: ScaffoldConfig = {
    width: session.width,
    height: session.height,
    fps: session.fps,
    durationInFrames: Math.round(session.durationSeconds * session.fps),
    durationSeconds: session.durationSeconds,
    brandName: context.brand.name,
  };
  await writeScaffold(workspace, scaffold);

  // ---- 4. OPUS 5.5 ESCREVE O MOTION (§5/§19) ------------------------------
  const storedMetadata = await store.getMetadata(motionId);
  let summary = (storedMetadata.lastSummary as string | null) ?? '';
  let costUsd = 0;

  if (mode === 'render') {
    // Re-render puro: o projeto já existe e não vai ser tocado. Nenhuma
    // chamada ao agente, nenhum custo de modelo.
    logger.info({ motionId }, 'Motion: re-render sem passar pelo agente');
  } else {
    await stage(session, mode === 'create' ? 'planning' : 'coding');
    const prompt =
      mode === 'create'
        ? buildCreationPrompt({ session, context, assets: prepared.assets })
        : buildPatchPrompt({
            instruction: instruction ?? '',
            session,
            context,
            assets: prepared.assets,
            previousSummary: summary === '' ? null : summary,
          });

    await stage(session, 'coding');
    const codegen = await runClaudeCode({
      cwd: workspace.project,
      prompt,
      systemPrompt: mode === 'create' ? MOTION_SYSTEM_PROMPT : MOTION_PATCH_SYSTEM_PROMPT,
      timeoutMs: CODEGEN_TIMEOUT_MS,
      maxBudgetUsd: MAX_BUDGET_USD,
      logger,
      motionId,
      stage: mode,
    });
    await appendLog(workspace, 'agent.log', `[${new Date().toISOString()}] ${mode}\n${codegen.text}`);
    summary = codegen.text;
    costUsd = codegen.costUsd;

    const restored = await restoreProtectedFiles(workspace, scaffold);
    if (restored.length > 0) {
      logger.warn({ motionId, restored }, 'Motion: arquivos protegidos foram reescritos pelo agente e restaurados');
    }
  }

  // ---- 5. BUILD, com conserto (§22) ---------------------------------------
  await stage(session, 'building');
  let serveUrl = '';
  for (let attempt = 1; attempt <= MAX_BUILD_FIXES + 1; attempt += 1) {
    try {
      serveUrl = (await bundleMotion(workspace)).serveUrl;
      break;
    } catch (error) {
      if (!isMotionError(error) || attempt > MAX_BUILD_FIXES) throw error;
      logger.warn({ motionId, attempt }, 'Motion: build falhou, devolvendo o erro pro agente');
      await stage(session, 'fixing', `tentativa ${attempt} de ${MAX_BUILD_FIXES}`);
      const fix = await runClaudeCode({
        cwd: workspace.project,
        prompt: buildFixPrompt({ error: error.detail ?? error.message, attempt, maxAttempts: MAX_BUILD_FIXES }),
        systemPrompt: MOTION_PATCH_SYSTEM_PROMPT,
        timeoutMs: FIX_TIMEOUT_MS,
        maxBudgetUsd: MAX_BUDGET_USD,
        logger,
        motionId,
        stage: `build-fix-${attempt}`,
      });
      costUsd += fix.costUsd;
      await restoreProtectedFiles(workspace, scaffold);
      await stage(session, 'building');
    }
  }

  // ---- 6. PREVIEW (§23) ----------------------------------------------------
  await stage(session, 'rendering_preview');
  const runtimeErrors: string[] = [];
  const previewRender = await renderMotion({
    workspace,
    serveUrl,
    quality: 'preview',
    logger,
    onRuntimeError: (text) => runtimeErrors.push(text),
  });

  // ---- 7. QA (§24/§25) -----------------------------------------------------
  await stage(session, 'reviewing');
  const frames = await extractReviewFrames({ workspace, serveUrl });
  // No re-render puro a revisão visual não roda: o projeto é bit a bit o
  // mesmo que já foi revisado, e pagar outra passada de Opus pra reconfirmar
  // o que não mudou seria gasto sem pergunta. O QA técnico continua valendo —
  // ele é medição do ARQUIVO, e o arquivo é novo.
  let visual = mode === 'render' ? null : await runVisualQa({ workspace, frames, session, context, logger, motionId });
  if (visual) costUsd += visual.costUsd;

  let technical = await runTechnicalQa({
    file: previewRender.file,
    expected: {
      width: previewRender.width,
      height: previewRender.height,
      fps: session.fps,
      durationSeconds: session.durationSeconds,
    },
    frames,
    runtimeErrors,
    missingAssets: await missingStaticFiles(workspace),
  });

  // ---- 8. CORREÇÃO E NOVO PREVIEW (§24) -----------------------------------
  const maxFixes = mode === 'render' ? 0 : MAX_VISUAL_FIXES;
  for (let pass = 1; pass <= maxFixes; pass += 1) {
    const gate = shouldBlockDelivery({ technicalScore: technical.score, visual: visual?.report ?? null });
    if (!gate.blocked) break;

    logger.info({ motionId, pass, reason: gate.reason }, 'Motion: QA pediu correção');
    await stage(session, 'fixing', gate.reason ?? undefined);

    // A passada de QA visual JÁ corrige o código (o prompt manda corrigir).
    // Quando o bloqueio é só técnico, é preciso um pedido explícito.
    if (visual?.report.verdict !== 'REQUIRES_FIX' || pass > 1) {
      const fix = await runClaudeCode({
        cwd: workspace.project,
        prompt: buildFixPrompt({
          error: [gate.reason, ...technical.failures.map((f) => `${f.label}: ${f.detail}`)].filter(Boolean).join('\n'),
          attempt: pass,
          maxAttempts: MAX_VISUAL_FIXES,
        }),
        systemPrompt: MOTION_PATCH_SYSTEM_PROMPT,
        timeoutMs: FIX_TIMEOUT_MS,
        maxBudgetUsd: MAX_BUDGET_USD,
        logger,
        motionId,
        stage: `qa-fix-${pass}`,
      });
      costUsd += fix.costUsd;
    }

    await restoreProtectedFiles(workspace, scaffold);
    await stage(session, 'building');
    serveUrl = (await bundleMotion(workspace)).serveUrl;

    await stage(session, 'rendering_preview');
    runtimeErrors.length = 0;
    const repreview = await renderMotion({
      workspace,
      serveUrl,
      quality: 'preview',
      logger,
      onRuntimeError: (text) => runtimeErrors.push(text),
    });

    await stage(session, 'reviewing');
    const reframes = await extractReviewFrames({ workspace, serveUrl });
    visual = await runVisualQa({ workspace, frames: reframes, session, context, logger, motionId });
    if (visual) costUsd += visual.costUsd;
    technical = await runTechnicalQa({
      file: repreview.file,
      expected: {
        width: repreview.width,
        height: repreview.height,
        fps: session.fps,
        durationSeconds: session.durationSeconds,
      },
      frames: reframes,
      runtimeErrors,
      missingAssets: await missingStaticFiles(workspace),
    });
  }

  const finalGate = shouldBlockDelivery({ technicalScore: technical.score, visual: visual?.report ?? null });
  if (technical.score < 95) {
    // §44: technical < 95 NÃO conclui. Diferente do visual, isto não é gosto:
    // é o arquivo não sendo o que foi pedido.
    throw new MotionError('QA_FAILED', 'O motion não passou na verificação técnica e eu não vou entregar assim.', {
      detail: technical.failures.map((f) => `${f.label}: ${f.detail}`).join('; '),
      actions: [{ label: 'Tentar de novo', action: 'retry' }],
    });
  }

  // ---- 9. RENDER FINAL (§23) ----------------------------------------------
  await stage(session, 'rendering_final');
  const version = await store.nextRenderVersion(motionId);
  const finalRender = await renderMotion({
    workspace,
    serveUrl,
    quality: 'final',
    logger,
    onRuntimeError: (text) => runtimeErrors.push(text),
  });

  const score: MotionQualityScore = buildQualityScore(technical.score, visual?.report ?? null);

  const previewUrl = await uploadMotionFile({
    localFile: previewRender.file,
    storagePath: motionStoragePath(session.clientId, motionId, version, 'preview'),
  }).catch(() => null);

  const finalUrl = await uploadMotionFile({
    localFile: finalRender.file,
    storagePath: motionStoragePath(session.clientId, motionId, version, 'final'),
  });

  await store.recordRender({
    motionSessionId: motionId,
    version,
    quality: 'preview',
    storageUrl: previewUrl,
    durationSeconds: previewRender.durationSeconds,
    width: previewRender.width,
    height: previewRender.height,
    fps: previewRender.fps,
    sizeBytes: previewRender.sizeBytes,
    renderTimeMs: previewRender.renderTimeMs,
    qualityScore: score,
  });

  await store.recordRender({
    motionSessionId: motionId,
    version,
    quality: 'final',
    storageUrl: finalUrl,
    durationSeconds: finalRender.durationSeconds,
    width: finalRender.width,
    height: finalRender.height,
    fps: finalRender.fps,
    sizeBytes: finalRender.sizeBytes,
    renderTimeMs: finalRender.renderTimeMs,
    qualityScore: score,
    metadata: {
      model: MOTION_MODEL_ID,
      cost_usd: Number(costUsd.toFixed(4)),
      technical_checks: technical.checks,
      visual_problems: visual?.report.problems ?? [],
      qa_blocked_at_end: finalGate.blocked,
      qa_block_reason: finalGate.reason,
    },
  });

  summary = [summary, visual?.report.problems.length ? `Revisão visual: ${visual.report.problems.length} ajuste(s) aplicados.` : '']
    .filter(Boolean)
    .join('\n\n');

  await store.mergeMetadata(motionId, { lastSummary: summary, lastCostUsd: costUsd, lastScore: score });
  await store.updateStatus(motionId, 'completed', { stageDetail: null, error: null, errorCode: null });
  await publishStage(motionId, session.conversationId, 'completed', null, { final_url: finalUrl, version });

  logger.info(
    { motionId, version, costUsd: Number(costUsd.toFixed(4)), technical: technical.score, model: MOTION_MODEL_ID },
    'Motion: concluído',
  );

  return { status: 'completed', finalUrl, previewUrl, summary };
}

async function runVisualQa(params: {
  workspace: MotionWorkspace;
  frames: { relativePath: string; timeSeconds: number }[];
  session: MotionSession;
  context: Awaited<ReturnType<typeof resolveClientContext>>;
  logger: Logger;
  motionId: string;
}): Promise<{ report: VisualQaReport; costUsd: number } | null> {
  const { workspace, frames, session, context, logger, motionId } = params;

  /**
   * Apaga o veredito da passada anterior ANTES de pedir o novo.
   *
   * Sem isto, um QA.md que o agente não reescrevesse seria lido como se fosse
   * a revisão desta passada: um QUALITY_PASS velho aprovaria uma regressão, e
   * um REQUIRES_FIX velho condenaria um motion já consertado. O arquivo
   * precisa ser produzido por esta rodada pra valer por esta rodada.
   */
  const qaFile = path.join(workspace.project, 'QA.md');
  await fs.rm(qaFile, { force: true });

  const run = await runClaudeCode({
    cwd: workspace.project,
    prompt: buildVisualQaPrompt({
      frames: frames.map((frame) => ({ file: frame.relativePath, timeSeconds: frame.timeSeconds })),
      session,
      brandName: context.brand.name,
      colors: context.brand.colors,
    }),
    systemPrompt: MOTION_PATCH_SYSTEM_PROMPT,
    timeoutMs: QA_TIMEOUT_MS,
    maxBudgetUsd: MAX_BUDGET_USD,
    logger,
    motionId,
    stage: 'visual-qa',
  }).catch((error: unknown) => {
    // QA visual que falha não derruba o motion: o QA técnico continua valendo
    // e ele é o que tem piso duro. Perder a peça inteira porque a revisão
    // caiu seria trocar um problema pequeno por um grande.
    logger.warn({ motionId, error }, 'Motion: revisão visual indisponível; seguindo com o QA técnico');
    return null;
  });

  if (!run) return null;

  // O veredito preferencial é o QA.md que o prompt pede; o texto da resposta
  // é o fallback quando o agente respondeu sem escrever o arquivo.
  const file = await fs.readFile(qaFile, 'utf8').catch(() => null);
  const report = parseVisualQa(file ?? run.text);
  await appendLog(workspace, 'qa.log', `[${new Date().toISOString()}] ${report.verdict}\n${report.raw}`);
  return { report, costUsd: run.costUsd };
}

async function missingStaticFiles(workspace: MotionWorkspace): Promise<string[]> {
  const src = path.join(workspace.project, 'src');
  const sources: { path: string; content: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        sources.push({ path: full, content: await fs.readFile(full, 'utf8').catch(() => '') });
      }
    }
  };
  await walk(src);
  return findMissingStaticFiles(sources, path.join(workspace.project, 'public'));
}

async function stage(session: MotionSession, status: MotionStatus, detail?: string): Promise<void> {
  await store.updateStatus(session.id, status, { stageDetail: detail ?? null });
  await publishStage(session.id, session.conversationId, status, detail ?? null);
}

async function publishStage(
  motionId: string,
  conversationId: string | null,
  status: MotionStatus,
  detail: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  // §39 — o payload carrega o texto de UI já pronto. A web não deve ter que
  // saber traduzir 'rendering_preview'.
  await publishWsEvent({
    type: 'studio.job.progress',
    payload: {
      kind: 'motion',
      motion_id: motionId,
      conversation_id: conversationId,
      status,
      stage: UI_STAGE[status],
      stage_detail: detail,
      ...extra,
    },
  }).catch(() => undefined);
}
