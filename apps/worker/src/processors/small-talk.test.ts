import { describe, expect, it } from 'vitest';
import { detectSmallTalk } from './small-talk';

describe('detectSmallTalk', () => {
  it.each(['Oi', 'Olá', 'Bom dia', 'Boa tarde', 'Opa', 'E aí'])('saudação: %s', (m) => {
    expect(detectSmallTalk(m, 'bento')?.kind).toBe('saudacao');
  });

  it.each(['Tudo bem?', 'Oi, tudo bem?', 'tudo bom'])('tudo bem: %s', (m) => {
    expect(detectSmallTalk(m, 'bento')?.kind).toBe('tudo_bem');
  });

  it.each(['Obrigado', 'valeu', 'perfeito', 'beleza'])('cortesia: %s', (m) => {
    expect(detectSmallTalk(m, 'bento')?.kind).toBe('cortesia');
  });

  it('resposta é natural e sem jargão de busca', () => {
    const r = detectSmallTalk('Oi, tudo bem?', 'bento');
    expect(r?.answer).not.toMatch(/fonte|curadoria|evid[êe]ncia/i);
    expect(r?.answer.length).toBeGreaterThan(10);
  });

  it('cada agente responde com a própria voz', () => {
    expect(detectSmallTalk('Oi', 'otto')?.answer).not.toBe(detectSmallTalk('Oi', 'bento')?.answer);
  });

  // O que NÃO pode virar fast path: pedido real disfarçado de cumprimento.
  it.each([
    'Oi, me vê as tarefas de hoje',
    'Bom dia, quantas tarefas vencem hoje?',
    'valeu, agora cria uma task pro Pedro',
    'obrigado, e o briefing da campanha?',
  ])('NÃO é small talk: %s', (m) => {
    expect(detectSmallTalk(m, 'bento')).toBeNull();
  });

  it('pergunta de trabalho curta sem saudação segue o caminho normal', () => {
    expect(detectSmallTalk('quantas tarefas?', 'bento')).toBeNull();
  });

  it('texto longo nunca é small talk', () => {
    expect(detectSmallTalk('oi '.repeat(30), 'bento')).toBeNull();
  });
});

describe('corte do bloco de contexto do Orchestrator', () => {
  it('"Bom dia" com contexto colado ainda é saudação', () => {
    const comContexto = 'Bom dia\n\n---\nContexto:\n' + 'histórico irrelevante '.repeat(40);
    expect(detectSmallTalk(comContexto, 'bento')?.kind).toBe('saudacao');
  });

  it('pedido real com contexto colado continua fora do fast path', () => {
    const comContexto = 'Bom dia, quantas tarefas vencem hoje?\n\n---\nContexto:\n' + 'x'.repeat(200);
    expect(detectSmallTalk(comContexto, 'bento')).toBeNull();
  });
});

describe('robustez do corte de contexto', () => {
  it('saudação + bloco de contexto (sem marcador ---) ainda é saudação', () => {
    expect(detectSmallTalk('valeu\n\nContexto:\nhistórico da conversa anterior', 'bento')?.kind).toBe('cortesia');
  });

  it('saudação seguida de PEDIDO do usuário não é small talk', () => {
    expect(detectSmallTalk('Oi\n\nme vê as tarefas de hoje por favor', 'bento')).toBeNull();
  });
});

/**
 * Regressão medida no front em 24/09/2026: "isso é fato ou hipótese?" começa
 * com "isso", que está na lista de cortesia, e virava "De nada. Quando quiser
 * outro recorte de performance, é só pedir." — a pergunta nunca chegava no
 * agente. Ela existe justamente pra separar o que é medido do que é leitura.
 */
describe('pergunta sobre fato/fonte nunca é small talk', () => {
  const perguntas = [
    'isso é fato ou hipótese?',
    'isso veio de onde?',
    'certo, mas qual a fonte?',
    'ok, e comparado com o período anterior?',
    'entendi, de onde você tirou esses dados?',
  ];
  for (const p of perguntas) {
    it(`"${p}" segue o caminho normal`, () => {
      expect(detectSmallTalk(p, 'jarbas')).toBeNull();
    });
  }

  it('cortesia pura continua sendo atalho', () => {
    expect(detectSmallTalk('valeu', 'jarbas')).not.toBeNull();
    expect(detectSmallTalk('isso', 'jarbas')).not.toBeNull();
  });
});
