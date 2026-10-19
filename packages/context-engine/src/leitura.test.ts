import { describe, expect, it } from 'vitest';
import { explicarAusencia, falhou, indisponivel, leituraAconteceu, leu, proibido } from './leitura';

/**
 * O contrato existe pra impedir UMA coisa: sete situações diferentes virando a
 * mesma tela vazia. Estes casos travam a distinção.
 */
describe('contrato de leitura', () => {
  const base = { source: 'postgres:memories', scope: 'cliente:cosentino' };

  it('linha existe -> OK', () => {
    expect(leu([1, 2], base).status).toBe('OK');
  });

  /** EMPTY é o ÚNICO status que significa "rodou e não tem". */
  it('rodou e não tem -> EMPTY, nunca outro nome', () => {
    const r = leu([], base);
    expect(r.status).toBe('EMPTY');
    expect(r.errorCode).toBeUndefined();
  });

  it('fonte fora do ar não vira vazio', () => {
    const r = indisponivel({ ...base, errorCode: 'TIMEOUT', detail: 'ClickUp não respondeu em 8s' });
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.status).not.toBe('EMPTY');
  });

  it('sem permissão não vira vazio nem erro', () => {
    const r = proibido({ ...base, detail: 'memória privada de outra pessoa' });
    expect(r.status).toBe('FORBIDDEN');
  });

  it('consulta quebrada não vira vazio', () => {
    const r = falhou({ ...base, errorCode: 'SQL_ERROR', detail: 'coluna inexistente' });
    expect(r.status).toBe('FAILED');
  });

  /**
   * Esta é a asserção que importa pra soma: contar UNAVAILABLE como zero é
   * como o sistema dizia "R$ 0,00 faturado" sobre um dado que ele não tem.
   */
  it('só OK e EMPTY contam como leitura realizada', () => {
    expect(leituraAconteceu('OK')).toBe(true);
    expect(leituraAconteceu('EMPTY')).toBe(true);
    expect(leituraAconteceu('UNAVAILABLE')).toBe(false);
    expect(leituraAconteceu('FORBIDDEN')).toBe(false);
    expect(leituraAconteceu('FAILED')).toBe(false);
  });

  it('cada ausência tem uma frase própria, e OK não tem nenhuma', () => {
    expect(explicarAusencia({ status: 'OK', scope: 'x' })).toBeNull();
    const frases = (['EMPTY', 'UNAVAILABLE', 'FORBIDDEN', 'FAILED'] as const).map((status) =>
      explicarAusencia({ status, scope: 'x' }),
    );
    expect(new Set(frases).size, 'as quatro ausências não podem dizer a mesma coisa').toBe(4);
  });

  it('o escopo viaja junto: "vazio" pode ser escopo errado e ninguém veria', () => {
    expect(leu([], { source: 's', scope: 'cliente:errado' }).scope).toBe('cliente:errado');
  });
});
