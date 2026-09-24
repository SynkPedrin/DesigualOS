import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Logger } from '@desigual-os/logging';
import { COMPOSITION_ID } from './scaffold.js';
import { QUALITY_PRESETS, type MotionQuality } from '../types.js';
import type { MotionWorkspace } from '../workspace/workspace.js';
import { MotionError } from '../errors.js';

/**
 * Baixa o Chrome Headless Shell na primeira vez. O Remotion cuida disso
 * sozinho; chamar explicitamente serve pra que o download aconteça no
 * estágio "preparando", e não no meio do render, virando um timeout
 * inexplicável na primeira execução da máquina.
 *
 * FFmpeg do sistema NÃO é necessário: o @remotion/renderer traz o próprio
 * compositor (binário Rust). Confirmado nesta máquina, que não tem ffmpeg
 * instalado.
 */
let browserReady: Promise<void> | undefined;
export function ensureRenderBrowser(): Promise<void> {
  browserReady ??= ensureBrowser().then(() => undefined);
  return browserReady;
}


/**
 * Dimensão que o encoder REALMENTE produz ao escalar.
 *
 * H.264 exige largura e altura pares, e o Remotion arredonda pra baixo. Medido:
 * um 1080x1920 a scale 0.375 sai 404x720, não 405x720. Sem esta conta, o QA
 * técnico reprovava o próprio preview por 1 pixel — e um QA que acusa defeito
 * onde não há é pior que QA nenhum, porque ensina a ignorá-lo.
 */
export function encodedDimension(value: number, scale: number): number {
  return Math.floor((value * scale) / 2) * 2;
}

/** Escala do preview: altura ~720 (§23), nunca ampliando. */
export function previewScale(compositionHeight: number): number {
  return Math.min(1, 720 / compositionHeight);
}

export interface RenderResult {
  file: string;
  quality: MotionQuality;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  durationSeconds: number;
  sizeBytes: number;
  renderTimeMs: number;
}

export interface RenderOptions {
  workspace: MotionWorkspace;
  serveUrl: string;
  quality: MotionQuality;
  logger: Logger;
  onProgress?: ((percent: number) => void) | undefined;
  /**
   * Erro de runtime do motion, visto do console do browser (cena com
   * undefined, asset que não carregou). O QA técnico (§25) precisa da lista,
   * e um callback é o jeito honesto de entregá-la: embrulhar o logger do pino
   * com spread perderia os métodos do protótipo e quebraria na primeira
   * chamada a `logger.info`.
   */
  onRuntimeError?: ((text: string) => void) | undefined;
}

export async function renderMotion(options: RenderOptions): Promise<RenderResult> {
  const { workspace, serveUrl, quality, logger } = options;
  await ensureRenderBrowser();
  const started = Date.now();

  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID }).catch((error: unknown) => {
    throw new MotionError('BUILD_FAILED', 'Não encontrei a composição do motion no projeto.', {
      detail: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  });

  const preset = QUALITY_PRESETS[quality];
  const scale = quality === 'preview' ? previewScale(composition.height) : 1;
  const directory = quality === 'preview' ? workspace.previews : workspace.output;
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${quality}.mp4`);

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: file,
      crf: preset.crf,
      // §23 — preview desce pra ~720 de altura. O scale sai da altura real da
      // composição, não de um 720/1920 fixo, que estaria errado num 1:1.
      scale,
      // O erro de runtime do motion (undefined em cena, asset faltando)
      // aparece AQUI, no browser. Sem este handler ele vira log solto e o
      // render segue produzindo frames quebrados em silêncio.
      onBrowserLog: (log) => {
        if (log.type !== 'error') return;
        options.onRuntimeError?.(log.text);
        logger.warn({ motionId: workspace.motionId, text: log.text }, 'Motion: erro de runtime no render');
      },
      ...(options.onProgress ? { onProgress: ({ progress }) => options.onProgress?.(progress) } : {}),
    });
  } catch (error) {
    throw new MotionError('RENDER_FAILED', 'O render apresentou um problema.', {
      detail: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
      cause: error,
    });
  }

  const stat = await fs.stat(file);
  return {
    file,
    quality,
    width: encodedDimension(composition.width, scale),
    height: encodedDimension(composition.height, scale),
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
    durationSeconds: composition.durationInFrames / composition.fps,
    sizeBytes: stat.size,
    renderTimeMs: Date.now() - started,
  };
}

export interface ExtractedFrame {
  file: string;
  /** Caminho relativo ao projeto — é o que vai no prompt pro agente ler. */
  relativePath: string;
  frame: number;
  timeSeconds: number;
}

/**
 * §24 — frames para a revisão visual.
 *
 * `renderStill` em vez de extrair do MP4 com ffmpeg: o PNG sai do MESMO
 * bundle, em resolução cheia e sem perda de compressão. Quadro comprimido a
 * CRF 28 mentiria justamente sobre o que se quer julgar (contraste, borda de
 * texto, qualidade da foto).
 *
 * Os frames vão pra dentro do projeto porque o `--restricted` confina o
 * agente ao cwd dele, que é o diretório do projeto — fora dali ele não
 * conseguiria abrir os PNGs.
 */
export async function extractReviewFrames(params: {
  workspace: MotionWorkspace;
  serveUrl: string;
  count?: number;
}): Promise<ExtractedFrame[]> {
  const { workspace, serveUrl } = params;
  await ensureRenderBrowser();
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID });

  const count = params.count ?? 8;
  const directory = path.join(workspace.project, 'qa-frames');
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(workspace.frames, { recursive: true });

  const frames: ExtractedFrame[] = [];
  const last = composition.durationInFrames - 1;
  for (let index = 0; index < count; index += 1) {
    // Distribuição que inclui as pontas: o primeiro e o último quadro são
    // onde mais aparece defeito (peça que abre em preto, peça que corta o
    // CTA no fim) e uma distribuição só no meio nunca os veria.
    const frame = Math.round((last * index) / Math.max(1, count - 1));
    const name = `frame_${String(index).padStart(2, '0')}_${frame}.png`;
    const file = path.join(directory, name);
    await renderStill({ composition, serveUrl, output: file, frame, scale: 1 });
    // Cópia no workspace.frames (fora do projeto) pra ficar no rastro do job
    // mesmo se o projeto for limpo depois.
    await fs.copyFile(file, path.join(workspace.frames, name)).catch(() => undefined);
    frames.push({
      file,
      relativePath: path.posix.join('qa-frames', name),
      frame,
      timeSeconds: frame / composition.fps,
    });
  }
  return frames;
}
