import { describe, expect, it, vi } from 'vitest';
import { ehPerguntaOperacional, responderOperacional } from './bento-resposta-operacional';

type Escritor = (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

/**
 * 29/09/2026: "criar e alterar usam GPT; responder sai por outro node, outro
 * modelo". Este arquivo cobre a fatia OPERACIONAL — e o que estes testes mais
 * protegem é o LIMITE da fatia: pergunta de conhecimento tem que continuar indo
 * pro vault, onde existe busca vetorial. Responder ali com GPT sem retrieval
 * seria piorar com cara de melhorar.
 */
describe('o que é pergunta operacional, e o que não é', () => {
  it.each([
    'quantas tarefas estão atrasadas?',
    'quem está sobrecarregado essa semana',
    'tem alguma demanda sem responsável?',
    'o que vence amanhã?',
    'qual cliente tem mais task parada',
  ])('%s -> responde aqui', (m) => {
    expect(ehPerguntaOperacional(m)).toBe(true);
  });

  it.each([
    ['qual o tom de voz da 3Net?', 'conhecimento: mora no vault'],
    ['o que a gente fez na campanha Operação Blindada?', 'passado + nome de campanha: mora no vault'],
    ['quais tarefas já rodaram nesse cliente?', 'passado, mesmo com vocabulário de task'],
    ['o que aconteceu com as entregas de agosto?', 'passado'],
    ['cria a task do carrossel', 'escrita'],
    ['muda o prazo dessa task', 'escrita'],
    ['me explica como funciona o briefing', 'nem operação nem vault'],
  ])('%s -> NÃO é desta fatia (%s)', (m) => {
    expect(ehPerguntaOperacional(m)).toBe(false);
  });
});

describe('sem dado apurado, não responde', () => {
  it('nenhuma fonte = null, e quem chamou segue pelo caminho antigo', async () => {
    const escritor = vi.fn<Escritor>(async () => 'qualquer coisa');
    const r = await responderOperacional({
      pergunta: 'quantas atrasadas?', estadoDaOperacao: null, escritor, logger: fakeLogger,
    });
    expect(r).toBeNull();
    // Não chamar o modelo sem dado é o ponto: inventar seria pior que devolver.
    expect(escritor).not.toHaveBeenCalled();
  });

  it('escritor mudo devolve null — nunca uma resposta vazia', async () => {
    const r = await responderOperacional({
      pergunta: 'quantas atrasadas?', estadoDaOperacao: 'Atrasadas: 11',
      escritor: vi.fn<Escritor>(async () => null), logger: fakeLogger,
    });
    expect(r).toBeNull();
  });

  it('resposta curta demais não conta como resposta', async () => {
    const r = await responderOperacional({
      pergunta: 'quantas?', estadoDaOperacao: 'Atrasadas: 11',
      escritor: vi.fn<Escritor>(async () => 'ok'), logger: fakeLogger,
    });
    expect(r).toBeNull();
  });

  it('escritor que explode não derruba o turno', async () => {
    const r = await responderOperacional({
      pergunta: 'quantas atrasadas?', estadoDaOperacao: 'Atrasadas: 11',
      escritor: vi.fn<Escritor>(async () => { throw new Error('502'); }), logger: fakeLogger,
    });
    expect(r).toBeNull();
  });
});

describe('a instrução proíbe inventar e proíbe relatório', () => {
  it('o prompt carrega os dados e as restrições', async () => {
    const escritor = vi.fn<Escritor>(async () => 'Onze atrasadas, sete delas na D. Carvalho.');
    await responderOperacional({
      pergunta: 'quantas atrasadas?',
      estadoDaOperacao: 'Atrasadas: 11',
      blocoCliente: 'CLIENTE DO TURNO: D. Carvalho',
      escritor, logger: fakeLogger,
    });
    const prompt = escritor.mock.calls[0]![0];
    expect(prompt).toContain('Atrasadas: 11');
    expect(prompt).toContain('D. Carvalho');
    expect(prompt).toContain('tem que estar nos dados');
    expect(prompt).toContain('Não faça relatório');
  });

  it('responde curto: o teto de tokens é pequeno de propósito', async () => {
    const escritor = vi.fn<Escritor>(async () => 'Onze atrasadas, sete na D. Carvalho.');
    await responderOperacional({ pergunta: 'q?', estadoDaOperacao: 'Atrasadas: 11', escritor, logger: fakeLogger });
    expect(escritor.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 700 });
  });
});

