import { describe, expect, it } from 'vitest';
import { extractEpisodeCandidates, formatEpisodeBlock, janelaDoTexto } from './episodic-memory';

/**
 * L1 existe para responder "o que conversamos ontem?" com o que ACONTECEU, não
 * com a transcrição. Conversa não vira verdade automaticamente.
 */
describe('extractEpisodeCandidates', () => {
  it('decisão vira episódio', () => {
    const [e] = extractEpisodeCandidates('Decidimos que a campanha de aniversário vai focar em legado, não em preço.');
    expect(e!.eventType).toBe('decision');
    expect(e!.summary).toContain('legado');
  });

  it('feedback vira episódio', () => {
    const [e] = extractEpisodeCandidates('Essa headline ficou genérica, refaça com outro ângulo.');
    expect(e!.eventType).toBe('feedback');
  });

  it('preferência durável vira episódio', () => {
    const [e] = extractEpisodeCandidates('Daqui pra frente eu quero as legendas mais diretas e sem introdução longa.');
    expect(e!.eventType).toBe('preference');
  });

  it('conversa comum NÃO vira episódio', () => {
    // O ponto do módulo: a esmagadora maioria dos turnos não deixa episódio.
    expect(extractEpisodeCandidates('Bento, quantas tarefas vencem hoje?')).toEqual([]);
    expect(extractEpisodeCandidates('obrigado, valeu')).toEqual([]);
    expect(extractEpisodeCandidates('')).toEqual([]);
  });

  it('pergunta não vira episódio mesmo com verbo de decisão', () => {
    expect(extractEpisodeCandidates('A gente decidiu alguma coisa sobre isso?')).toEqual([]);
  });

  it('não duplica a mesma frase repetida no turno', () => {
    const fs = extractEpisodeCandidates('Decidimos focar em legado. Decidimos focar em legado.');
    expect(fs).toHaveLength(1);
  });
});

describe('janelaDoTexto', () => {
  const agora = new Date('2026-09-16T15:00:00Z');

  it('"ontem" vira a janela do dia anterior, fechada nas duas pontas', () => {
    const j = janelaDoTexto('o que conversamos ontem?', agora)!;
    expect(j.rotulo).toBe('ontem');
    expect(j.ate).toBeInstanceOf(Date);
    expect(j.desde.getTime()).toBeLessThan(j.ate!.getTime());
  });

  it('"o que te falei" sem marcador cai numa janela curta, não no histórico inteiro', () => {
    const j = janelaDoTexto('lembra o que eu te falei sobre esse cliente?', agora)!;
    expect(j.rotulo).toContain('últimos');
  });

  it('turno sem referência temporal não abre janela', () => {
    expect(janelaDoTexto('crie uma legenda para a campanha', agora)).toBeNull();
  });
});

describe('formatEpisodeBlock', () => {
  it('sem episódio, manda declarar a ausência em vez de reconstruir', () => {
    const b = formatEpisodeBlock([], 'ontem');
    expect(b).toMatch(/nenhum epis[óo]dio registrado/i);
    expect(b).toMatch(/N[ÃA]O reconstrua/i);
  });

  it('com episódio, entrega data e tipo', () => {
    const b = formatEpisodeBlock(
      [{ occurredAt: new Date('2026-09-15T14:30:00Z'), eventType: 'decision', summary: 'Focar em legado', clientId: null, agent: 'otto', sourceRefs: [] }],
      'ontem',
    );
    expect(b).toContain('2026-09-15');
    expect(b).toContain('decision');
    expect(b).toContain('Focar em legado');
  });
});
