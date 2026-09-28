import { describe, expect, it } from 'vitest';

/**
 * 28/09/2026, relato da Tammy: TODA recusa do Bento aparecia duas vezes no
 * chat, com ~13s entre elas. Sucesso aparecia uma vez só.
 *
 * Causa: no fim de `processSingleAgentJob`, `status: 'failed'` virava `throw`.
 * Com `attempts: 2` o BullMQ reprocessava o job INTEIRO e a segunda volta
 * gravava a mesma resposta de novo. Só as falhas duplicavam — exatamente o que
 * ela viu.
 *
 * Matar o retry inteiro custaria caro (timeout de rede no meio de uma criação
 * merece outra tentativa), então a regra virou esta, e é ela que estes testes
 * travam. A função abaixo é a MESMA expressão do arquivo de produção; se a de
 * lá mudar sem esta mudar junto, o bug volta calado.
 */

interface Resultado {
  status: 'completed' | 'failed';
  metadata?: { write_envelope?: { retryable?: boolean } };
}

function vaiReprocessar(result: Resultado, tentativa: { feitas: number; maximo: number }): boolean {
  const envelope = result.metadata?.write_envelope;
  const falhaRetentavel = result.status === 'failed' && envelope?.retryable === true;
  return falhaRetentavel && tentativa.feitas + 1 < tentativa.maximo;
}

const PRIMEIRA = { feitas: 0, maximo: 2 };
const ULTIMA = { feitas: 1, maximo: 2 };

describe('resposta entregue não se repete', () => {
  it('recusa entendida (não retentável) encerra o job — é o caso da Tammy', () => {
    // "não identifiquei o que devo alterar", "não consegui mapear o status":
    // o Bento entendeu e respondeu. Repetir só produziria a mesma frase.
    const r: Resultado = { status: 'failed', metadata: { write_envelope: { retryable: false } } };
    expect(vaiReprocessar(r, PRIMEIRA)).toBe(false);
  });

  it('falha sem `retryable` declarado também encerra — na dúvida, não repete', () => {
    expect(vaiReprocessar({ status: 'failed' }, PRIMEIRA)).toBe(false);
    expect(vaiReprocessar({ status: 'failed', metadata: {} }, PRIMEIRA)).toBe(false);
  });

  it('falha transitória AINDA merece retry — não é isso que a gente quer matar', () => {
    const r: Resultado = { status: 'failed', metadata: { write_envelope: { retryable: true } } };
    expect(vaiReprocessar(r, PRIMEIRA)).toBe(true);
  });

  it('mas na ÚLTIMA tentativa a pessoa precisa receber a resposta', () => {
    const r: Resultado = { status: 'failed', metadata: { write_envelope: { retryable: true } } };
    expect(vaiReprocessar(r, ULTIMA)).toBe(false);
  });

  it('sucesso nunca reprocessa', () => {
    expect(vaiReprocessar({ status: 'completed' }, PRIMEIRA)).toBe(false);
  });

  it('agente com attempts: 1 (Jarbas, Suzy) nunca reprocessa, nem em falha transitória', () => {
    const r: Resultado = { status: 'failed', metadata: { write_envelope: { retryable: true } } };
    expect(vaiReprocessar(r, { feitas: 0, maximo: 1 })).toBe(false);
  });
});
