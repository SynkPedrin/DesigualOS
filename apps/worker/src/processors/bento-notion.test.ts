import { describe, expect, it } from 'vitest';
import { deveExportarParaNotion, pedeNotion, semMencaoNotion, tituloParaNotion } from './bento-notion';
import { markdownParaBlocosNotion } from '@desigual-os/tool-gateway';

/**
 * 28/09/2026, pedido da operação: "só quando o colaborador quiser e solicitar
 * no chat, ou colocando @notion; aí sim ele gera um arquivo no Notion".
 *
 * A palavra que manda é SÓ. Uma integração que exporta por conta própria vira
 * lixo no workspace de todo mundo em uma semana — então o gatilho tem que ser
 * explícito, e a maior parte destes testes existe pra provar que ele NÃO
 * dispara.
 */

describe('o gatilho é explícito', () => {
  it.each([
    '@notion',
    'manda esse briefing pro notion @notion',
    'Bento, @notion cria a task do carrossel',
    'manda isso pro notion',
    'sobe esse briefing no notion',
    'salva no notion por favor',
  ])('%s -> exporta', (m) => {
    expect(pedeNotion(m)).toBe(true);
  });

  it.each([
    'cria a task do carrossel pro Gui',
    'me lista as tarefas da D Carvalho',
    'o cliente usa notion pra organizar o time',
    'depois eu passo pro notion na mão',
    'muda o prazo dessa task',
  ])('%s -> NÃO exporta', (m) => {
    expect(pedeNotion(m)).toBe(false);
  });
});

describe('o arroba endereça, não faz parte do pedido', () => {
  it('sai do texto sem deixar espaço duplo', () => {
    expect(semMencaoNotion('Bento, @notion cria o briefing')).toBe('Bento, cria o briefing');
  });

  it('o título sai do PEDIDO, sem o arroba e sem o verbo de envio', () => {
    const t = tituloParaNotion('@notion manda pro notion o briefing do carrossel de outubro', 'Colormaq');
    expect(t).not.toContain('@notion');
    expect(t).toContain('Colormaq');
  });

  it('pedido curto demais não vira título sem sentido', () => {
    expect(tituloParaNotion('@notion', null)).toBe('Conteúdo do Desigual OS');
  });
});

describe('markdown do briefing vira bloco do Notion', () => {
  it('título, item e parágrafo saem com o tipo certo', () => {
    const blocos = markdownParaBlocosNotion('# Briefing\n\n## CONTEXTO\n- primeiro item\n\ntexto solto');
    expect(blocos.map((b) => b.type)).toEqual(['heading_1', 'heading_2', 'bulleted_list_item', 'paragraph']);
  });

  it('lista numerada é reconhecida', () => {
    expect(markdownParaBlocosNotion('1. passo um')[0]?.type).toBe('numbered_list_item');
  });

  it('linha que não se reconhece vira parágrafo — nada é descartado em silêncio', () => {
    const blocos = markdownParaBlocosNotion('> citação que o conversor não trata');
    expect(blocos).toHaveLength(1);
    expect(blocos[0]?.type).toBe('paragraph');
  });

  it('linha em branco não vira bloco vazio', () => {
    expect(markdownParaBlocosNotion('a\n\n\n\nb')).toHaveLength(2);
  });

  it('texto acima do limite do Notion é cortado, não rejeitado', () => {
    const blocos = markdownParaBlocosNotion('x'.repeat(2500));
    const rich = (blocos[0]?.paragraph as { rich_text: Array<{ text: { content: string } }> }).rich_text;
    expect(rich[0]!.text.content).toHaveLength(2000);
  });
});

import { escolherToken } from './bento-notion';
import { vi } from 'vitest';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

/**
 * 28/09/2026: o OAuth por pessoa exige uma integração PÚBLICA criada no portal
 * do Notion — ato do dono da conta, não deste código. Enquanto ela não existe,
 * `@notion` não funcionaria pra ninguém. Daí o token da agência como fallback,
 * com a origem SEMPRE declarada na resposta: onde o arquivo nasce é o que a
 * pessoa precisa saber pra achá-lo depois.
 */
describe('só o token da pessoa — não existe fallback', () => {
  it('sem conexão pessoal, não há token: a resposta é o convite, nunca o Notion de outro', async () => {
    expect(await escolherToken('', fakeLogger)).toBeNull();
  });

  it('usuário sem id também não resolve — nada de escrever "em nome de ninguém"', async () => {
    expect(await escolherToken('', fakeLogger)).toBeNull();
  });
});

/**
 * `@notion` NÃO É UMA FEATURE DO BENTO — é da integração.
 *
 * A condição em execute-job.ts começava com `agent === 'bento'`. Pedir
 * `@notion` num turno do Otto, que é o agente que escreve briefing — o
 * material que mais se quer guardar —, não fazia nada, e não fazia nada em
 * silêncio. Nenhum aviso, nenhuma linha na resposta.
 */
describe('deveExportarParaNotion — a regra que decide o export do turno', () => {
  const pedido = 'manda esse briefing pro notion';

  it('turno completo, com texto e com pedido: exporta', () => {
    expect(deveExportarParaNotion({ status: 'completed', answer: 'o briefing', mensagem: pedido })).toBe(true);
  });

  it('vale para qualquer agente — a regra não olha quem respondeu', () => {
    // O predicado nem recebe o agente: é essa ausência que conserta o defeito.
    expect(deveExportarParaNotion({ status: 'completed', answer: 'copy do Otto', mensagem: '@notion' })).toBe(true);
  });

  it('turno que falhou não exporta — não se guarda o que deu errado', () => {
    expect(deveExportarParaNotion({ status: 'failed', answer: 'o briefing', mensagem: pedido })).toBe(false);
  });

  it('turno sem texto não exporta — não há o que virar página', () => {
    expect(deveExportarParaNotion({ status: 'completed', answer: '', mensagem: pedido })).toBe(false);
    expect(deveExportarParaNotion({ status: 'completed', answer: null, mensagem: pedido })).toBe(false);
  });

  /** Nada vai pro Notion sozinho: sem pedido, o turno segue como sempre. */
  it('sem pedido não exporta, por mais completo que o turno esteja', () => {
    expect(deveExportarParaNotion({ status: 'completed', answer: 'o briefing', mensagem: 'faz um post' })).toBe(false);
  });
});