/**
 * 29/09/2026, medido numa pergunta real: o estado apurado (146 atrasadas) foi
 * mandado JUNTO com o bloco operacional que a API monta por outra consulta, e
 * a resposta saiu com "Ana Luiza lidera com 198 atrasadas" — mais que o total.
 * Dois recortes diferentes somados como se fossem o mesmo. O modelo percebeu e
 * avisou; contar com isso seria sorte.
 */
describe('um conjunto de números por vez', () => {
  it('havendo estado apurado, o bloco da API NÃO entra junto', async () => {
    const escritor = vi.fn<Escritor>(async () => 'Onze atrasadas.');
    await responderOperacional({
      pergunta: 'quantas atrasadas?',
      estadoDaOperacao: 'Atrasadas: 11',
      contextoOperacional: 'OUTRA CONSULTA: Atrasadas: 198',
      escritor, logger: fakeLogger,
    });
    const prompt = escritor.mock.calls[0]![0];
    expect(prompt).toContain('Atrasadas: 11');
    expect(prompt).not.toContain('198');
  });

  it('sem estado apurado, o bloco da API é usado — melhor que nada', async () => {
    const escritor = vi.fn<Escritor>(async () => 'Cinco em aberto.');
    await responderOperacional({
      pergunta: 'quantas em aberto?',
      estadoDaOperacao: null,
      contextoOperacional: 'Tarefas em aberto: 5',
      escritor, logger: fakeLogger,
    });
    expect(escritor.mock.calls[0]![0]).toContain('Tarefas em aberto: 5');
  });

  it('o dossiê do cliente continua entrando junto — não é número, é contexto', async () => {
    const escritor = vi.fn<Escritor>(async () => 'Resposta suficiente aqui.');
    await responderOperacional({
      pergunta: 'quantas atrasadas da Colormaq?',
      estadoDaOperacao: 'Atrasadas: 11',
      blocoCliente: 'CLIENTE DO TURNO: Colormaq',
      escritor, logger: fakeLogger,
    });
    const prompt = escritor.mock.calls[0]![0];
    expect(prompt).toContain('Atrasadas: 11');
    expect(prompt).toContain('Colormaq');
  });
});

import { pedeAtaDeReuniao, montarAtaDeReuniao } from './bento-resposta-operacional';

/**
 * 29/09/2026: a pessoa sai da reunião com a transcrição e precisa de UMA coisa
 * — o que ficou decidido, o que vira trabalho, o que disso já existe no
 * ClickUp e o que fazer agora. Sem gatilho próprio isso caía na fatia errada.
 */
describe('ata do dia', () => {
  it.each([
    'me faz a ata dessa reunião',
    'quais os desdobramentos disso?',
    'o que ficou decidido na reunião?',
    'monta os encaminhamentos',
  ])('%s COM material anexado -> ata', (m) => {
    expect(pedeAtaDeReuniao(m, true)).toBe(true);
  });

  it('SEM material anexado não é ata — não há transcrição pra ler', () => {
    expect(pedeAtaDeReuniao('me faz a ata dessa reunião', false)).toBe(false);
  });

  it('a transcrição e o estado do ClickUp entram JUNTOS — o cruzamento é o ponto', async () => {
    const escritor = vi.fn<Escritor>(async () => '## O QUE FICOU DECIDIDO\n- Carrossel aprovado pela Marina.');
    await montarAtaDeReuniao({
      pergunta: 'faz a ata',
      material: 'Marina pediu um carrossel de 5 slides.',
      estadoDaOperacao: 'Atrasadas: 11',
      escritor, logger: fakeLogger,
    });
    const prompt = escritor.mock.calls[0]![0];
    expect(prompt).toContain('TRANSCRIÇÃO DA REUNIÃO');
    expect(prompt).toContain('Marina pediu um carrossel');
    expect(prompt).toContain('ESTADO DO CLICKUP AGORA');
    expect(prompt).toContain('Atrasadas: 11');
  });

  it('proíbe afirmar que uma task existe sem ver o nome dela', async () => {
    const escritor = vi.fn<Escritor>(async () => '## O QUE FICOU DECIDIDO\n- algo suficientemente longo aqui.');
    await montarAtaDeReuniao({ pergunta: 'ata', material: 'x', estadoDaOperacao: null, escritor, logger: fakeLogger });
    expect(escritor.mock.calls[0]![0]).toContain('NUNCA afirme que existe uma task sem ver o nome dela');
  });

  it('escritor mudo devolve null — sem ata inventada', async () => {
    const r = await montarAtaDeReuniao({
      pergunta: 'ata', material: 'x', estadoDaOperacao: null,
      escritor: vi.fn<Escritor>(async () => null), logger: fakeLogger,
    });
    expect(r).toBeNull();
  });
});
