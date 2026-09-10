import { describe, expect, it } from 'vitest';
import { detectMentionedAgent } from './route';

/**
 * Regressão de bug real (09/09/2026), reproduzido através do chat de verdade (não só em
 * código): "Jarbas, tudo certo?" caiu no classifier e foi respondido pelo Bento, porque
 * detectMentionedAgent só reconhecia "@jarbas" com arroba. Os próprios exemplos do produto
 * ("Jarbas, como estão as campanhas da 3NET hoje?") nunca usam @ — a prioridade de menção
 * explícita não disparava pra ninguém que escrevesse do jeito natural.
 */
describe('detectMentionedAgent', () => {
  it('reconhece @agente (comportamento original, preservado)', () => {
    expect(detectMentionedAgent('@Jarbas, qual o melhor criativo da 3NET?')).toBe('jarbas');
    expect(detectMentionedAgent('preciso muito de ajuda, @bento me ajuda?')).toBe('bento');
  });

  it('reconhece endereçamento direto no início da frase, com vírgula (o bug real)', () => {
    expect(detectMentionedAgent('Jarbas, tudo certo?')).toBe('jarbas');
    expect(detectMentionedAgent('Bento, quem é você?')).toBe('bento');
    expect(detectMentionedAgent('Otto, tô estruturando um roteiro pra um Reels')).toBe('otto');
    expect(detectMentionedAgent('Suzy, o que você tem pendente no ClickUp?')).toBe('suzy');
  });

  it('reconhece endereçamento direto sem vírgula', () => {
    expect(detectMentionedAgent('Jarbas como está a performance do Elite')).toBe('jarbas');
  });

  it('é case-insensitive', () => {
    expect(detectMentionedAgent('jarbas, tudo certo?')).toBe('jarbas');
    expect(detectMentionedAgent('JARBAS, tudo certo?')).toBe('jarbas');
  });

  it('ignora nome de agente citado NO MEIO da frase (pode ser pergunta pra outro agente sobre ele)', () => {
    expect(detectMentionedAgent('me atualiza sobre o que o Jarbas fez ontem')).toBeNull();
    expect(detectMentionedAgent('quem cuida do tráfego pago, é o Jarbas?')).toBeNull();
  });

  it('nenhum agente mencionado devolve null', () => {
    expect(detectMentionedAgent('como está o cliente Bravvo hoje?')).toBeNull();
    expect(detectMentionedAgent('oi, tudo bem?')).toBeNull();
  });

  it('nome de agente como prefixo de outra palavra não conta (word boundary)', () => {
    expect(detectMentionedAgent('Bentocar chegou hoje')).toBeNull();
  });
});
