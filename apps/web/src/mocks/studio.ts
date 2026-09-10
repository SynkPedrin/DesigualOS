import type {
  StudioAssetWire,
  StudioJobDetailWire,
  StudioJobRequestWire,
  StudioJobType,
  StudioQualityPreset,
  StudioStyle,
} from '@/lib/api/contracts';
import { pushMockNotification } from './notifications';

let jobSeq = 723880;
function nextJobId() {
  jobSeq += 1;
  return `STU-${jobSeq}`;
}

/** The real backend also returns SVG placeholders (no GPU integrated yet), this mirrors
 * that honestly instead of pretending a photorealistic render exists. */
function placeholderSvgDataUrl(label: string, colorVar: string, width = 600, height = 600) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#1c1c1e" />
    <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="${colorVar}" stroke-width="2" stroke-dasharray="8 8" />
    <text x="${width / 2}" y="${height / 2}" fill="${colorVar}" font-family="monospace" font-size="22" text-anchor="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TYPE_COLOR: Record<StudioJobType, string> = {
  image: '#E1F900',
  carousel: '#9333EA',
  video: '#D946EF',
  reels: '#D946EF',
  upscale: '#8B5CF6',
};

export const studioJobStore = new Map<string, StudioJobDetailWire>();

/** Mirrors GET /studio/jobs?status=active on the real backend: lets Studio restore its
 * "jobs in progress" list when reopened, since only one mock user exists there's no
 * per-user filtering to do here. */
export function listActiveStudioJobIds(): string[] {
  return Array.from(studioJobStore.values())
    .filter((job) => job.status === 'queued' || job.status === 'rendering')
    .map((job) => job.job_id);
}

export function createStudioJob(body: StudioJobRequestWire): StudioJobDetailWire {
  const job: StudioJobDetailWire = {
    job_id: nextJobId(),
    status: 'queued',
    progress: 0,
    type: body.type,
    prompt: body.prompt ?? '',
    resolution: body.resolution ?? '',
    asset_url: null,
    attachments: body.attachments ?? [],
    style: body.style ?? 'padrao',
    variations: body.variations ?? 1,
    client_id: body.client_id,
    quality_preset: body.quality_preset ?? 'standard',
    num_slides: body.num_slides ?? null,
    include_text: body.include_text ?? null,
    duration_seconds: body.duration_seconds ?? null,
    reference_images: body.reference_images ?? null,
    metadata: body.metadata ?? null,
  };
  studioJobStore.set(job.job_id, job);
  simulateJobProgress(job);
  return job;
}

function simulateJobProgress(job: StudioJobDetailWire) {
  const steps = [
    { delay: 500, progress: 10, status: 'rendering' as const },
    { delay: 1400, progress: 50, status: 'rendering' as const },
    { delay: 2400, progress: 80, status: 'rendering' as const },
    { delay: 3400, progress: 100, status: 'completed' as const },
  ];

  for (const step of steps) {
    setTimeout(() => {
      const current = studioJobStore.get(job.job_id);
      if (!current) return;
      current.progress = step.progress;
      current.status = step.status;
      if (step.status === 'completed') {
        completeMockJob(current);
      }
    }, step.delay);
  }
}

/** Gera os assets do job igual o backend: carousel vira N slides ligados por job_id,
 * image com variations vira N assets avulsos do mesmo job, o resto é 1 asset só. */
function completeMockJob(job: StudioJobDetailWire) {
  const color = TYPE_COLOR[job.type];
  const label = job.prompt.slice(0, 40) || job.type;
  const base = {
    client_id: job.client_id ?? '',
    type: job.type,
    prompt: job.prompt,
    model: 'stub-svg-v1',
    created_by: 'Instituto Almada',
    node_id: 'NODE_STUDIO_MOCK',
    quality_preset: job.quality_preset ?? ('standard' as StudioQualityPreset),
    style: job.style ?? ('padrao' as StudioStyle),
    job_id: job.job_id,
  };
  const caption = job.include_text
    ? 'Legenda gerada pelo passo de copy de marketing do Studio.'
    : null;

  const slides = job.type === 'carousel' ? Math.max(1, job.num_slides ?? 5) : 0;
  const variations = job.type === 'image' ? Math.max(1, job.variations ?? 1) : 1;
  const count = slides > 0 ? slides : variations;

  const assetUrls: string[] = [];
  const newAssets: StudioAssetWire[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = count > 1 ? `-${index + 1}` : '';
    const url = placeholderSvgDataUrl(count > 1 ? `${label} (${index + 1}/${count})` : label, color);
    assetUrls.push(url);
    newAssets.push({
      ...base,
      id: `asset-${job.job_id}${suffix}`,
      filename: `${job.job_id.toLowerCase()}${suffix}.svg`,
      storage_url: url,
      caption: index === 0 ? caption : null,
      slide_index: slides > 0 ? index : null,
      slides_total: slides > 0 ? slides : null,
      created_at: new Date().toISOString(),
    });
  }

  job.asset_url = assetUrls[0] ?? null;
  job.asset_urls = assetUrls.length > 1 ? assetUrls : null;
  job.caption = caption;
  mockStudioAssets.unshift(...newAssets);
  pushMockNotification(
    'studio.job.completed',
    'Seu conteúdo no Studio ficou pronto',
    job.prompt ? `"${job.prompt.slice(0, 140)}" já está na galeria.` : 'Já está na galeria.',
    `/studio?asset=${newAssets[0]!.id}`,
  );
}

