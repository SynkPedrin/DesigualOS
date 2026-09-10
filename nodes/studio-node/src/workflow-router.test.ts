import { describe, it, expect } from 'vitest';
import { selectStudioWorkflow } from './workflow-router';

describe('Workflow Router (FLUX.2 nativo)', () => {
  it('routes plain generate with no reference to T2I', () => {
    const decision = selectStudioWorkflow({ operation: 'generate' }, { hasReferenceImage: false });
    expect(decision.workflowId).toBe('t2i_flux2_native_v2');
    expect(decision.available).toBe(true);
  });

  it('routes variation with reference image to native FLUX.2 multi-reference edit', () => {
    const decision = selectStudioWorkflow({ operation: 'variation' }, { hasReferenceImage: true });
    expect(decision.workflowId).toBe('edit_flux2_multireference_v2');
    expect(decision.available).toBe(true);
  });

  it('routes reference image with no explicit operation to I2I by default', () => {
    const decision = selectStudioWorkflow({}, { hasReferenceImage: true });
    expect(decision.workflowId).toBe('edit_flux2_multireference_v2');
  });

  it('routes explicit edit operation to native FLUX.2 editing', () => {
    const decision = selectStudioWorkflow({ operation: 'edit' }, { hasReferenceImage: true });
    expect(decision.workflowId).toBe('edit_flux2_multireference_v2');
    expect(decision.available).toBe(true);
  });

  it('detects edit intent from a "troque só a cor" style prompt with a reference image, even without explicit operation', () => {
    const decision = selectStudioWorkflow({}, { hasReferenceImage: true, prompt: 'troque só a cor do carro para azul' });
    expect(decision.workflowId).toBe('edit_flux2_multireference_v2');
  });

  it('does NOT route to Kontext from prompt text alone without a reference image (edit needs something to edit)', () => {
    const decision = selectStudioWorkflow({}, { hasReferenceImage: false, prompt: 'troque só a cor do carro para azul' });
    expect(decision.workflowId).toBe('t2i_flux2_native_v2');
  });
});
