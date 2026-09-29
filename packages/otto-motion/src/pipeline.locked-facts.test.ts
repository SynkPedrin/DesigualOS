import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@desigual-os/logging';
import { extractLockedFacts } from './brief/locked-facts.js';
import type { CampaignBrief } from './brief/schema.js';
import type { MotionSession } from './types.js';

/**
 * §16 — o gate de locked facts no pipeline, de ponta a ponta e sem Claude.
 *
 * O agente é um mock que escreve Motion.tsx de verdade no workspace: o que se
 * prova aqui é que a VARREDURA programática (a camada que não depende de o
 * modelo cooperar) barra a entrega quando o valor sai errado, e que a
 * instrução devolvida ao agente aponta o valor violado e o valor travado.
 * Chamar o Claude de verdade provaria o mock, não o gate.
 */

const brief: CampaignBrief = {
  campaignName: 'Promoção de Setembro',
  offer: { name: 'Sessão avulsa', price: 'R$ 375' },
};
const lockedFacts = extractLockedFacts(brief);

const estado = vi.hoisted(() => ({
  runtimeDir: '',
  motionId: 'motion-teste-locked-facts',
  metadata: {} as Record<string, unknown>,
  prompts: [] as { stage: string; prompt: string }[],
  /** O que o "agente" escreve em Motion.tsx a cada estágio. */
  roteiro: {} as Record<string, string>,
  statusGravados: [] as { status: string; errorCode?: string | null | undefined }[],
}));

const MOTION_ERRADO = `export const Motion = () => <div>R$ 3.750 à vista</div>;`;
const MOTION_ERRADO_2 = `export const Motion = () => <div>R$ 3.500 à vista</div>;`;
const MOTION_CERTO = `export const Motion = () => <div>R$ 375 à vista</div>;`;

vi.mock('./store/sessions.js', () => ({
  requireSession: async (motionId: string): Promise<MotionSession> => ({
    id: motionId,
    clientId: 'cliente-1',
    conversationId: null,
    projectId: null,
    requestedBy: null,
    workspacePath: '',
    status: 'queued',
    stageDetail: null,
    prompt: 'vídeo da promoção',
    durationSeconds: 5,
    fps: 30,
    width: 1080,
    height: 1920,
    format: '9:16',
    model: 'claude-opus-5-5',
    renderVersion: 0,
    error: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getMetadata: async () => estado.metadata,
  mergeMetadata: async (_id: string, patch: Record<string, unknown>) => {
    Object.assign(estado.metadata, patch);
  },
  updateStatus: async (_id: string, status: string, options: { errorCode?: string | null } = {}) => {
    estado.statusGravados.push({ status, errorCode: options.errorCode });
  },
  nextRenderVersion: async () => 1,
  recordRender: async () => undefined,
}));

vi.mock('./client-context/resolver.js', () => ({
  resolveClientContext: async () => ({
    clientId: 'cliente-1',
    brand: {
      name: 'Cliente Teste',
      slug: 'cliente-teste',
      positioning: null,
      audience: null,
      toneOfVoice: null,
      colors: [],
      fonts: [],
      approvedCtas: [],
      restrictions: [],
      products: [],
      gaps: [],
    },
    assets: [],
    briefing: null,
    sources: [],
    missing: [],
  }),
}));

vi.mock('./client-context/prepare-assets.js', () => ({
  prepareAssets: async () => ({ assets: [], failed: [] }),
}));

vi.mock('./client-context/asset-index.js', () => ({
  selectAssets: () => ({ selected: [], skipped: [], usedRelevance: false }),
  hasUsableVisuals: () => false,
}));

vi.mock('./providers/claude-code.js', () => ({
  runClaudeCode: async (options: { cwd: string; prompt: string; stage: string }) => {
    estado.prompts.push({ stage: options.stage, prompt: options.prompt });
    const codigo = estado.roteiro[options.stage];
    if (codigo !== undefined) {
      await fs.mkdir(path.join(options.cwd, 'src'), { recursive: true });
      await fs.writeFile(path.join(options.cwd, 'src', 'Motion.tsx'), codigo, 'utf8');
    }
    const isVisualQa = options.stage === 'visual-qa';
    return {
      text: isVisualQa ? 'VEREDITO: QUALITY_PASS\n\nSCORES:\nvisual: 90\nbrand: 90\nlegibility: 90\ncomposition: 90' : 'resumo',
      costUsd: 0.1,
      turns: 1,
      durationMs: 100,
      modelsUsed: ['claude-opus-5-5'],
      sessionId: null,
      denials: [],
    };
  },
}));

vi.mock('./render/bundle.js', () => ({
  bundleMotion: async () => ({ serveUrl: 'http://localhost:0' }),
}));

vi.mock('./render/render.js', () => ({
  renderMotion: async (_opts: { workspace: { output: string }; quality: string }) => ({
    file: path.join(_opts.workspace.output, 'out.mp4'),
    quality: _opts.quality,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 150,
    durationSeconds: 5,
    sizeBytes: 2048,
    renderTimeMs: 1000,
  }),
  extractReviewFrames: async () => [{ relativePath: 'frames/f0.png', timeSeconds: 0 }],
}));

vi.mock('./render/scaffold.js', () => ({
  COMPOSITION_ID: 'Motion',
  writeScaffold: async () => undefined,
  restoreProtectedFiles: async () => [],
}));

vi.mock('./store/storage.js', () => ({
  motionStoragePath: () => 'motion/final.mp4',
  uploadMotionFile: async () => 'https://storage.example/final.mp4',
}));

vi.mock('./qa/technical.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./qa/technical.js')>();
  return {
    ...original,
    runTechnicalQa: async () => ({ score: 100, checks: [], failures: [] }),
  };
});