/** DELETE /studio/jobs/:id — some o job e todos os assets do grupo (cascade). */
export function deleteStudioJob(jobId: string): boolean {
  const existed = studioJobStore.delete(jobId);
  for (let index = mockStudioAssets.length - 1; index >= 0; index -= 1) {
    if (mockStudioAssets[index]!.job_id === jobId) mockStudioAssets.splice(index, 1);
  }
  return existed;
}

/** DELETE /studio/assets/:id — asset avulso. */
export function deleteStudioAsset(assetId: string): boolean {
  const index = mockStudioAssets.findIndex((asset) => asset.id === assetId);
  if (index === -1) return false;
  mockStudioAssets.splice(index, 1);
  return true;
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const SEED_CLIENTS = ['client-clinica-x', 'client-instituto-almada', 'client-grupo-vertice', 'client-loja-boreal'];
const SEED_PROMPTS: Record<StudioJobType, string[]> = {
  image: [
    'Banner estático para promoção de fim de semana',
    'Post único de anúncio de novo serviço',
    'Arte de depoimento de cliente para feed',
    'Imagem de capa para campanha sazonal',
  ],
  carousel: [
    'Carrossel de 5 slides sobre check-up de outono',
    'Carrossel educativo: 6 mitos sobre o tratamento',
    'Carrossel de lançamento da nova coleção',
  ],
  video: ['Vídeo institucional de 30s para o site'],
  reels: [
    'Reels de 15s anunciando a nova coleção',
    'Reels de bastidores com copy de marketing',
  ],
  upscale: [],
};
const SEED_QUALITIES: StudioQualityPreset[] = ['standard', 'high'];
const SEED_STYLES: StudioStyle[] = ['padrao', 'minimalista', 'cinematico', 'editorial', '3d'];

/** Catálogo seed com volume suficiente pra paginação (24/página) e busca fazerem
 * diferença no modo mock: carrosseis viram grupos reais de slides por job_id. */
function buildSeedAssets(): StudioAssetWire[] {
  const assets: StudioAssetWire[] = [];
  let assetSeq = 0;
  let seedJobSeq = 4100;
  let minute = 90;

  const pushAsset = (asset: Omit<StudioAssetWire, 'id' | 'created_at'>) => {
    assetSeq += 1;
    minute += 137;
    assets.push({ ...asset, id: `asset-seed-${assetSeq}`, created_at: minutesAgo(minute) });
  };

  for (const [type, prompts] of Object.entries(SEED_PROMPTS) as [StudioJobType, string[]][]) {
    prompts.forEach((prompt, promptIndex) => {
      const clientId = SEED_CLIENTS[(assetSeq + promptIndex) % SEED_CLIENTS.length]!;
      const quality = SEED_QUALITIES[(assetSeq + promptIndex) % SEED_QUALITIES.length]!;
      const style = SEED_STYLES[(assetSeq + promptIndex) % SEED_STYLES.length]!;
      const color = TYPE_COLOR[type];

      if (type === 'carousel') {
        seedJobSeq += 1;
        const jobId = `STU-${seedJobSeq}`;
        const slidesTotal = 4 + (promptIndex % 3);
        for (let slide = 0; slide < slidesTotal; slide += 1) {
          pushAsset({
            client_id: clientId,
            type,
            filename: `${jobId.toLowerCase()}-${slide + 1}.svg`,
            storage_url: placeholderSvgDataUrl(`${prompt.slice(0, 28)} (${slide + 1}/${slidesTotal})`, color),
            prompt,
            model: 'stub-svg-v1',
            created_by: 'Instituto Almada',
            node_id: 'NODE_STUDIO_MOCK',
            job_id: jobId,
            slide_index: slide,
            slides_total: slidesTotal,
            caption: slide === 0 ? 'Legenda de exemplo gerada junto com o carrossel.' : null,
            quality_preset: quality,
            style,
          });
        }
      } else {
        const count = type === 'image' && promptIndex % 2 === 1 ? 2 : 1;
        seedJobSeq += 1;
        const jobId = `STU-${seedJobSeq}`;
        for (let v = 0; v < count; v += 1) {
          pushAsset({
            client_id: clientId,
            type,
            filename: `${jobId.toLowerCase()}${count > 1 ? `-${v + 1}` : ''}.svg`,
            storage_url: placeholderSvgDataUrl(prompt.slice(0, 32), color),
            prompt,
            model: 'stub-svg-v1',
            created_by: 'Instituto Almada',
            node_id: 'NODE_STUDIO_MOCK',
            job_id: jobId,
            quality_preset: quality,
            style,
          });
        }
      }
    });
  }

  // created_at decresce na ordem de inserção; a API devolve created_at desc.
  return assets.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const mockStudioAssets: StudioAssetWire[] = buildSeedAssets();
