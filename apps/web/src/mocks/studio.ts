import type { StudioAssetWire, StudioJobDetailWire, StudioJobType } from '@/lib/api/contracts';
import { pushMockNotification } from './notifications';

let jobSeq = 723880;
function nextJobId() {
  jobSeq += 1;
  return `STU-${jobSeq}`;
}

/** The real backend also returns SVG placeholders (no GPU integrated yet), this mirrors
 * that honestly instead of pretending a photorealistic render exists. */
function placeholderSvgDataUrl(label: string, colorVar: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="100%" height="100%" fill="#1c1c1e" />
    <rect x="24" y="24" width="552" height="552" fill="none" stroke="${colorVar}" stroke-width="2" stroke-dasharray="8 8" />
    <text x="300" y="300" fill="${colorVar}" font-family="monospace" font-size="22" text-anchor="middle">${label}</text>
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

export function createStudioJob(
  clientId: string,
  type: StudioJobType,
  prompt: string,
  resolution: string | null,
): StudioJobDetailWire {
  const job: StudioJobDetailWire = {
    job_id: nextJobId(),
    status: 'queued',
    progress: 0,
    type,
    prompt,
    resolution: resolution ?? '',
    asset_url: null,
  };
  studioJobStore.set(job.job_id, job);
  simulateJobProgress(job.job_id, clientId, type, prompt);
  return job;
}

function simulateJobProgress(jobId: string, clientId: string, type: StudioJobType, prompt: string) {
  const steps = [
    { delay: 500, progress: 10, status: 'rendering' as const },
    { delay: 1400, progress: 50, status: 'rendering' as const },
    { delay: 2400, progress: 80, status: 'rendering' as const },
    { delay: 3400, progress: 100, status: 'completed' as const },
  ];

  for (const step of steps) {
    setTimeout(() => {
      const job = studioJobStore.get(jobId);
      if (!job) return;
      job.progress = step.progress;
      job.status = step.status;
      if (step.status === 'completed') {
        const assetUrl = placeholderSvgDataUrl(prompt.slice(0, 40) || type, TYPE_COLOR[type]);
        job.asset_url = assetUrl;
        mockStudioAssets.unshift({
          id: `asset-${jobId}`,
          client_id: clientId,
          type,
          filename: `${jobId.toLowerCase()}.svg`,
          storage_url: assetUrl,
          prompt,
          model: 'stub-svg-v1',
          created_by: 'Instituto Almada',
          node_id: 'NODE_STUDIO_MOCK',
          created_at: new Date().toISOString(),
        });
        pushMockNotification(
          'studio.job.completed',
          'Seu conteúdo no Studio ficou pronto',
          prompt ? `"${prompt.slice(0, 140)}" já está na galeria.` : 'Já está na galeria.',
          `/studio?asset=asset-${jobId}`,
        );
      }
    }, step.delay);
  }
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const mockStudioAssets: StudioAssetWire[] = [
  {
    id: 'asset-1',
    client_id: 'client-clinica-x',
    type: 'carousel',
    filename: 'carrossel-setembro.svg',
    storage_url: placeholderSvgDataUrl('Carrossel Setembro', TYPE_COLOR.carousel),
    prompt: 'Carrossel de 5 slides sobre check-up de outono',
    created_at: minutesAgo(240),
  },
  {
    id: 'asset-2',
    client_id: 'client-grupo-vertice',
    type: 'reels',
    filename: 'reels-lancamento.svg',
    storage_url: placeholderSvgDataUrl('Reels Lançamento', TYPE_COLOR.reels),
    prompt: 'Reels de 15s anunciando a nova coleção',
    created_at: minutesAgo(600),
  },
  {
    id: 'asset-3',
    client_id: 'client-loja-boreal',
    type: 'image',
    filename: 'banner-promo.svg',
    storage_url: placeholderSvgDataUrl('Banner Promo', TYPE_COLOR.image),
    prompt: 'Banner estático para promoção de fim de semana',
    created_at: minutesAgo(1200),
  },
];
