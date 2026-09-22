import { describe, expect, it } from 'vitest';
import { buildRubric, rubricToPrompt, type Rubric } from './rubric';
import { deriveCriticalRegions, parseContentClassification, reconcile, type ContentClassification } from './content-classifier';
import {
  buildMask, classifyProblem, isValidRegion, maskToPixels, prioritize, routeCorrection, scopeFor,
  MIN_CONFIDENCE_TO_CORRECT, type ClassifiedProblem,
} from './correction-router';
import { applyRegressionGuard, type PairwiseResult } from './pairwise';
import { resolveFlags } from './config';

function content(over: Partial<ContentClassification> = {}): ContentClassification {
  return {
    content_type: 'product_ad', contains_people: false, contains_face: false, contains_hands: false,
    contains_product: true, contains_logo: false, contains_text: false, contains_environment: true,
    contains_vehicle: false, contains_food: false, contains_architecture: false,
    confidence: 0.95, critical_regions: [], latencyMs: 1, ...over,
  };
}

describe('ContentClassifier', () => {
  it('deriva regiões críticas do que existe, não do briefing', () => {
    expect(deriveCriticalRegions(content({ contains_product: true }) as never)).toEqual(['product']);
    expect(deriveCriticalRegions(content({ contains_face: true, contains_hands: true }) as never)).toEqual(['face', 'hands', 'product']);
  });

  it('reconcilia rosto/mão implicando pessoa (o modelo às vezes esquece)', () => {
    const r = reconcile(content({ contains_face: true, contains_people: false }));
    expect(r.contains_people).toBe(true);
  });

  it('rejeita payload fora do schema em vez de aceitar nota inventada', () => {
    expect(() => parseContentClassification({ content_type: 'nao_existe' }, 1)).toThrow();
  });
});

describe('RubricBuilder', () => {
  /** A causa raiz do falso negativo da fase 2. */
  it('NÃO inclui mão/rosto/anatomia numa foto de produto sem gente', () => {
    const r = buildRubric(content());
    expect(r.applicable).not.toContain('hands');
    expect(r.applicable).not.toContain('face');
    expect(r.applicable).not.toContain('body_anatomy');
    expect(r.notApplicable).toContain('hands');
  });

  it('inclui identidade e rosto num retrato, e marca como críticos', () => {
    const r = buildRubric(content({ content_type: 'portrait', contains_people: true, contains_face: true, contains_hands: true, contains_product: false }));
    expect(r.applicable).toEqual(expect.arrayContaining(['identity', 'face', 'eyes', 'skin', 'hair', 'hands']));
    expect(r.critical).toEqual(expect.arrayContaining(['identity', 'face', 'hands']));
  });

  it('branding/editorial ganha hierarquia e layout', () => {
    const r = buildRubric(content({ content_type: 'branding_editorial', contains_logo: true, contains_text: true }));
    expect(r.applicable).toEqual(expect.arrayContaining(['hierarchy', 'layout', 'color_consistency', 'logo', 'text']));
  });

  it('o prompt diz explicitamente o que NÃO avaliar (senão o modelo inventa)', () => {
    const p = rubricToPrompt(buildRubric(content()));
    expect(p).toContain('NOT APPLICABLE');
    expect(p).toMatch(/hands/);
  });

  it('dimensões sempre aplicáveis não dependem de conteúdo', () => {
    const vazio = buildRubric(content({ contains_product: false, contains_environment: false }));
    expect(vazio.applicable).toEqual(expect.arrayContaining(['prompt_alignment', 'composition', 'lighting', 'artifact_level']));
  });
});

