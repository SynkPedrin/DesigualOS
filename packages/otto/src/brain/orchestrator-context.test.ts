import { describe, expect, it } from 'vitest';
import { CONTEXT_BLOCK_MARKER, extractOrchestratorContext, stripOrchestratorContext } from './depth';

/**
 * Regressão de 16/09/2026: o contexto resolvido pelo orquestrador (cliente e
 * campanha, consultados no banco e no ClickUp) vinha só na mensagem do usuário,
 * enquanto o trecho recuperado do vault ia para o system prompt. Prompt de
 * sistema ganha de texto de usuário, e o node escreveu para o cliente que a
 * busca por similaridade trouxe, não para o que o orquestrador tinha resolvido.
 */
describe('extractOrchestratorContext', () => {
  const turno = 'Otto, crie uma legenda para a campanha de aniversário do Jardim Europa 5.';
  const contexto = 'CLIENTE DO TURNO: Cosentino.\n\nCAMPANHA DO TURNO: Europa V (cliente Cosentino).';
  const completa = `${turno}${CONTEXT_BLOCK_MARKER}${contexto}`;

  it('separa o contexto resolvido do turno do usuário', () => {
    expect(extractOrchestratorContext(completa)).toBe(contexto);
    expect(stripOrchestratorContext(completa)).toBe(turno);
  });

  it('as duas metades são complementares e não se perdem', () => {
    expect(stripOrchestratorContext(completa) + CONTEXT_BLOCK_MARKER + extractOrchestratorContext(completa)).toBe(completa);
  });

  it('mensagem sem contexto anexado devolve null, não string vazia', () => {
    expect(extractOrchestratorContext(turno)).toBeNull();
  });

  it('contexto vazio depois do marcador não vira bloco fantasma', () => {
    expect(extractOrchestratorContext(`${turno}${CONTEXT_BLOCK_MARKER}   `)).toBeNull();
  });
});
