import { randomUUID } from 'node:crypto';
import { fetchWithRetry, uploadImageBuffer, interruptComfyUI } from './comfyui-client';

/**
 * Modelo de upscale confirmado instalado no ComfyUI da RTX (object_info
 * UpscaleModelLoader). RealESRGAN_x4 é o default: 4x genérico, serve pra
 * foto e arte. `metadata.upscale_model` no job sobrescreve (ex.:
 * '4x-UltraSharp.pth' pra arte mais nítida, 'RealESRGAN_x2.pth' pra 2x).
 */
const DEFAULT_UPSCALE_MODEL = 'RealESRGAN_x4.pth';

interface UpscaleGraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

function buildUpscaleGraph(params: { imageName: string; modelName: string; filenamePrefix: string }): Record<string, UpscaleGraphNode> {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: params.imageName } },
    '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: params.modelName } },
    '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
    '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: params.filenamePrefix } },
  };
}

interface UpscaleHistoryEntry {
  status: { completed: boolean; status_str: string };
  outputs: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

export async function upscaleImageViaComfyUI(params: {
  baseUrl: string;
  /** Imagem a ampliar: Buffer já baixado ou URL pra baixar. */
  image: Buffer | { url: string; filename: string };
  modelName?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<Buffer> {
  const modelName = params.modelName ?? DEFAULT_UPSCALE_MODEL;
  const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000;
  const pollIntervalMs = params.pollIntervalMs ?? 3_000;

  let imageBytes: Buffer;
  let imageFilename: string;
  if (Buffer.isBuffer(params.image)) {
    imageBytes = params.image;
    imageFilename = 'upscale-source.png';
  } else {
    const download = await fetchWithRetry(params.image.url);
    if (!download.ok) {
      throw new Error(`Não consegui baixar a imagem pro upscale (${download.status}): ${params.image.url}`);
    }
    imageBytes = Buffer.from(await download.arrayBuffer());
    imageFilename = params.image.filename;
  }

  const uploadedName = await uploadImageBuffer(params.baseUrl, imageBytes, imageFilename);

  const graph = buildUpscaleGraph({
    imageName: uploadedName,
    modelName,
    filenamePrefix: 'desigual-os-studio-upscale',
  });

  const clientId = randomUUID();
  const submitResponse = await fetch(`${params.baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  if (!submitResponse.ok) {
    throw new Error(`ComfyUI /prompt failed (${submitResponse.status}): ${await submitResponse.text()}`);
  }
  const submitted = (await submitResponse.json()) as { prompt_id: string; node_errors?: Record<string, unknown> };
  if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
    throw new Error(`ComfyUI rejected the upscale workflow: ${JSON.stringify(submitted.node_errors)}`);
  }

  const entry = await pollUpscaleHistory(params.baseUrl, submitted.prompt_id, timeoutMs, pollIntervalMs);
  const saveImageOutput = Object.values(entry.outputs).find((output) => output.images && output.images.length > 0);
  const image = saveImageOutput?.images?.[0];
  if (!image) {
    throw new Error(`ComfyUI job ${submitted.prompt_id} completed without an image output`);
  }

  const viewUrl = new URL(`${params.baseUrl}/view`);
  viewUrl.searchParams.set('filename', image.filename);
  viewUrl.searchParams.set('subfolder', image.subfolder);
  viewUrl.searchParams.set('type', image.type);
  const imageResponse = await fetchWithRetry(viewUrl);
  if (!imageResponse.ok) {
    throw new Error(`ComfyUI /view failed (${imageResponse.status}) for ${image.filename}`);
  }
  return Buffer.from(await imageResponse.arrayBuffer());
}

async function pollUpscaleHistory(baseUrl: string, promptId: string, timeoutMs: number, intervalMs: number): Promise<UpscaleHistoryEntry> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchWithRetry(`${baseUrl}/history/${promptId}`, undefined, 2);
    if (response.ok) {
      const history = (await response.json()) as Record<string, UpscaleHistoryEntry>;
      const entry = history[promptId];
      if (entry?.status.completed) {
        if (entry.status.status_str !== 'success') {
          throw new Error(`ComfyUI upscale job ${promptId} finished with status '${entry.status.status_str}'`);
        }
        return entry;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  // Sem isso o job fica "queue_running" pra sempre no ComfyUI e trava toda
  // fila seguinte (mesmo bug do pollHistory genérico - ver comfyui-client.ts).
  await interruptComfyUI(baseUrl);
  throw new Error(`ComfyUI upscale job ${promptId} did not complete within ${timeoutMs}ms`);
}
