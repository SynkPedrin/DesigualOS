import { describe, expect, it } from 'vitest';
import { assessCreativeCopy } from './anti-generic';

describe('assessCreativeCopy (§74) — porta determinística anti-genérico', () => {
  it('reprova headline dominada por clichê sem âncora', () => {
    const r = assessCreativeCopy('Transforme seu negócio e leve sua empresa para o próximo nível');
    expect(r.generic).toBe(true);
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
    expect(r.reason).toMatch(/qualquer marca/);
  });

  it('reprova um clichê isolado em copy curta sem âncora', () => {
    expect(assessCreativeCopy('A solução completa que você merece').generic).toBe(true);
  });

  it('NÃO reprova copy específica com marca e número, mesmo com um clichê', () => {
    const r = assessCreativeCopy(
      'A 3Net entrega internet de 850 Mega por R$89,99: a solução completa para a sua casa toda conectada em Araçatuba',
      { brandTerms: ['3Net'] },
    );
    expect(r.generic).toBe(false);
    expect(r.hasSpecificAnchor).toBe(true);
  });

  it('NÃO reprova copy criativa sem clichê', () => {
    const r = assessCreativeCopy('Sexta-feira é dia de casal: leve a pizza, a gente leva o resto');
    expect(r.generic).toBe(false);
    expect(r.hits).toEqual([]);
  });
});

/**
 * Saída REAL dos modelos instalados no node do Otto (Mac mini 8GB), medida em
 * 15/09/2026. As duas passavam batido pela régua antiga: os clichês não
 * estavam na lista e um número INVENTADO ("2023", "30 minutos por dia") fazia
 * a copy parecer ancorada.
 */
describe('saída real dos modelos do node (regressão)', () => {
  it('qwen2.5:3b — "Descubra seu potencial" com ano inventado reprova', () => {
    const r = assessCreativeCopy(
      'Premium Academia: Início Gratuito para Profissionais em 2023. Descubra seu potencial. Primeiro mês grátis.',
      { brandTerms: ['Nexa Fit'] },
    );
    expect(r.generic).toBe(true);
  });

  it('llama3.2:3b — "Desperte o seu potencial" com duração inventada reprova', () => {
    const r = assessCreativeCopy(
      'Desperte o seu potencial com exclusividade. Experiência a perfeição em apenas 30 minutos por dia, sem comprometimentos.',
      { brandTerms: ['Nexa Fit'] },
    );
    expect(r.generic).toBe(true);
  });

  it('número sozinho NÃO resgata copy com clichê', () => {
    expect(assessCreativeCopy('Desperte seu potencial em 30 dias.').generic).toBe(true);
  });

  it('copy que cita a marca e é específica continua aprovada', () => {
    const r = assessCreativeCopy(
      'Na Nexa Fit o treino cabe entre duas reuniões: 45 minutos, sem fila de aparelho, com professor na sala.',
      { brandTerms: ['Nexa Fit'] },
    );
    expect(r.generic).toBe(false);
  });
});
