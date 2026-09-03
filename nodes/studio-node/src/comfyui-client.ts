import { randomUUID } from 'node:crypto';

/**
 * 28 passos em vez de 20. Medido na RTX 4090 com o mesmo prompt/seed: 20
 * passos entregava fogo difuso e figuras sem forma; 28 entrega chama, folha
 * de palmeira e pessoa definidas, por ~6s a mais. É o degrau de qualidade
 * que o Endrigo pediu ao mandar a referência cinematográfica. É o PISO —
 * nunca ofereça um preset de qualidade abaixo disso (ver STEPS_BY_QUALITY).
 */
const FLUX_STEPS = 28;

/**
 * Preset "Qualidade" (pedido do usuário, 2026-09-03) mapeado pra passos do
 * KSampler. 'draft' não existe aqui de propósito — ficar abaixo de 28 é o
 * que a medição acima mostrou que degrada a imagem. 'high' soma passos
 * extras (ganho de detalhe com retorno decrescente, prática comum em
 * difusão) mas isso NÃO foi medido nesta GPU como o valor de 28 foi — ajuste
 * se alguém comparar de verdade contra a máquina real.
 */
const STEPS_BY_QUALITY: Record<'standard' | 'high', number> = {
  standard: FLUX_STEPS,
  high: 36,
};

export function stepsForQuality(preset: string | null | undefined): number {
  return preset === 'high' ? STEPS_BY_QUALITY.high : STEPS_BY_QUALITY.standard;
}

/**
 * O caminho até o ComfyUI atravessa a rede (Tailscale, ou um túnel SSH em
 * desenvolvimento). Queda transitória acontece — medido de verdade: um
 * download de ~1,8MB do /view morreu com `read ECONNRESET` no meio e
 * derrubou o job inteiro, mesmo com a imagem já gerada na GPU.
 *
 * Perder minutos de GPU por um soluço de rede é inaceitável, então toda
 * chamada passa por aqui. Só reoperação de LEITURA/idempotente: o /prompt
 * (que enfileira de verdade) fica de fora, senão um retry viraria duas
 * gerações cobradas.
 */
async function fetchWithRetry(url: string | URL, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }
  throw lastError;
}

export interface ComfyUIConfig {
  baseUrl: string;
  checkpointName: string;
}

/**
 * Grafo real (não inventado): extraído do próprio histórico de execução do
 * ComfyUI do Studio (prompt_id aa8b40cd..., rodado de verdade em produção),
 * removendo só o ramo de ControlNet/imagem de referência (nós 5/6/7/8 do
 * original), que exige uma imagem de entrada que a geração simples "por
 * texto" do Studio não tem. Fluxo: checkpoint -> texto positivo/negativo ->
 * FluxGuidance -> latente vazio -> KSampler -> VAEDecode -> SaveImage.
 */
function buildFluxTextToImageGraph(params: {
  checkpointName: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix: string;
  steps: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: params.checkpointName } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: params.prompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: '' } },
    '4': { class_type: 'FluxGuidance', inputs: { conditioning: ['2', 0], guidance: 3.5 } },
    '9': { class_type: 'EmptySD3LatentImage', inputs: { width: params.width, height: params.height, batch_size: 1 } },
    '10': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['3', 0],
        latent_image: ['9', 0],
        seed: params.seed,
        steps: params.steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['1', 2] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: params.filenamePrefix } },
  };
}

/**
 * Mesma cadeia do texto->imagem, trocando o latente VAZIO por um latente
 * ENCODADO a partir da imagem de referência (LoadImage -> VAEEncode) e com
 * `denoise` < 1 no KSampler. É isso que faz a referência guiar de verdade:
 * denoise 1.0 apagaria a imagem toda e cairia em texto->imagem de novo.
 *
 * `denoise` 0.80 foi CALIBRADO na RTX 4090 real, não chutado. Medido com a
 * mesma referência e o prompt "carro azul na neve":
 *   0.65 -> referência domina e o prompt é IGNORADO (voltou o carro vermelho
 *           no pôr do sol da referência: inaceitável, a pessoa pediu outra coisa);
 *   0.80 -> mantém enquadramento/ângulo/perspectiva E obedece o prompt
 *           (neve no chão e no carro, carro azul) <- escolhido;
 *   0.90 -> obedece o prompt mas perde a referência (outro ângulo, outra rua).
 */
function buildFluxImageToImageGraph(params: {
  checkpointName: string;
  prompt: string;
  seed: number;
  filenamePrefix: string;
  referenceImageName: string;
  denoise: number;
  steps: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: params.checkpointName } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: params.prompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: '' } },
    '4': { class_type: 'FluxGuidance', inputs: { conditioning: ['2', 0], guidance: 3.5 } },
    '5': { class_type: 'LoadImage', inputs: { image: params.referenceImageName } },
    '6': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['1', 2] } },
    '10': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['3', 0],
        latent_image: ['6', 0],
        seed: params.seed,
        steps: params.steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: params.denoise,
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['1', 2] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: params.filenamePrefix } },
  };
}

/**
 * Sobe a imagem de referência pro ComfyUI (POST /upload/image) e devolve o
 * nome que o LoadImage precisa. O ComfyUI só lê imagem do disco dele, não
 * aceita URL — por isso o arquivo do Storage é baixado e reenviado.
 */
