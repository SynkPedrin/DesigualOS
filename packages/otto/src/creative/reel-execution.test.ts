import { describe, expect, it } from 'vitest';
import { formatReelExecutionNote, validateReelExecution } from './reel-execution.js';
import type { VideoPlan, VideoScene } from './schemas.js';

function scene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    duration_seconds: 3,
    camera_movement: 'push-in lento',
    subject_movement: 'o corretor caminha até a porta e a abre com um gesto firme',
    environment: 'fachada do stand de vendas ao entardecer',
    lighting: 'luz quente de fim de tarde',
    transition: 'corte no movimento da mão',
    pacing: 'direto',
    ...overrides,
  };
}

function plan(scenes: VideoScene[], overrides: Partial<VideoPlan> = {}): VideoPlan {
  return {
    concept: 'x',
    duration: scenes.reduce((t, s) => t + (s.duration_seconds ?? 0), 0),
    aspect_ratio: '9:16',
    scenes,
    sound_direction: 'trilha leve',
    text_overlays: [],
    cta: 'Saiba mais',
    generation_prompts: scenes.map(() => 'a prompt'),
    ...overrides,
  };
}

describe('validateReelExecution (Otto Elite, Reel Execution Engine)', () => {
  // teste 1: "Visual: None" literal
  it('teste 1: cena com direção visual "None" literal é sinalizada (real estate)', () => {
    const issues = validateReelExecution(plan([scene({ subject_movement: 'None', environment: 'None' })]));
    expect(issues.some((i) => i.finding === 'LITERAL_NONE_VISUAL')).toBe(true);
  });

  it('detecta variações vazias/"nenhum" também, não só a palavra exata "None"', () => {
    const issues = validateReelExecution(plan([scene({ subject_movement: 'nenhum', environment: '-' })]));
    expect(issues.some((i) => i.finding === 'LITERAL_NONE_VISUAL')).toBe(true);
  });

  // teste 2: cena só de tipografia com direção real de verdade — não deve ser sinalizada
  it('teste 2: cena de tipografia com direção real (fundo, composição, timing) NÃO é sinalizada (SaaS)', () => {
    const issues = validateReelExecution(
      plan([
        scene({
          subject_movement: 'nenhum sujeito em cena; texto entra em escala de 85% para 100%, centralizado',
          environment: 'fundo off-white limpo, composição tipográfica',
          camera_movement: 'estático',
          transition: 'wipe horizontal seguido de corte seco no beat da trilha',
        }),
      ]),
    );
    expect(issues.some((i) => i.finding === 'LITERAL_NONE_VISUAL')).toBe(false);
  });

  // teste 3: seis cenas estáticas idênticas
  it('teste 3: seis cenas estáticas idênticas disparam STATIC_SEQUENCE + MECHANICAL_TIMING + LOW_VISUAL_VARIETY + LOW_RETENTION_STRUCTURE (restaurante)', () => {
    const seisCenas = Array.from({ length: 6 }, () =>
      scene({ camera_movement: 'estático', duration_seconds: 5, shot_type: 'wide' }),
    );
    const issues = validateReelExecution(plan(seisCenas));
    const findings = new Set(issues.map((i) => i.finding));
    expect(findings.has('STATIC_SEQUENCE')).toBe(true);
    expect(findings.has('MECHANICAL_TIMING')).toBe(true);
    expect(findings.has('LOW_VISUAL_VARIETY')).toBe(true);
    expect(findings.has('LOW_RETENTION_STRUCTURE')).toBe(true);
  });

  // teste 4: durações mecânicas iguais, mas câmera variada (isola MECHANICAL_TIMING de STATIC_SEQUENCE)
  it('teste 4: durações idênticas em toda cena disparam MECHANICAL_TIMING mesmo com câmera variada (moda)', () => {
    const cenas = [
      scene({ duration_seconds: 4, camera_movement: 'tracking lateral' }),
      scene({ duration_seconds: 4, camera_movement: 'push-in' }),
      scene({ duration_seconds: 4, camera_movement: 'macro em detalhe do tecido' }),
    ];
    const issues = validateReelExecution(plan(cenas));
    expect(issues.some((i) => i.finding === 'MECHANICAL_TIMING')).toBe(true);
    expect(issues.some((i) => i.finding === 'STATIC_SEQUENCE')).toBe(false);
  });

  // teste 5: sequência variada e executável — sem nenhum achado
  it('teste 5: sequência dinâmica, variada e executável não dispara achado nenhum (serviço - clínica odontológica)', () => {
    const cenas = [
      scene({ duration_seconds: 2, camera_movement: 'push-in rápido', subject_movement: 'a paciente sorri ao ver o resultado no espelho', shot_type: 'portrait' }),
      scene({ duration_seconds: 3, camera_movement: 'tracking lateral', subject_movement: 'a dentista explica o procedimento apontando para o raio-x na tela', shot_type: 'action' }),
      scene({ duration_seconds: 1.5, camera_movement: 'macro', subject_movement: 'detalhe do instrumental esterilizado sendo organizado', shot_type: 'detail', transition: 'match cut no movimento da mão' }),
      scene({ duration_seconds: 2.5, camera_movement: 'pull-back', subject_movement: 'a paciente sai do consultório sorrindo, câmera revela a recepção', shot_type: 'wide', transition: 'corte seco no beat da trilha' }),
    ];
    const issues = validateReelExecution(plan(cenas));
    expect(issues).toEqual([]);
  });

  // teste 6: ação do sujeito ausente/curta demais
  it('teste 6: ação do sujeito curta demais é sinalizada como MISSING_SUBJECT_ACTION (real estate)', () => {
    const issues = validateReelExecution(plan([scene({ subject_movement: 'casal' })]));
    expect(issues.some((i) => i.finding === 'MISSING_SUBJECT_ACTION')).toBe(true);
  });

  // teste 7: transição sem informação real
  it('teste 7: transição genérica ("transição dinâmica") sem dizer o quê é sinalizada (SaaS)', () => {
    const issues = validateReelExecution(plan([scene({ transition: 'transição dinâmica' })]));
    expect(issues.some((i) => i.finding === 'MISSING_TRANSITION')).toBe(true);
  });

  it('transição vazia/"nenhuma" também é sinalizada', () => {
    const issues = validateReelExecution(plan([scene({ transition: 'nenhuma' })]));
    expect(issues.some((i) => i.finding === 'MISSING_TRANSITION')).toBe(true);
  });

  it('câmera ausente/vazia é sinalizada como MISSING_CAMERA_DIRECTION', () => {
    const issues = validateReelExecution(plan([scene({ camera_movement: 'n/a' })]));
    expect(issues.some((i) => i.finding === 'MISSING_CAMERA_DIRECTION')).toBe(true);
  });

  it('direção de placeholder genérico ("cena dinâmica", "imagem bonita") é sinalizada como NON_EXECUTABLE_VISUAL (restaurante)', () => {
    const issues = validateReelExecution(
      plan([scene({ subject_movement: 'cena dinâmica do ambiente do restaurante', environment: 'imagem bonita da cozinha' })]),
    );
    expect(issues.some((i) => i.finding === 'NON_EXECUTABLE_VISUAL')).toBe(true);
  });

  it('formatReelExecutionNote lista cada achado e instrui reparo estritamente de execução, preservando conceito/copy', () => {
    const issues = validateReelExecution(plan([scene({ subject_movement: 'None', environment: 'None' })]));
    const note = formatReelExecutionNote(issues);
    expect(note).toMatch(/Preserve o conceito, a copy e a mensagem já aprovados/);
    expect(note).toMatch(/cena 1/);
  });

  it('não sinaliza LOW_VISUAL_VARIETY com menos de 4 cenas (janela mínima)', () => {
    const cenas = [scene({ shot_type: 'wide' }), scene({ shot_type: 'wide' }), scene({ shot_type: 'wide' })];
    const issues = validateReelExecution(plan(cenas));
    expect(issues.some((i) => i.finding === 'LOW_VISUAL_VARIETY')).toBe(false);
  });
});
