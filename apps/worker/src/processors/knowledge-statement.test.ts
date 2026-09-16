import { describe, expect, it } from 'vitest';
import { detectKnowledgeStatement } from './knowledge-statement';

/**
 * Regressão de 16/09/2026: "Decidimos que a comunicação da Cosentino vai
 * priorizar legado e permanência, não preço." caía no loop operacional do Bento
 * e morria em replan_exhausted em 11 segundos — o agente tentava responder
 * operacionalmente uma frase que não perguntava nada.
 *
 * ENSINAR é o fluxo de que a memória inteira depende. Se a frase que registra
 * uma decisão devolve erro, ninguém ensina o sistema duas vezes.
 */
describe('detectKnowledgeStatement', () => {
  it('a frase que quebrou a produção agora é registrada', () => {
    const r = detectKnowledgeStatement(
      'Decidimos que a comunicação da Cosentino vai priorizar legado e permanência, não preço.',
      'Cosentino',
    );
    expect(r).not.toBeNull();
    expect(r!.tipos).toContain('decision');
    expect(r!.answer).toContain('Registrado para Cosentino');
    expect(r!.answer).toContain('legado');
  });

  it('preferência durável também registra', () => {
    const r = detectKnowledgeStatement('Daqui pra frente as legendas desse cliente precisam ser mais diretas.', null);
    expect(r!.tipos).toContain('preference');
  });

  it('PERGUNTA não é registro, mesmo com verbo de decisão', () => {
    expect(detectKnowledgeStatement('O que a gente decidiu ontem sobre a Cosentino?', null)).toBeNull();
    expect(detectKnowledgeStatement('Quais decisões mudaram a operação?', null)).toBeNull();
  });

  it('PEDIDO de entrega não é registro', () => {
    // Sem isto, "crie uma legenda sempre mais direta" viraria confirmação em
    // vez de peça — o agente pararia de trabalhar e passaria a anotar.
    expect(detectKnowledgeStatement('Crie uma legenda sempre mais direta para esse cliente.', null)).toBeNull();
    expect(detectKnowledgeStatement('Me mostra o que mudou nessa campanha.', null)).toBeNull();
  });

  it('conversa comum não vira registro', () => {
    expect(detectKnowledgeStatement('bom dia', null)).toBeNull();
    expect(detectKnowledgeStatement('', null)).toBeNull();
  });

  it('a confirmação diz que fica valendo, sem prometer o que não faz', () => {
    const r = detectKnowledgeStatement('Ficou definido que esse cliente não usa emoji.', null)!;
    expect(r.answer).toMatch(/fica valendo/i);
    expect(r.answer).toMatch(/me corrige/i);
  });
});