describe('Region / Mask', () => {
  it('aceita região normalizada válida', () => {
    expect(isValidRegion({ x: 0.6, y: 0.4, width: 0.2, height: 0.2 })).toBe(true);
  });

  it('rejeita região que estoura a imagem, degenerada ou fora de 0..1', () => {
    expect(isValidRegion({ x: 0.9, y: 0.1, width: 0.5, height: 0.2 })).toBe(false);
    expect(isValidRegion({ x: 0.1, y: 0.1, width: 0, height: 0.2 })).toBe(false);
    expect(isValidRegion({ x: -0.1, y: 0.1, width: 0.2, height: 0.2 })).toBe(false);
    expect(isValidRegion(null)).toBe(false);
  });

  it('a máscara ganha folga mas nunca sai da imagem', () => {
    const m = buildMask({ x: 0.02, y: 0.02, width: 0.1, height: 0.1 })!;
    expect(m.x).toBe(0);
    expect(m.x + m.width).toBeLessThanOrEqual(1);
  });

  it('recusa máscara que viraria "regenerar quase tudo"', () => {
    expect(buildMask({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })).toBeNull();
  });

  /**
   * Caso real (17/09/2026): a caixa de UMA mão, com o teto antigo de 0.6,
   * virou máscara de 0,54x0,67 e o inpaint alterou o tênis - o pairwise
   * reprovou por regressão de product_fidelity. Máscara desse tamanho não
   * é correção local.
   */
  it('recusa a máscara que na prática alterou o produto', () => {
    expect(buildMask({ x: 0.18, y: 0, width: 0.42, height: 0.55 })).toBeNull();
  });

  it('ainda aceita uma máscara genuinamente local', () => {
    expect(buildMask({ x: 0.62, y: 0.43, width: 0.19, height: 0.31 })).not.toBeNull();
  });

  it('converte para pixels alinhados à grade do Flux', () => {
    const px = maskToPixels({ x: 0.5, y: 0.5, width: 0.25, height: 0.25, feather: 0.25 }, 1000, 1000);
    expect(px.width % 16).toBe(0);
    expect(px.height % 16).toBe(0);
  });
});

describe('ProblemClassifier', () => {
  it('classifica pela descrição, não pelo rótulo errado do modelo', () => {
    const p = classifyProblem({ description: "The father's left hand has fused fingers", severity: 'high', confidence: 0.9, region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } });
    expect(p.type).toBe('HAND');
    expect(p.scope).toBe('LOCAL');
  });

  it('sem região válida, problema local vira global (não há onde mascarar)', () => {
    const p = classifyProblem({ description: 'fused fingers', severity: 'high', confidence: 0.9, region: null });
    expect(p.region).toBeNull();
    expect(p.scope).toBe('GLOBAL');
  });

  it('composição é sempre global', () => {
    expect(scopeFor('COMPOSITION', { x: 0, y: 0, width: 0.1, height: 0.1 })).toBe('GLOBAL');
  });

  it('caixa que cobre quase tudo não é defeito local', () => {
    expect(scopeFor('HAND', { x: 0, y: 0, width: 0.9, height: 0.9 })).toBe('GLOBAL');
  });

  it('descrição desconhecida vira OTHER, não um palpite', () => {
    expect(classifyProblem({ description: 'algo estranho aqui', severity: 'low', confidence: 0.9, region: null }).type).toBe('OTHER');
  });
});

describe('CorrectionRouter', () => {
  const base = (over: Partial<ClassifiedProblem> = {}): ClassifiedProblem => ({
    type: 'HAND', scope: 'LOCAL', severity: 'high', confidence: 0.9,
    region: { x: 0.6, y: 0.4, width: 0.2, height: 0.2 }, description: 'fused fingers', ...over,
  });

  it('mão local vai para inpaint local', () => {
    const r = routeCorrection(base());
    expect(r.action).toBe('LOCAL_INPAINT');
    expect(r.workflow).toBe('inpaint_flux2_local_v1');
  });

  it('texto e logo vão para o compositor, nunca para o modelo redesenhar', () => {
    expect(routeCorrection(base({ type: 'TEXT', scope: 'LOCAL' })).action).toBe('COMPOSITOR');
    expect(routeCorrection(base({ type: 'LOGO', scope: 'LOCAL' })).action).toBe('COMPOSITOR');
  });

  it('só COMPOSITION autoriza regeneração global', () => {
    expect(routeCorrection(base({ type: 'COMPOSITION', scope: 'GLOBAL', region: null })).action).toBe('GLOBAL_REGENERATE');
    expect(routeCorrection(base({ type: 'HAND', scope: 'GLOBAL', region: null })).action).toBe('NO_AUTOMATIC_CORRECTION');
  });

  it('confiança baixa preserva o original', () => {
    const r = routeCorrection(base({ confidence: MIN_CONFIDENCE_TO_CORRECT - 0.01 }));
    expect(r.action).toBe('NO_AUTOMATIC_CORRECTION');
    expect(r.reason).toMatch(/[Cc]onfian/);
  });

  it('tipo sem ferramenta não é corrigido às cegas', () => {
    for (const t of ['LIGHTING', 'COLOR', 'IDENTITY', 'ARTIFACT', 'OTHER'] as const) {
      expect(routeCorrection(base({ type: t })).action).toBe('NO_AUTOMATIC_CORRECTION');
    }
  });

  it('prioriza o mais grave e com região definida', () => {
    const ordered = prioritize([
      base({ severity: 'low', description: 'a' }),
      base({ severity: 'high', description: 'b' }),
      base({ severity: 'medium', description: 'c' }),
    ]);
    expect(ordered.map((p) => p.description)).toEqual(['b', 'c', 'a']);
  });
});

