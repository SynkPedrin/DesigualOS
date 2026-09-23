import { describe, expect, it } from 'vitest';
import { detectCarouselRepetition, formatCarouselQualityNote } from './carousel-quality.js';
import type { CarouselPlan } from './schemas.js';

function slide(index: number, copy: string, narrative_function: CarouselPlan['slides'][number]['narrative_function'] = 'development'): CarouselPlan['slides'][number] {
  return { index, narrative_function, objective: 'o', copy, visual: 'v', composition: 'c', layout: 'l', image_prompt: 'p' };
}

function plan(slides: CarouselPlan['slides']): CarouselPlan {
  return { concept: 'x', slide_count: slides.length, slides };
}

describe('detectCarouselRepetition (Otto Senior V1, carousel quality — independente de skill externa)', () => {
  /**
   * REGRESSÃO REAL (certificação não-vídeo, LaunchDesk/SaaS): o carrossel
   * real repetiu o par "Antes:"/"Depois:" duas vezes (slides 5-6 e 8-9),
   * cada par com vocabulário quase todo distinto — a repetição é de
   * ESTRUTURA (mesmo rótulo reaparecendo), não de vocabulário.
   */
  it('teste 10: detecta rótulo "Antes:"/"Depois:" reaparecendo em pares diferentes de slides (achado ao vivo real)', () => {
    const carrossel = plan([
      slide(1, 'Você já parou pra calcular quanto tempo suas tarefas repetitivas roubam de você?', 'hook'),
      slide(2, 'Gerentes de produto gastam horas semanais configurando tarefas repetitivas manualmente.'),
      slide(3, 'Líderes de squads também gastam muito tempo configurando tarefas repetitivas.'),
      slide(5, 'Antes: Configuração manual de tarefas repetitivas leva horas.'),
      slide(6, 'Depois: Automatização rápida e fácil com a nova função. Configuração em menos de dois minutos.'),
      slide(8, 'Antes: Sempre precisando revisar e reconfigurar tarefas repetitivas manualmente.'),
      slide(9, 'Depois: Tarefas recorrentes automatizadas. Sem necessidade de revisar manualmente.', 'cta'),
    ]);
    const issues = detectCarouselRepetition(carrossel);
    expect(issues.some((i) => i.finding === 'REPEATED_IDEA' && i.detail.includes('antes'))).toBe(true);
    expect(issues.some((i) => i.finding === 'REPEATED_IDEA' && i.detail.includes('depois'))).toBe(true);
  });

  it('detecta duas slides pagando a mesma ideia por similaridade de vocabulário, mesmo sem rótulo repetido', () => {
    const carrossel = plan([
      slide(1, 'Configurar tarefas recorrentes manualmente toma tempo valioso do seu time de produto.'),
      slide(2, 'Sua equipe de produto perde tempo valioso configurando tarefas recorrentes manualmente toda semana.'),
    ]);
    const issues = detectCarouselRepetition(carrossel);
    expect(issues.some((i) => i.finding === 'REPEATED_IDEA')).toBe(true);
  });

  it('carrossel com progressão real (cada slide introduz algo novo) não dispara REPEATED_IDEA', () => {
    const carrossel = plan([
      slide(1, 'Você sabia que configurar tarefas recorrentes manualmente consome em média 3 horas por semana?', 'hook'),
      slide(2, 'Cada squad recria a mesma lista de tarefas toda segunda-feira, sem nenhuma automação.'),
      slide(3, 'A nova função de automação de recorrências cria essas tarefas sozinha, sem configuração manual.'),
      slide(4, 'Configurar leva menos de 2 minutos e já está disponível em todos os planos pagos.'),
      slide(5, 'Isso libera o time pra focar no que realmente importa: entregar o roadmap.', 'cta'),
    ]);
    const issues = detectCarouselRepetition(carrossel);
    expect(issues.filter((i) => i.finding === 'REPEATED_IDEA')).toEqual([]);
  });

  it('teste CTA genérico: "marca 5 amigos" no slide de CTA é sinalizado', () => {
    const carrossel = plan([
      slide(1, 'Hook', 'hook'),
      slide(2, 'Marca 5 amigos que precisam ver isso!', 'cta'),
    ]);
    const issues = detectCarouselRepetition(carrossel);
    expect(issues.some((i) => i.finding === 'GENERIC_CTA')).toBe(true);
  });

  it('CTA específico (não genérico) não é sinalizado', () => {
    const carrossel = plan([
      slide(1, 'Hook', 'hook'),
      slide(2, 'Ative a automação de recorrências hoje mesmo, direto no seu workspace.', 'cta'),
    ]);
    const issues = detectCarouselRepetition(carrossel);
    expect(issues.some((i) => i.finding === 'GENERIC_CTA')).toBe(false);
  });

  it('formatCarouselQualityNote instrui reescrever só os slides apontados, com progressão', () => {
    const carrossel = plan([
      slide(1, 'Antes: processo lento e manual.'),
      slide(2, 'Antes: mesma dor, outras palavras.'),
    ]);
    const note = formatCarouselQualityNote(detectCarouselRepetition(carrossel));
    expect(note).toMatch(/introduzir uma informação, prova ou ângulo NOVO/);
  });
});
