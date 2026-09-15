import { describe, expect, it } from 'vitest';
import { classifyActionIntent } from './action-intent';
import { buildOperationalTitle } from './write-target';

/**
 * Regressão do caso REAL relatado por colaboradora (deploy anterior): ela pediu
 * análise de umas peças e o sistema criou task na hora, na lista errada, com o
 * título copiado da mensagem.
 */

describe('analysis_only_never_writes', () => {
  it.each([
    'analisa isso',
    'me faz uma análise',
    'analisa essa demanda',
    'o que você acha?',
    'analisa antes',
    'veja isso e me diga o que devemos fazer',
    "Analisa essas peças da campanha 'Peças que você confia, você tem'. Quero entender primeiro se elas estão boas e o que precisa mudar.",
    'Analise essa campanha.',
    'dá uma olhada nas peças e me fala',
  ])('%s -> NÃO autoriza escrita', (m) => {
    const i = classifyActionIntent(m);
    expect(i.writeAuthorized).toBe(false);
    expect(['ANALYSIS', 'SUGGESTION', 'PLANNING', 'READ_ONLY']).toContain(i.kind);
  });

  it('o caso exato da Tammy é ANALYSIS', () => {
    const i = classifyActionIntent("Analisa essas peças da campanha 'Peças que você confia, você tem'. Quero entender primeiro se elas estão boas e o que precisa mudar.");
    expect(i.kind).toBe('ANALYSIS');
    expect(i.writeAuthorized).toBe(false);
  });

  it('pergunta sobre criar NÃO cria (infinitivo após modal)', () => {
    const i = classifyActionIntent('Analise isso e me diga se devemos criar uma task.');
    expect(i.kind).toBe('SUGGESTION');
    expect(i.writeAuthorized).toBe(false);
  });

  it.each([
    'vale a pena criar uma task pra isso?',
    'precisamos criar uma task?',
    'você acha que devemos abrir uma tarefa?',
  ])('deliberação: %s', (m) => {
    expect(classifyActionIntent(m).writeAuthorized).toBe(false);
  });
});

describe('analysis_then_create — ordem explícita autoriza', () => {
  it('"analise ... e depois crie uma task" autoriza, com análise antes', () => {
    const i = classifyActionIntent('Analise essa campanha e depois crie uma task com o que precisa ser corrigido.');
    expect(i.kind).toBe('ACTION_REQUEST');
    expect(i.writeAuthorized).toBe(true);
    expect(i.requiresAnalysisFirst).toBe(true);
  });

  it('ordem direta sem análise também autoriza', () => {
    const i = classifyActionIntent('Crie uma task chamada "Revisar peças" para o Pedro');
    expect(i.kind).toBe('ACTION_REQUEST');
    expect(i.writeAuthorized).toBe(true);
    expect(i.requiresAnalysisFirst).toBe(false);
  });

  it('autonomia só com pedido explícito de resolver', () => {
    expect(classifyActionIntent('Bento, organize a operação e resolva o que puder').kind).toBe('AUTONOMOUS_ACTION');
    expect(classifyActionIntent('Bento, como está a operação hoje?').writeAuthorized).toBe(false);
  });
});

describe('task_title_is_semantic_not_raw_prompt', () => {
  it('NÃO copia a mensagem crua como título', () => {
    const t = buildOperationalTitle({
      message: "Analisa essas peças da campanha 'Peças que você confia, você tem' e cria a task dos ajustes",
      explicitName: null,
      clientName: 'Colpar',
    });
    expect(t).not.toBe('Peças que você confia, você tem');
    // O título diz o TRABALHO, e mantém a campanha como referência.
    expect(t).toMatch(/^Revisar e ajustar/);
    expect(t).toContain('Peças que você confia, você tem');
    expect(t).toContain('Colpar');
  });

  it('nome explícito entre aspas continua mandando', () => {
    expect(buildOperationalTitle({ message: 'crie a task', explicitName: 'QA Revisão Final', clientName: 'X' })).toBe('QA Revisão Final');
  });

  it('verbo do título vem do que foi pedido', () => {
    expect(buildOperationalTitle({ message: 'produzir 3 reels da campanha', explicitName: null, clientName: null })).toMatch(/^Produzir/);
  });
});

/**
 * Regressão do achado de 15/09/2026: as regras do guard eram case-sensitive,
 * então "Crie uma task" (maiúscula, como todo mundo escreve) não casava e o
 * pedido ia parar no agente remoto — sem resolução de cliente, sem título
 * operacional e sem read-back. Era esse o caminho do bug da colaboradora.
 */
describe('case-insensitive: a ordem vale com qualquer caixa', () => {
  it.each([
    'Crie uma task de revisão',
    'CRIE UMA TASK DE REVISÃO',
    'crie uma task de revisão',
    'Adicione uma tarefa pro Pedro',
  ])('%s -> ACTION_REQUEST', (m) => {
    const i = classifyActionIntent(m);
    expect(i.kind).toBe('ACTION_REQUEST');
    expect(i.writeAuthorized).toBe(true);
  });
});
