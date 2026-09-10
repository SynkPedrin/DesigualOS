import type { CreativeSpec } from '@desigual-os/types';
import { isWorkflowAvailable } from './workflow-registry';

/**
 * Workflow Router (seção 2 do plano de evolução). Só decide entre os
 * workflows de IMAGEM (t2i/i2i/edit) - vídeo tem staging próprio
 * (keyframe -> H3 Draft -> H3 Master, seção 17), não um único workflow id;
 * ver video-router.ts. `finish_*` também não é escolhido aqui - é
 * escolhido depois, pelo Finish Router (finish.ts:selectFinishStrategy),
 * sobre o resultado já gerado.
 */
export type ImageWorkflowId =
  | 't2i_flux2_editorial_v1'
  | 't2i_flux2_native_v2'
  | 'i2i_flux2_reference_v1'
  | 'edit_flux2_multireference_v2'
  | 'edit_flux_kontext_v1';

export interface WorkflowRouteDecision {
  workflowId: ImageWorkflowId;
  available: boolean;
  /** Preenchido quando available=false - por que, e o que o chamador deve fazer (ex.: cair pro I2I, ou falhar honesto). */
  unavailableReason?: string | undefined;
}

export function selectStudioWorkflow(spec: CreativeSpec, ctx: { hasReferenceImage: boolean; prompt?: string | null }): WorkflowRouteDecision {
  let workflowId: ImageWorkflowId;
  if (ctx.hasReferenceImage || spec.operation === 'variation' || spec.operation === 'edit') {
    // FLUX.2 Dev já é um modelo de edição e composição multi-reference. O
    // fluxo Kontext antigo permanece no registro só para reprodutibilidade.
    workflowId = 'edit_flux2_multireference_v2';
  } else {
    workflowId = 't2i_flux2_native_v2';
  }

  const availability = isWorkflowAvailable(workflowId);
  return { workflowId, available: availability.available, unavailableReason: availability.reason };
}