vi.mock('@desigual-os/orchestrator', () => ({
  publishWsEvent: async () => undefined,
}));

const logger = createLogger({ service: 'motion-test' });
const { runMotionPipeline } = await import('./pipeline.js');
const { workspaceFor } = await import('./workspace/workspace.js');

async function escreverMotionInicial(codigo: string): Promise<void> {
  const workspace = workspaceFor(estado.motionId);
  await fs.mkdir(path.join(workspace.project, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace.project, 'src', 'Motion.tsx'), codigo, 'utf8');
}

beforeAll(async () => {
  estado.runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-locked-facts-'));
  process.env.OTTO_MOTION_RUNTIME_DIR = estado.runtimeDir;
});

afterAll(async () => {
  delete process.env.OTTO_MOTION_RUNTIME_DIR;
  await fs.rm(estado.runtimeDir, { recursive: true, force: true });
});

beforeEach(() => {
  estado.metadata = { brief, locked_facts: lockedFacts };
  estado.prompts = [];
  estado.roteiro = {};
  estado.statusGravados = [];
});

describe('§16 — gate de locked facts no pipeline', () => {
  it('violação vira instrução de fix com o valor violado e o valor travado, e o motion conclui quando o fix corrige', async () => {
    await escreverMotionInicial(MOTION_ERRADO);
    estado.roteiro = { create: MOTION_ERRADO, 'qa-fix-1': MOTION_CERTO };

    const result = await runMotionPipeline({ motionId: estado.motionId, mode: 'create', deps: { logger } });

    expect(result.status).toBe('completed');
    const fix = estado.prompts.filter((p) => p.stage.startsWith('qa-fix'));
    expect(fix).toHaveLength(1);
    // A instrução precisa dizer o que está errado E qual é o valor certo —
    // sem os dois lados o agente corrige às cegas.
    expect(fix[0]?.prompt).toContain('LOCKED FACTS VIOLADOS');
    expect(fix[0]?.prompt).toContain('R$ 3.750');
    expect(fix[0]?.prompt).toContain('`R$ 375`');
    expect(fix[0]?.prompt).toContain('sem alterar mais nada');
  });

  it('falha fechado com QA_FAILED quando a violação persiste depois de esgotadas as passadas', async () => {
    await escreverMotionInicial(MOTION_ERRADO);
    estado.roteiro = { create: MOTION_ERRADO, 'qa-fix-1': MOTION_ERRADO_2, 'qa-fix-2': MOTION_ERRADO_2 };

    const erro = await runMotionPipeline({ motionId: estado.motionId, mode: 'create', deps: { logger } }).catch(
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(Error);
    const motionErro = erro as { code?: string; detail?: string };
    expect(motionErro.code).toBe('QA_FAILED');
    expect(motionErro.detail).toContain('R$ 3.500');
    // O job inteiro é marcado como falho — NUNCA se entrega render com
    // locked fact violado.
    expect(estado.statusGravados).toContainEqual({ status: 'failed', errorCode: 'QA_FAILED' });
    // E nenhum render foi gravado.
    expect(estado.statusGravados.some((s) => s.status === 'completed')).toBe(false);
  });

  it('sem locked facts o gate é no-op: valor qualquer na tela não bloqueia', async () => {
    estado.metadata = { brief: null, locked_facts: [] };
    await escreverMotionInicial(MOTION_ERRADO);
    estado.roteiro = { create: MOTION_ERRADO };

    const result = await runMotionPipeline({ motionId: estado.motionId, mode: 'create', deps: { logger } });

    expect(result.status).toBe('completed');
    expect(estado.prompts.filter((p) => p.stage.startsWith('qa-fix'))).toHaveLength(0);
  });

  it('o prompt de revisão visual carrega o bloco LOCKED FACTS quando há fatos travados', async () => {
    await escreverMotionInicial(MOTION_CERTO);
    estado.roteiro = { create: MOTION_CERTO };

    await runMotionPipeline({ motionId: estado.motionId, mode: 'create', deps: { logger } });

    const visual = estado.prompts.find((p) => p.stage === 'visual-qa');
    expect(visual?.prompt).toContain('# LOCKED FACTS');
    expect(visual?.prompt).toContain('`R$ 375`');
    expect(visual?.prompt).toContain('Preço, porcentagem, datas e CTA batem EXATAMENTE');
  });

  it('grava assets_summary na metadata depois de preparar os assets', async () => {
    await escreverMotionInicial(MOTION_CERTO);
    estado.roteiro = { create: MOTION_CERTO };

    await runMotionPipeline({ motionId: estado.motionId, mode: 'create', deps: { logger } });

    expect(estado.metadata.assets_summary).toEqual({ logo: false, images: 0, videos: 0 });
  });
});
