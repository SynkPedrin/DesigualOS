/**
 * retrieval-planner.test.ts — a decisão do planner, pura e determinística.
 *
 * Bateria de frases contra as três regras (mudança → eventos, estado → live
 * com cliente+lista, factual → reforço semântico) e os dois pisos de
 * segurança: small talk não adiciona fonte nenhuma, e job antigo sem `intent`
 * decide igual a hoje. Zero banco, zero rede, zero OpenAI.
 */
import { describe, expect, it } from 'vitest';
import {
  PLANO_NULO,
  SEMANTIC_TOP_K_REFORCADO,
  formatLiveTasksBlock,
  planejarRecuperacao,
} from './retrieval-planner';

const CLIENTE_COM_LISTA = { citouCliente: true, clienteTemListaClickup: true };

describe('planejarRecuperacao — perguntas de MUDANÇA/RECÊNCIA → eventos recentes', () => {
  const FRASES = [
    'o que mudou na Cosentino essa semana?',
    'o que aconteceu na operação hoje?',
    'alguma novidade na Elite?',
    'o que rolou recentemente na Colpar?',
    'me mostra as últimas movimentações da 3Net',
    'teve alguma mudança desde ontem?',
    'o que houve na Cosentino este mês?',
  ];

  it.each(FRASES)('"%s" liga eventos recentes', (mensagem) => {
    const plano = planejarRecuperacao({ mensagem, ...CLIENTE_COM_LISTA });
    expect(plano.incluirEventosRecentes).toBe(true);
  });

  it('eventos não dependem de cliente nem de lista: pergunta global também liga', () => {
    const plano = planejarRecuperacao({
      mensagem: 'o que aconteceu na agência essa semana?',
      citouCliente: false,
      clienteTemListaClickup: false,
    });
    expect(plano.incluirEventosRecentes).toBe(true);
  });
});

describe('planejarRecuperacao — ESTADO operacional → live tasks, com os dois portões', () => {
  const FRASES = [
    'qual o status das tarefas da Cosentino?',
    'como tá o andamento das entregas da Elite?',
    'tem alguma tarefa atrasada na Colpar?',
    'o que vence essa semana na 3Net?',
    'quais entregas estão em aberto na Cosentino?',
  ];

  it.each(FRASES)('"%s" com cliente e lista liga live', (mensagem) => {
    const plano = planejarRecuperacao({ mensagem, ...CLIENTE_COM_LISTA });
    expect(plano.consultarTarefasLive).toBe(true);
  });

  it('SEM cliente citado não tem live, mesmo com palavra operacional', () => {
    const plano = planejarRecuperacao({
      mensagem: 'qual o status das tarefas?',
      citouCliente: false,
      clienteTemListaClickup: false,
    });
    expect(plano.consultarTarefasLive).toBe(false);
  });

  it('cliente SEM lista no ClickUp não tem live', () => {
    const plano = planejarRecuperacao({
      mensagem: 'qual o status das tarefas da Cosentino?',
      citouCliente: true,
      clienteTemListaClickup: false,
    });
    expect(plano.consultarTarefasLive).toBe(false);
  });

  it('"o que vence essa semana" liga live E eventos — são as duas perguntas ao mesmo tempo', () => {
    const plano = planejarRecuperacao({ mensagem: 'o que vence essa semana na 3Net?', ...CLIENTE_COM_LISTA });
    expect(plano.consultarTarefasLive).toBe(true);
    expect(plano.incluirEventosRecentes).toBe(true);
  });
});

describe('planejarRecuperacao — FACTUAL → reforço semântico', () => {
  it('intent knowledge_query liga o reforço mesmo sem forma interrogativa', () => {
    const plano = planejarRecuperacao({
      intent: 'knowledge_query',
      mensagem: 'me fala da política de preços da Colpar',
      citouCliente: true,
      clienteTemListaClickup: false,
    });
    expect(plano.reforcarMemoriaSemantica).toBe(true);
  });

  it.each([
    'quem é o decisor da Colpar?',
    'qual o tom de voz da 3Net?',
    'quantos posts por semana a Elite quer?',
    'como a Cosentino prefere a legenda?',
  ])('"%s" liga o reforço pela forma interrogativa', (mensagem) => {
    const plano = planejarRecuperacao({ mensagem, ...CLIENTE_COM_LISTA });
    expect(plano.reforcarMemoriaSemantica).toBe(true);
  });

  it('o reforço é top-k maior, definido em uma constante', () => {
    expect(SEMANTIC_TOP_K_REFORCADO).toBe(8);
  });

  it('intent de outro tipo não liga reforço sozinho', () => {
    const plano = planejarRecuperacao({
      intent: 'campaign_analysis',
      mensagem: 'analisa a campanha de aniversário',
      citouCliente: true,
      clienteTemListaClickup: true,
    });
    expect(plano.reforcarMemoriaSemantica).toBe(false);
  });
});

describe('planejarRecuperacao — os pisos de segurança', () => {
  it.each(['bom dia, tudo bem?', 'valeu!', 'perfeito, era isso', 'me conta mais sobre isso'])(
    'small talk "%s" não adiciona fonte nenhuma',
    (mensagem) => {
      expect(planejarRecuperacao({ mensagem, ...CLIENTE_COM_LISTA })).toEqual(PLANO_NULO);
    },
  );

  it('job antigo (sem intent) com mensagem neutra = comportamento idêntico ao de hoje', () => {
    const plano = planejarRecuperacao({ mensagem: 'preciso de uma legenda pra sexta', ...CLIENTE_COM_LISTA });
    expect(plano).toEqual(PLANO_NULO);
  });

  it('mensagem vazia é plano nulo, não erro', () => {
    expect(planejarRecuperacao({ mensagem: '', ...CLIENTE_COM_LISTA })).toEqual(PLANO_NULO);
    expect(planejarRecuperacao({ mensagem: '   ', citouCliente: false, clienteTemListaClickup: false })).toEqual(PLANO_NULO);
  });

  it('a decisão é sobre o texto da pessoa, não sobre o encanamento anexado pela API', () => {
    const mensagem = 'bom dia!\n\n---\nContexto:\nTarefas recentes: status da entrega, o que mudou hoje na operação...';
    expect(planejarRecuperacao({ mensagem, ...CLIENTE_COM_LISTA })).toEqual(PLANO_NULO);
  });
});

describe('formatLiveTasksBlock — o bloco do estado ao vivo', () => {
  it('lista vazia NÃO vira afirmação de "0 tarefas" (falha de provedor degrada pra sem bloco)', () => {
    expect(formatLiveTasksBlock([])).toBe('');
  });

  it('conta abertas, lista as mais recentes e declara precedência sobre o registro', () => {
    const bloco = formatLiveTasksBlock([
      { id: '1', name: 'Legenda de outubro', status: 'em andamento', closed: false, updatedAt: new Date('2026-10-01T12:00:00Z') },
      { id: '2', name: 'Grid de aniversário', status: 'concluída', closed: true, updatedAt: new Date('2026-09-30T12:00:00Z') },
      { id: '3', name: 'Reels bastidores', status: 'a fazer', closed: false, updatedAt: new Date('2026-09-29T12:00:00Z') },
    ]);
    expect(bloco).toContain('3 tarefa(s) no total, 2 em aberto');
    expect(bloco.indexOf('Legenda de outubro')).toBeLessThan(bloco.indexOf('Reels bastidores'));
    expect(bloco).toContain('[em andamento]');
    expect(bloco).toContain('Mais FRESCO'.replace('Mais', 'MAIS'));
  });
});
