import type { StudioAsset, StudioJobDetail } from '@/lib/api/contracts';
import { fetchStudioJobDetail } from '@/hooks/use-studio-jobs';
import { downloadAssetsAsZip } from '@/lib/zip-download';
import { useStudioFormStore } from '@/stores/studio-form-store';
import { useUiStore } from '@/stores/ui-store';
import { toast } from '@/stores/toast-store';

/** Assets antigos podem não ter job_id: sintetiza um detail mínimo a partir do
 * próprio asset pra Duplicar/Editar funcionarem mesmo assim. */
function detailFromAsset(asset: StudioAsset): StudioJobDetail {
  return {
    jobId: asset.jobId ?? asset.id,
    status: 'completed',
    progress: 100,
    type: asset.type,
    prompt: asset.prompt,
    resolution: '',
    error: null,
    attachments: [],
    assetUrl: asset.storageUrl,
    assetUrls: null,
    caption: asset.caption,
    style: asset.style,
    variations: null,
    clientId: asset.clientId,
    qualityPreset: asset.qualityPreset,
    numSlides: asset.slidesTotal,
    includeText: null,
    durationSeconds: null,
    referenceImages: null,
    ultra: false,
  };
}

async function resolveJobDetail(asset: StudioAsset): Promise<StudioJobDetail> {
  if (asset.jobId) {
    try {
      return await fetchStudioJobDetail(asset.jobId);
    } catch {
      // Cai no fallback do asset abaixo: job deletado ou backend sem o registro.
    }
  }
  return detailFromAsset(asset);
}

/** Fora do Studio (ex: workspace do cliente), as ações de "carregar no form"
 * abrem o StudioModal global — nenhum botão fica morto em nenhum contexto. */
function focusStudioPanel(insideStudio: boolean) {
  useStudioFormStore.getState().requestPanelFocus();
  if (!insideStudio) useUiStore.getState().setStudioModalOpen(true);
}

/** Duplicar / Editar projeto: busca a config original do job e preenche o painel. */
export async function loadProjectIntoStudio(asset: StudioAsset, insideStudio: boolean) {
  const detail = await resolveJobDetail(asset);
  useStudioFormStore.getState().loadFromJob(detail, asset.clientId);
  focusStudioPanel(insideStudio);
  toast('Configurações carregadas no Studio.', 'success');
}

/** Usar como referência: a storage_url entra em reference_images do form (máx 16). */
export function useAssetAsReference(asset: StudioAsset, insideStudio: boolean) {
  useStudioFormStore.getState().addReferenceImage(asset.storageUrl);
  focusStudioPanel(insideStudio);
  toast('Asset adicionado como referência do próximo projeto.', 'success');
}

/** Download real: grupo (carousel) vira .zip client-side; asset único baixa como blob. */
export async function downloadStudioGroup(group: StudioAsset[]): Promise<void> {
  const first = group[0]!;
  if (group.length > 1) {
    await downloadAssetsAsZip(
      group.map((asset) => ({ url: asset.storageUrl, filename: asset.filename })),
      `studio-${first.jobId ?? first.id}.zip`,
    );
    return;
  }
  const response = await fetch(first.storageUrl);
  if (!response.ok) throw new Error(`Falha ao baixar ${first.filename}`);
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = first.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
