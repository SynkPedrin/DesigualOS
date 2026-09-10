import { fetchWithRetry, extractComboOptions } from './comfyui-client';
import { MODEL_REGISTRY, type ModelRegistryEntry } from './model-registry';
import { WORKFLOW_REGISTRY } from './workflow-registry';

/**
 * Item 27/28 do plano de evolução do Studio: nunca aceitar job de um
 * workflow cujo grafo depende de um class_type ou arquivo de modelo que a
 * build atual do ComfyUI não tem. Atualização do ComfyUI renomeia inputs
 * sem aviso (é o modo de falha mais comum de um pipeline automatizado) - e
 * como a máquina roda no Pinokio, alguém pode clicar "update" e derrubar
 * meio pipeline sem querer.
 *
 * Roda uma vez na subida do processo (ver index.ts). Falha ALTO e CLARO:
 * lista exatamente o que está faltando, não tenta adivinhar substituto.
 */

interface ObjectInfoField {
  input?: { required?: Record<string, [unknown, ...unknown[]]>; optional?: Record<string, [unknown, ...unknown[]]> };
}

const LOADER_INPUT_FIELD: Record<ModelRegistryEntry['loader'], string> = {
  UNETLoader: 'unet_name',
  CLIPLoader: 'clip_name',
  DualCLIPLoader: 'clip_name1',
  VAELoader: 'vae_name',
  UnetLoaderGGUF: 'unet_name',
  LoraLoaderModelOnly: 'lora_name',
  UpscaleModelLoader: 'model_name',
};

export interface ComfyUIValidationResult {
  ok: boolean;
  comfyuiVersion: string | null;
  missingClassTypes: string[];
  missingModelFiles: { modelId: string; loader: string; file: string }[];
  checkedAt: string;
}

/**
 * Valida TODOS os class_type usados por QUALQUER workflow do registry (não só
 * os enabled) e todo arquivo de modelo de QUALQUER entrada enabled=true do
 * Model Registry, contra o /object_info real da instância configurada.
 * Não decide sozinho o que fazer com o resultado - quem chama decide se
 * aborta a subida ou só loga (ver index.ts).
 */
export async function validateComfyUIInstallation(baseUrl: string): Promise<ComfyUIValidationResult> {
  const checkedAt = new Date().toISOString();

  let comfyuiVersion: string | null = null;
  try {
    const statsResponse = await fetchWithRetry(`${baseUrl}/system_stats`, undefined, 2);
    if (statsResponse.ok) {
      const stats = (await statsResponse.json()) as { system?: { comfyui_version?: string } };
      comfyuiVersion = stats.system?.comfyui_version ?? null;
    }
  } catch {
    // versão é só telemetria - segue a validação mesmo sem ela
  }

  const allClassTypes = new Set<string>();
  for (const workflow of Object.values(WORKFLOW_REGISTRY)) {
    for (const classType of workflow.requiredClassTypes) allClassTypes.add(classType);
  }

  const objectInfoResponse = await fetchWithRetry(`${baseUrl}/object_info`, undefined, 2);
  if (!objectInfoResponse.ok) {
    throw new Error(`ComfyUI /object_info falhou (${objectInfoResponse.status}) - não dá pra validar a instalação`);
  }
  const objectInfo = (await objectInfoResponse.json()) as Record<string, ObjectInfoField>;

  const missingClassTypes = [...allClassTypes].filter((classType) => {
    const entry = objectInfo[classType];
    // Node "instalado mas sem inputs" retorna {} vazio pro class_type -
    // trata como ausente (é o comportamento real observado pro
    // UltimateSDUpscale/MiniMaxH3AddGuide na GPU de produção).
    return !entry || Object.keys(entry).length === 0;
  });

  const missingModelFiles: { modelId: string; loader: string; file: string }[] = [];
  for (const model of Object.values(MODEL_REGISTRY)) {
    if (!model.enabled) continue;
    const field = LOADER_INPUT_FIELD[model.loader];
    const spec = objectInfo[model.loader]?.input?.required?.[field];
    const options = extractComboOptions(spec);
    if (!options || !options.includes(model.file)) {
      missingModelFiles.push({ modelId: model.id, loader: model.loader, file: model.file });
    }
    if (model.file2) {
      const field2spec = objectInfo[model.loader]?.input?.required?.['clip_name2'];
      const options2 = extractComboOptions(field2spec);
      if (!options2 || !options2.includes(model.file2)) {
        missingModelFiles.push({ modelId: model.id, loader: model.loader, file: model.file2 });
      }
    }
  }

  return {
    ok: missingClassTypes.length === 0 && missingModelFiles.length === 0,
    comfyuiVersion,
    missingClassTypes,
    missingModelFiles,
    checkedAt,
  };
}

export function formatValidationReport(result: ComfyUIValidationResult): string {
  if (result.ok) {
    return `ComfyUI validado OK (versão ${result.comfyuiVersion ?? 'desconhecida'}, checado ${result.checkedAt}): todos os class_types e arquivos de modelo enabled do registry existem na instância.`;
  }
  const lines = [`ComfyUI validation FALHOU (versão ${result.comfyuiVersion ?? 'desconhecida'}, checado ${result.checkedAt}):`];
  if (result.missingClassTypes.length > 0) {
    lines.push(`  class_types ausentes: ${result.missingClassTypes.join(', ')}`);
  }
  for (const missing of result.missingModelFiles) {
    lines.push(`  modelo ausente: ${missing.modelId} espera "${missing.file}" em ${missing.loader}, mas não está na lista real de opções`);
  }
  return lines.join('\n');
}
