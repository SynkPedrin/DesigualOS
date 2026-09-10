import { describe, expect, it } from 'vitest';
import { compileFlux2Prompt } from './prompt-quality';
import { resolveReferencePlan } from './reference-plan';

describe('compileFlux2Prompt', () => {
  it('turns maximum fidelity into concrete physical constraints', () => {
    const references = resolveReferencePlan({
      attachments: [{ url: 'https://example.com/local.jpg', filename: 'local.jpg', contentType: 'image/jpeg' }],
    }).modelReferences;
    const result = compileFlux2Prompt({
      prompt: 'adicione um trator ao local',
      spec: {
        qualityProfile: 'master',
        fidelity: { level: 'maximum' },
        preservation: { background: true },
      },
      references,
    });
    expect(result.prompt).toContain('Reference Image 1 (scene)');
    expect(result.prompt).toContain('vanishing points');
    expect(result.prompt).toContain('contact shadows');
    expect(result.prompt).toContain('facial microstructure');
    expect(result.prompt).toContain('rubber, metal, glass, fabric, wood, soil, grass and fur');
  });

  it('keeps the lightweight legacy enrichment for an ordinary standard T2I job', () => {
    const result = compileFlux2Prompt({ prompt: 'um elefante na praia', spec: { qualityProfile: 'standard' }, references: [] });
    expect(result.prompt).toContain('cinematic film still');
  });
});
