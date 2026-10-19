import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@desigual-os/logging';
import type { MotionSession } from './types.js';

/**
 * Versionamento V1 → V2 de ponta a ponta: Claude MOCKADO, Remotion REAL.
 *
 * A fronteira mockada é SÓ providers/claude-code.js (o "agente"): ele escreve
 * um src/Motion.tsx de verdade no modo create e faz um patch cirúrgico no
 * modo update — exatamente o contrato do §43. Bundle, render, frames e QA
 * técnico rodam contra o Remotion real, porque é isso que prova que o MP4 da
 * V2 existe, que a V1 continua registrada e que o workspace não é recriado
 * numa iteração. Mockar o render provaria o mock, não o pipeline.
 *
 * ATENÇÃO: este arquivo é pesado por natureza (webpack + Chrome headless +
 * encodes reais, duas vezes). Fica no `pnpm test` de propósito — é a única
 * prova de versionamento real — mas cada `it` carrega timeout próprio de
 * 5 minutos.
 */

const estado = vi.hoisted(() => ({
  runtimeDir: '',
  metadata: {} as Record<string, unknown>,
  prompts: [] as { motionId: string; stage: string; prompt: string }[],
  renders: [] as { motionId: string; version: number; quality: string; storageUrl: string | null }[],
  statusGravados: [] as { motionId: string; status: string; errorCode?: string | null | undefined }[],
  versaoAtual: 0,
  /** Quando setado, o "agente" falha em vez de escrever código. */
  falha: null as null | 'opus' | 'generica',
}));

const logger = createLogger({ service: 'motion-test' });

