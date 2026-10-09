import { describe, expect, it } from 'vitest';
import { CLASSE_DE_PRIORIDADE, classificarPrioridade } from './prioridade-de-tarefa';

describe('classificarPrioridade', () => {
  it('reconhece os textos que as nossas próprias fixtures usam', () => {
    expect(classificarPrioridade('urgente')).toBe('alta');
    expect(classificarPrioridade('alta')).toBe('alta');
    expect(classificarPrioridade('normal')).toBe('media');
  });

  it('reconhece os textos em inglês, porque o workspace escolhe o idioma', () => {
    expect(classificarPrioridade('High')).toBe('alta');
    expect(classificarPrioridade('medium')).toBe('media');
    expect(classificarPrioridade('Low')).toBe('baixa');
  });

  it('devolve null para ausência de prioridade, em vez de um nível chutado', () => {
    expect(classificarPrioridade(null)).toBeNull();
    expect(classificarPrioridade(undefined)).toBeNull();
    expect(classificarPrioridade('   ')).toBeNull();
  });

  /** O ponto da heurística: texto que não casa NÃO vira "média". Um workspace
   *  que escreva "P1" seria classificado errado, e errado com cor é pior que
   *  sem cor, porque parece apurado. */
  it('devolve null para texto que não reconhece, e nunca um balde padrão', () => {
    expect(classificarPrioridade('P1')).toBeNull();
    expect(classificarPrioridade('bloqueador')).toBeNull();
  });

  it('tem uma classe de cor para cada nível e para a ausência de nível', () => {
    expect(CLASSE_DE_PRIORIDADE[classificarPrioridade('urgente') ?? 'nenhuma']).toContain('erro');
    expect(CLASSE_DE_PRIORIDADE[classificarPrioridade('P1') ?? 'nenhuma']).toContain('nevoa');
  });
});
