import { describe, expect, it } from 'vitest';
import {
  extractEpisodeCandidates,
  formatEpisodeBlock,
  formatFactualEpisodeBlock,
  janelaDoTexto,
  termosDeConsulta,
} from './episodic-memory';

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

describe('termosDeConsulta', () => {
  it('guarda a entidade e o aspecto da pergunta', () => {
    const t = termosDeConsulta('Quem é o decisor da Colpar?');
    expect(t).toContain('decisor');
    expect(t).toContain('colpar');
  });

  it('descarta palavra de função e interrogativa, que casariam com tudo', () => {
    const t = termosDeConsulta('Quem é o decisor da Colpar?');
    expect(t).not.toContain('quem');
    expect(t).not.toContain('qual');
  });

  it('ignora acento: quem pergunta escreve como sai', () => {
    expect(termosDeConsulta('Qual a praça da Fácil Seguros?')).toContain('facil');
  });

  it('turno sem substantivo útil não busca nada — recall só com termo', () => {
    expect(termosDeConsulta('oi, tudo bem?')).toEqual([]);
  });

  it('limita a 6 termos: pergunta longa não vira varredura', () => {
    expect(termosDeConsulta('decisor praça público restrição campanha briefing entrega prazo').length).toBeLessThanOrEqual(6);
  });
});

describe('question_is_not_persisted_as_fact', () => {
  it('pergunta direta não vira episódio', () => {
    expect(extractEpisodeCandidates('Marcelo é o decisor da Colpar?')).toEqual([]);
  });

  it('pergunta com verbo de registro continua sendo pergunta', () => {
    expect(extractEpisodeCandidates('anota quem é o decisor da Colpar?')).toEqual([]);
  });
});

describe('uncertain_statement_is_not_authoritative_fact', () => {
  it('hipótese não vira fato', () => {
    expect(extractEpisodeCandidates('Acho que talvez o Marcelo seja o decisor.')).toEqual([]);
  });

  it('especulação não vira fato', () => {
    expect(extractEpisodeCandidates('Será que o Marcelo é o decisor.')).toEqual([]);
  });

  it('mas afirmação explícita com pedido de registro vira', () => {
    const c = extractEpisodeCandidates('Anota que o decisor da Colpar é o Marcelo Ribeiro.');
    expect(c).toHaveLength(1);
    expect(c[0]!.eventType).toBe('decision');
  });
});

describe('formatFactualEpisodeBlock', () => {
  const ep = (iso: string, summary: string) => ({
    occurredAt: new Date(iso),
    eventType: 'decision',
    summary,
    clientId: 'c1',
    agent: 'bento',
    sourceRefs: [],
  });

  it('sem episódio, bloco vazio: nunca inventa histórico', () => {
    expect(formatFactualEpisodeBlock([])).toBe('');
  });

  it('episodic_fact_preserves_source: diz que veio da conversa, não do ClickUp', () => {
    const b = formatFactualEpisodeBlock([ep('2026-09-17T01:00:00Z', 'O decisor é Marcelo.')]);
    // O que importa é a INSTRUÇÃO de atribuição, não a ausência da palavra:
    // o bloco cita o ClickUp justamente para negar que a informação veio de lá.
    expect(b).toMatch(/informado na conversa/i);
    expect(b).toMatch(/não lido do ClickUp/i);
  });

  it('new_fact_supersedes_old_fact: instrui que o mais recente vale e o anterior é histórico', () => {
    const b = formatFactualEpisodeBlock([
      ep('2026-09-17T10:00:00Z', 'Agora a decisora é Fernanda.'),
      ep('2026-09-16T10:00:00Z', 'O decisor é Marcelo.'),
    ]);
    expect(b.indexOf('Fernanda')).toBeLessThan(b.indexOf('Marcelo'));
    expect(b).toMatch(/vale o mais recente/i);
    expect(b).toMatch(/não deve ser apresentado como atual/i);
  });

  it('carrega a data de cada registro, senão não dá pra citar quando foi dito', () => {
    expect(formatFactualEpisodeBlock([ep('2026-09-17T01:00:00Z', 'x')])).toContain('2026-09-17');
  });

  it('declara que corrige a ficha curada — é mais novo que ela', () => {
    expect(formatFactualEpisodeBlock([ep('2026-09-17T01:00:00Z', 'x')])).toMatch(/corrige/i);
  });
});