function sessaoFake(motionId: string): MotionSession {
  // 480x854 @ 2s: formato 9:16 real, mas pequeno o suficiente pra dois
  // bundles + quatro encodes caberem num tempo de CI razoável.
  return {
    id: motionId,
    clientId: 'cliente-versioning',
    conversationId: null,
    projectId: null,
    requestedBy: null,
    workspacePath: '',
    status: 'queued',
    stageDetail: null,
    prompt: 'vídeo curto de oferta com foto do produto',
    durationSeconds: 2,
    fps: 30,
    width: 480,
    height: 854,
    format: '9:16',
    model: 'claude-opus-5-5',
    renderVersion: 0,
    error: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

vi.mock('./store/sessions.js', () => ({
  requireSession: async (motionId: string): Promise<MotionSession> => sessaoFake(motionId),
  getMetadata: async () => estado.metadata,
  mergeMetadata: async (_id: string, patch: Record<string, unknown>) => {
    Object.assign(estado.metadata, patch);
  },
  updateStatus: async (motionId: string, status: string, options: { errorCode?: string | null } = {}) => {
    estado.statusGravados.push({ motionId, status, errorCode: options.errorCode });
  },
  nextRenderVersion: async () => {
    estado.versaoAtual += 1;
    return estado.versaoAtual;
  },
  recordRender: async (input: { motionSessionId: string; version: number; quality: string; storageUrl: string | null }) => {
    estado.renders.push({
      motionId: input.motionSessionId,
      version: input.version,
      quality: input.quality,
      storageUrl: input.storageUrl,
    });
  },
}));

vi.mock('./client-context/resolver.js', () => ({
  resolveClientContext: async () => ({
    clientId: 'cliente-versioning',
    brand: {
      name: 'Cliente Versioning',
      slug: 'cliente-versioning',
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
  // O "material do cliente" aqui é um PNG gerado na hora, copiado pra dentro
  // do projeto como qualquer asset real seria — é ele que o Motion.tsx
  // referencia via staticFile('assets/produto.png').
  prepareAssets: async ({ workspace }: { workspace: { project: string } }) => {
    const sharp = (await import('sharp')).default;
    const dir = path.join(workspace.project, 'public', 'assets');
    await fs.mkdir(dir, { recursive: true });
    await sharp({
      create: { width: 120, height: 120, channels: 3, background: { r: 255, g: 222, b: 0 } },
    })
      .png()
      .toFile(path.join(dir, 'produto.png'));
    return {
      assets: [{ kind: 'image', projectPath: 'assets/produto.png', origin: 'teste-versioning' }],
      failed: [],
    };
  },
}));

vi.mock('./client-context/asset-index.js', () => ({
  selectAssets: () => ({ selected: [], skipped: [], usedRelevance: false }),
  hasUsableVisuals: () => true,
}));

/**
 * O "agente". Dois comportamentos importam:
 *
 *  - create: escreve um Motion.tsx VÁLIDO de verdade (duas cenas via
 *    <Sequence>, texto animado e a imagem de public/assets/).
 *  - update: NÃO reescreve o arquivo — lê o atual e troca só o trecho pedido,
 *    que é o que a instrução conversacional manda fazer (§43). O teste prova
 *    que a parte não pedida sobrevive intacta.
 */
vi.mock('./providers/claude-code.js', () => ({
  runClaudeCode: async (options: { cwd: string; prompt: string; stage: string; motionId: string }) => {
    estado.prompts.push({ motionId: options.motionId, stage: options.stage, prompt: options.prompt });

    if (estado.falha === 'opus') {
      const { MotionModelUnavailableError } = await import('./errors.js');
      throw new MotionModelUnavailableError("You've reached your weekly usage limit. Resets Sep 28 at 4pm.");
    }
    if (estado.falha === 'generica') {
      // O provider real converte falha genérica do agente em CODEGEN_FAILED
      // antes de lançar — o mock reproduz o CONTRATO, não o acidente.
      const { MotionError } = await import('./errors.js');
      throw new MotionError('CODEGEN_FAILED', 'O Claude Code não conseguiu concluir esta etapa do motion.', {
        detail: 'boom simulado',
      });
    }

    const motionFile = path.join(options.cwd, 'src', 'Motion.tsx');
    if (options.stage === 'create') {
      await fs.mkdir(path.dirname(motionFile), { recursive: true });
      await fs.writeFile(motionFile, MOTION_V1, 'utf8');
    }
    if (options.stage === 'update') {
      const atual = await fs.readFile(motionFile, 'utf8');
      // Patch cirúrgico: a alteração conversacional toca UMA string. Se o
      // resto do arquivo mudar, o teste quebra — de propósito.
      await fs.writeFile(motionFile, atual.replace('Garanta a sua', 'Garanta a sua hoje'), 'utf8');
    }

    return {
      text:
        options.stage === 'visual-qa'
          ? 'VEREDITO: QUALITY_PASS\n\nSCORES:\nvisual: 90\nbrand: 90\nlegibility: 90\ncomposition: 90'
          : 'resumo do agente',
      costUsd: 0.1,
      turns: 1,
      durationMs: 100,
      modelsUsed: ['claude-opus-5-5'],
      sessionId: null,
      denials: [],
    };
  },
}));

vi.mock('./store/storage.js', () => ({
  motionStoragePath: (clientId: string, motionId: string, version: number, kind: string) =>
    `motion/${clientId}/${motionId}/v${version}/${kind}.mp4`,
  uploadMotionFile: async ({ storagePath }: { storagePath: string }) => `https://storage.test/${storagePath}`,
}));

vi.mock('@desigual-os/orchestrator', () => ({
  publishWsEvent: async () => undefined,
}));

const MOTION_V1 = `import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { MOTION_CONFIG } from './config';

const Cena: React.FC<{ titulo: string; cor: string }> = ({ titulo, cor }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: cor, justifyContent: 'center', alignItems: 'center' }}>
      <Img src={staticFile('assets/produto.png')} style={{ width: 160, height: 160 }} />
      <div style={{ opacity, color: '#FFFFFF', fontSize: 44, fontWeight: 800, marginTop: 32 }}>{titulo}</div>
    </AbsoluteFill>
  );
};

export const Motion: React.FC = () => {
  const metade = Math.floor(MOTION_CONFIG.durationInFrames / 2);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={metade}>
        <Cena titulo="Oferta de setembro" cor="#1b3f2a" />
      </Sequence>
      <Sequence from={metade} durationInFrames={MOTION_CONFIG.durationInFrames - metade}>
        <Cena titulo="Garanta a sua" cor="#3f1b2a" />
      </Sequence>
    </AbsoluteFill>
  );
};
`;

const { runMotionPipeline } = await import('./pipeline.js');
const { workspaceFor } = await import('./workspace/workspace.js');

const MOTION_ID = 'motion-versioning-v1-v2';

beforeAll(async () => {
  estado.runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-versioning-'));
  process.env.OTTO_MOTION_RUNTIME_DIR = estado.runtimeDir;
});

afterAll(async () => {
  delete process.env.OTTO_MOTION_RUNTIME_DIR;
  await fs.rm(estado.runtimeDir, { recursive: true, force: true });
});

beforeEach(() => {
  estado.metadata = { brief: null, locked_facts: [] };
  estado.prompts = [];
  estado.falha = null;
});

describe('versionamento V1 → V2 com Claude mockado e Remotion real', () => {
  it('create: bundle/preview/QA técnico reais, status completed, MP4s no workspace, render version 1 e assets_summary', async () => {
    const result = await runMotionPipeline({ motionId: MOTION_ID, mode: 'create', deps: { logger } });

    expect(result.status).toBe('completed');
    expect(estado.statusGravados).toContainEqual({ motionId: MOTION_ID, status: 'completed', errorCode: null });

    // Preview e final existem de verdade no workspace (não é registro, é arquivo).
    const workspace = workspaceFor(MOTION_ID);
    const preview = await fs.stat(path.join(workspace.previews, 'preview.mp4'));
    const final = await fs.stat(path.join(workspace.output, 'final.mp4'));
    expect(preview.size).toBeGreaterThan(1024);
    expect(final.size).toBeGreaterThan(1024);

    // recordRender foi chamado com version 1, preview E final.
    const rendersV1 = estado.renders.filter((render) => render.motionId === MOTION_ID && render.version === 1);
    expect(rendersV1.map((render) => render.quality).sort()).toEqual(['final', 'preview']);
    expect(rendersV1.find((render) => render.quality === 'final')?.storageUrl).toContain('/v1/final.mp4');

    // O resumo do material que entrou no workspace foi pra metadata.
    expect(estado.metadata.assets_summary).toEqual({ logo: false, images: 1, videos: 0 });

    // O QA visual rodou (o agente "olhou" os frames reais extraídos do bundle).
    expect(estado.prompts.some((prompt) => prompt.stage === 'visual-qa')).toBe(true);

    // Sentinela da iteração: se o update recriar o workspace, este arquivo
    // some — é a prova de que o diretório é o MESMO.
    await fs.writeFile(path.join(workspace.root, 'sentinela-iteracao.txt'), 'v1 esteve aqui', 'utf8');
  }, 300_000);

  it('update no MESMO motionId: workspace preservado, instrução chega ao agente, render final vira version 2 e V1 fica registrada', async () => {
    const workspaceAntes = workspaceFor(MOTION_ID);

    const result = await runMotionPipeline({
      motionId: MOTION_ID,
      mode: 'update',
      instruction: 'Troque o texto do CTA final',
      deps: { logger },
    });

    expect(result.status).toBe('completed');

    // Mesmo diretório, não recriado: a sentinela da V1 sobreviveu e o projeto
    // continua onde estava.
    const workspaceDepois = workspaceFor(MOTION_ID);
    expect(workspaceDepois.root).toBe(workspaceAntes.root);
    expect(await fs.readFile(path.join(workspaceDepois.root, 'sentinela-iteracao.txt'), 'utf8')).toBe(
      'v1 esteve aqui',
    );

    // A instrução conversacional chegou ao "agente" no estágio de update.
    const update = estado.prompts.find((prompt) => prompt.stage === 'update');
    expect(update?.prompt).toContain('Troque o texto do CTA final');

    // O patch foi cirúrgico: o trecho pedido mudou, o resto do Motion.tsx
    // (a primeira cena) ficou byte a byte igual.
    const codigo = await fs.readFile(path.join(workspaceDepois.project, 'src', 'Motion.tsx'), 'utf8');
    expect(codigo).toContain('Garanta a sua hoje');
    expect(codigo).toContain('Oferta de setembro');

    // O render final do update é a version 2 — e a V1 continua nos registros
    // (§41: nova versão nunca sobrescreve a anterior).
    const renders = estado.renders.filter((render) => render.motionId === MOTION_ID);
    expect(renders.some((render) => render.version === 2 && render.quality === 'final')).toBe(true);
    expect(renders.some((render) => render.version === 1 && render.quality === 'final')).toBe(true);
    expect(renders.find((render) => render.version === 2 && render.quality === 'final')?.storageUrl).toContain(
      '/v2/final.mp4',
    );

    // E o MP4 da V2 existe no disco.
    const final = await fs.stat(path.join(workspaceDepois.output, 'final.mp4'));
    expect(final.size).toBeGreaterThan(1024);
  }, 300_000);

  it('OPUS_UNAVAILABLE: provider lançando MotionModelUnavailableError derruba o job SEM registrar render nenhum', async () => {
    estado.falha = 'opus';
    const motionId = 'motion-versioning-opus-down';

    const erro = await runMotionPipeline({ motionId, mode: 'create', deps: { logger } }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(Error);
    expect((erro as { code?: string }).code).toBe('OPUS_UNAVAILABLE');
    expect(estado.statusGravados).toContainEqual({ motionId, status: 'failed', errorCode: 'OPUS_UNAVAILABLE' });
    // Nenhum render registrado: peça sem Opus 5.5 não existe, nem parcial.
    expect(estado.renders.some((render) => render.motionId === motionId)).toBe(false);
  }, 120_000);

  it('erro genérico do agente vira CODEGEN_FAILED e também não registra render', async () => {
    estado.falha = 'generica';
    const motionId = 'motion-versioning-codegen-erro';

    const erro = await runMotionPipeline({ motionId, mode: 'create', deps: { logger } }).catch((e: unknown) => e);

    expect((erro as { code?: string }).code).toBe('CODEGEN_FAILED');
    expect(estado.statusGravados).toContainEqual({ motionId, status: 'failed', errorCode: 'CODEGEN_FAILED' });
    expect(estado.renders.some((render) => render.motionId === motionId)).toBe(false);
  }, 120_000);
});
