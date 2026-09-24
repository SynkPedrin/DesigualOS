import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@desigual-os/logging';
import type { MotionAsset } from './types.js';
import { safeAssetName, type MotionWorkspace } from '../workspace/workspace.js';

/**
 * §11 — a pasta do cliente é FONTE. Nunca é escrita, nunca é renomeada,
 * nunca é apagada.
 *
 * O download aqui é a materialização literal dessa regra: o que o agente
 * enxerga é uma CÓPIA dentro do workspace do job. Mesmo que ele tente
 * apagar tudo (e o sandbox o confina ao workspace justamente pra isso), o
 * logo original no Supabase segue intacto.
 *
 * A cópia cai em `project/public/assets/`, que é de onde o `staticFile()` do
 * Remotion lê. Ter um único lugar evita a classe inteira de bug "o arquivo
 * existe mas o render não acha".
 */
const MAX_ASSET_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 45_000;

export interface PreparedAssets {
  assets: MotionAsset[];
  failed: { filename: string; reason: string }[];
}

export async function prepareAssets(params: {
  workspace: MotionWorkspace;
  assets: readonly MotionAsset[];
  logger: Logger;
}): Promise<PreparedAssets> {
  const { workspace, assets, logger } = params;
  const publicAssets = path.join(workspace.project, 'public', 'assets');
  await fs.mkdir(publicAssets, { recursive: true });
  await fs.mkdir(workspace.assets, { recursive: true });

  const prepared: MotionAsset[] = [];
  const failed: { filename: string; reason: string }[] = [];

  for (const asset of assets) {
    const name = safeAssetName(asset.sourceUrl, asset.filename);
    const destination = path.join(publicAssets, name);
    try {
      const bytes = await download(asset.sourceUrl);
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        failed.push({ filename: asset.filename, reason: `arquivo acima de ${MAX_ASSET_BYTES / 1024 / 1024}MB` });
        continue;
      }
      await fs.writeFile(destination, bytes);
      // Cópia no rastro do job, fora do projeto: sobrevive a uma limpeza do
      // projeto e documenta que material entrou nesta peça.
      await fs.copyFile(destination, path.join(workspace.assets, name)).catch(() => undefined);
      prepared.push({
        ...asset,
        localPath: destination,
        projectPath: path.posix.join('assets', name),
        sizeBytes: bytes.byteLength,
      });
    } catch (error) {
      // §47-N — asset ausente não derruba o job. A peça é feita com o que
      // existe, e o que faltou é relatado. Abortar tudo porque uma foto de 25
      // saiu do ar seria pior pra quem pediu.
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ filename: asset.filename, reason });
      logger.warn({ motionId: workspace.motionId, filename: asset.filename, reason }, 'Motion: asset indisponível');
    }
  }

  return { assets: prepared, failed };
}

async function download(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