export async function uploadReferenceImage(baseUrl: string, imageUrl: string, filename: string): Promise<string> {
  const download = await fetchWithRetry(imageUrl);
  if (!download.ok) {
    throw new Error(`Não consegui baixar a referência (${download.status}): ${imageUrl}`);
  }
  const bytes = Buffer.from(await download.arrayBuffer());

  // Nome único: o ComfyUI sobrescreve/renomeia arquivos de mesmo nome, e um
  // job pegando a referência de outro seria um bug silencioso e horrível.
  const safeName = `desigual-ref-${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes)]), safeName);
  form.append('overwrite', 'true');

  const response = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`ComfyUI /upload/image falhou (${response.status}): ${await response.text()}`);
  }
  const uploaded = (await response.json()) as { name: string; subfolder?: string };
  return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
}

interface HistoryEntry {
  status: { completed: boolean; status_str: string };
  outputs: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

/**
 * Cliente HTTP direto pro ComfyUI real do Studio (porta 8188, confirmada
 * rodando via Pinokio). Não mexe em nada na máquina: só consome a API HTTP
 * que já está exposta lá, do jeito que o processo de criação de verdade já
 * funciona (mesmo checkpoint, mesmos parâmetros de sampler do histórico
 * real de execução).
 */
export async function generateImageViaComfyUI(
  config: ComfyUIConfig,
  params: {
    prompt: string;
    width: number;
    height: number;
    referenceImage?: { url: string; filename: string } | undefined;
    steps?: number;
  },
): Promise<Buffer> {
  const clientId = randomUUID();
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const steps = params.steps ?? FLUX_STEPS;

  // Com referência anexada o caminho é img2img (a imagem guia o resultado);
  // sem ela, texto->imagem puro.
  const graph = params.referenceImage
    ? buildFluxImageToImageGraph({
        checkpointName: config.checkpointName,
        prompt: params.prompt,
        seed,
        filenamePrefix: 'desigual-os-studio',
        referenceImageName: await uploadReferenceImage(config.baseUrl, params.referenceImage.url, params.referenceImage.filename),
        denoise: 0.80,
        steps,
      })
    : buildFluxTextToImageGraph({
        checkpointName: config.checkpointName,
        prompt: params.prompt,
        width: params.width,
        height: params.height,
        seed,
        steps,
        filenamePrefix: 'desigual-os-studio',
      });

  const submitResponse = await fetch(`${config.baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  if (!submitResponse.ok) {
    throw new Error(`ComfyUI /prompt failed (${submitResponse.status}): ${await submitResponse.text()}`);
  }
  const submitted = (await submitResponse.json()) as { prompt_id: string; node_errors?: Record<string, unknown> };
  if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
    throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(submitted.node_errors)}`);
  }

  const entry = await pollHistory(config.baseUrl, submitted.prompt_id);
  const saveImageOutput = Object.values(entry.outputs).find((output) => output.images && output.images.length > 0);
  const image = saveImageOutput?.images?.[0];
  if (!image) {
    throw new Error(`ComfyUI job ${submitted.prompt_id} completed without an image output`);
  }

  const viewUrl = new URL(`${config.baseUrl}/view`);
  viewUrl.searchParams.set('filename', image.filename);
  viewUrl.searchParams.set('subfolder', image.subfolder);
  viewUrl.searchParams.set('type', image.type);
  const imageResponse = await fetchWithRetry(viewUrl);
  if (!imageResponse.ok) {
    throw new Error(`ComfyUI /view failed (${imageResponse.status}) for ${image.filename}`);
  }
  return Buffer.from(await imageResponse.arrayBuffer());
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function pollHistory(baseUrl: string, promptId: string): Promise<HistoryEntry> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetchWithRetry(`${baseUrl}/history/${promptId}`, undefined, 2);
    if (response.ok) {
      const history = (await response.json()) as Record<string, HistoryEntry>;
      const entry = history[promptId];
      if (entry?.status.completed) {
        if (entry.status.status_str !== 'success') {
          throw new Error(`ComfyUI job ${promptId} finished with status '${entry.status.status_str}'`);
        }
        return entry;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`ComfyUI job ${promptId} did not complete within ${POLL_TIMEOUT_MS}ms`);
}

/**
 * Confirma qual checkpoint de verdade está disponível no ComfyUI agora, em
 * vez de fixar um nome de arquivo (o histórico real usava
 * "flux1-dev-fp8.safetensors", mas o que está instalado hoje na pasta de
 * modelos é "flux2_dev_fp8mixed.safetensors"; nomes de arquivo de modelo
 * mudam, então resolve isso na hora em vez de arriscar um nome parado).
 */
export async function resolveCheckpointName(baseUrl: string, preferredSubstring: string): Promise<string> {
  const response = await fetchWithRetry(`${baseUrl}/object_info/CheckpointLoaderSimple`);
  if (!response.ok) {
    throw new Error(`ComfyUI /object_info failed (${response.status})`);
  }
  const info = (await response.json()) as {
    CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } };
  };
  const options = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  if (options.length === 0) {
    throw new Error('ComfyUI has no checkpoints installed in models/checkpoints');
  }
  const preferred = options.find((name) => name.toLowerCase().includes(preferredSubstring.toLowerCase()));
  return preferred ?? options[0]!;
}
