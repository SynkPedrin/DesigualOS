import path from 'node:path';
import { bundle } from '@remotion/bundler';
import type { MotionWorkspace } from '../workspace/workspace.js';
import { MotionError } from '../errors.js';

/**
 * §22 — build/check antes de gastar render.
 *
 * O bundle é onde erro de TypeScript, import inexistente e dependência que o
 * agente inventou aparecem. Rodar isto antes do render é o que transforma
 * "falhou depois de 4 minutos de vídeo" em "falhou em 20 segundos, com a
 * mensagem exata pra consertar".
 */
export interface BundleResult {
  serveUrl: string;
  durationMs: number;
}

export async function bundleMotion(workspace: MotionWorkspace): Promise<BundleResult> {
  const started = Date.now();
  const entryPoint = path.join(workspace.project, 'src', 'index.ts');

  try {
    const serveUrl = await bundle({
      entryPoint,
      // publicDir é de onde staticFile() lê. Os assets do cliente foram
      // COPIADOS pra cá (§11): o original no Supabase nunca é tocado.
      publicDir: path.join(workspace.project, 'public'),
      // Sem onProgress: o progresso do webpack não diz nada pra quem está no
      // chat, e §39 manda esconder a máquina.
      webpackOverride: (config) => config,
    });
    return { serveUrl, durationMs: Date.now() - started };
  } catch (error) {
    throw new MotionError('BUILD_FAILED', 'O projeto do motion não compilou.', {
      detail: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
      cause: error,
    });
  }
}