describe('RegressionGuard', () => {
  const rubric: Rubric = { applicable: ['identity', 'face', 'hands'], notApplicable: [], critical: ['identity', 'face'], contentType: 'portrait' };
  const pw = (over: Partial<PairwiseResult> = {}): PairwiseResult => ({
    winner: 'B', confidence: 0.9, target_issue_fixed: true, target_issue_improvement: 0.8,
    regressions: [], reason: 'ok', model: 'test', latencyMs: 1, ...over,
  });

  it('aceita B quando corrigiu o alvo e nada piorou', () => {
    expect(applyRegressionGuard({ pairwise: pw(), rubric }).acceptB).toBe(true);
  });

  /** O caso que define a fase: mão melhorou, rosto piorou -> mantém A. */
  it('rejeita B com regressão crítica, mesmo tendo corrigido o alvo', () => {
    const d = applyRegressionGuard({ pairwise: pw({ regressions: [{ dimension: 'face', severity: 'critical', note: 'rosto mudou' }] }), rubric });
    expect(d.acceptB).toBe(false);
    expect(d.criticalRegressions).toContain('face');
  });

  it('regressão "moderate" numa dimensão crítica da rubrica bloqueia', () => {
    const d = applyRegressionGuard({ pairwise: pw({ regressions: [{ dimension: 'identity', severity: 'moderate', note: 'parece outra pessoa' }] }), rubric });
    expect(d.acceptB).toBe(false);
  });

  it('regressão menor fora do crítico não bloqueia', () => {
    const d = applyRegressionGuard({ pairwise: pw({ regressions: [{ dimension: 'background', severity: 'minor', note: 'fundo um pouco mais escuro' }] }), rubric });
    expect(d.acceptB).toBe(true);
  });

  it('não corrigiu o alvo -> rollback', () => {
    expect(applyRegressionGuard({ pairwise: pw({ target_issue_fixed: false }), rubric }).acceptB).toBe(false);
  });

  it('empate mantém a original', () => {
    expect(applyRegressionGuard({ pairwise: pw({ winner: 'tie' }), rubric }).acceptB).toBe(false);
  });

  it('A vencendo mantém a original', () => {
    expect(applyRegressionGuard({ pairwise: pw({ winner: 'A' }), rubric }).acceptB).toBe(false);
  });

  it('confiança baixa mantém a original', () => {
    expect(applyRegressionGuard({ pairwise: pw({ confidence: 0.4 }), rubric }).acceptB).toBe(false);
  });
});

describe('Feature flags', () => {
  it('AUTO_CORRECTION nasce desligada mesmo com a flag legada ligada', () => {
    const f = resolveFlags({ STUDIO_AUTONOMOUS_QA: true });
    expect(f.autoCorrection).toBe(false);
    expect(f.visualQA).toBe(true);
    expect(f.autoUpscale).toBe(true);
  });

  it('pairwise é obrigatório por padrão, mesmo sem a flag legada', () => {
    expect(resolveFlags({ STUDIO_AUTONOMOUS_QA: false }).pairwiseValidation).toBe(true);
  });

  it('declaração explícita vence a herança', () => {
    const f = resolveFlags({ STUDIO_AUTONOMOUS_QA: true, STUDIO_AUTO_UPSCALE: 'false', STUDIO_AUTO_CORRECTION: 'true' });
    expect(f.autoUpscale).toBe(false);
    expect(f.autoCorrection).toBe(true);
  });

  it('flag legada desligada mantém tudo desligado, menos o pairwise', () => {
    const f = resolveFlags({ STUDIO_AUTONOMOUS_QA: false });
    expect([f.visualQA, f.autoUpscale, f.autoCorrection]).toEqual([false, false, false]);
  });
});
