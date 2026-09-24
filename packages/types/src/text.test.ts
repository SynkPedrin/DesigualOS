import { describe, expect, it } from 'vitest';

import {
  extractApprovalProposal,
  stripBlockMarkers,
  stripEmDashes,
  temCorrupcaoDeIdioma,
  removerGlifosForaDoIdioma,
  redigirIdentificadores,
  temIdentificadorExposto,
} from './text';

/**
 * A regra "sem travessão" roda na BORDA: todo texto de agente passa por stripEmDashes antes de
 * ser persistido ou postado. Por isso ela precisa de teste próprio: um defeito aqui não aparece
 * como erro, aparece como resposta do agente com a formatação destruída.
 *
 * O caso da lista indentada é regressão de defeito real (briefing da Fratelli, 08/09/2026): o
 * padrão antigo exigia o marcador na coluna 0, então bullet aninhado caía na regra de
 * meio-de-frase, cujo \s+ atravessava a quebra de linha e transformava a lista inteira numa fila
 * de vírgulas ("**Ações:**, Criar guias..., Produzir vídeos...").
 */
describe('stripEmDashes', () => {
  it('preserva lista indentada em vez de virar fila de vírgulas', () => {
    const input = '**Ações:**\n  - Criar guias e blogs\n  - Produzir vídeos';
    expect(stripEmDashes(input)).toBe(input);
  });

  it('preserva lista na coluna 0', () => {
    const input = 'Ações:\n- Criar guias\n- Produzir vídeos';
    expect(stripEmDashes(input)).toBe(input);
  });

  it('não deixa a regra de meio-de-frase atravessar quebra de linha', () => {
    expect(stripEmDashes('Topo de funil — atenção\n\n  - Reels\n  - Carrossel')).toBe(
      'Topo de funil, atenção\n\n  - Reels\n  - Carrossel',
    );
  });

  it('travessão no meio da frase vira vírgula', () => {
    expect(stripEmDashes('O CTR caiu — o criativo cansou.')).toBe('O CTR caiu, o criativo cansou.');
  });

  it('travessão no início da linha vira marcador de lista', () => {
    expect(stripEmDashes('— Primeiro item\n— Segundo item')).toBe('- Primeiro item\n- Segundo item');
  });

  it('travessão grudado vira hífen', () => {
    expect(stripEmDashes('palavra—grudada')).toBe('palavra-grudada');
  });

  it('meia-risca recebe o mesmo tratamento do travessão', () => {
    expect(stripEmDashes('CPA subiu – público saturado.')).toBe('CPA subiu, público saturado.');
  });

  it('texto sem travessão nenhum sai intacto', () => {
    const input = 'Frequência em 3.8, recomendo trocar o criativo.';
    expect(stripEmDashes(input)).toBe(input);
  });
});

describe('stripBlockMarkers', () => {
  it('[FIM_BLOCO] vira quebra de parágrafo', () => {
    expect(stripBlockMarkers('Primeiro bloco[FIM_BLOCO]Segundo bloco')).toBe(
      'Primeiro bloco\n\nSegundo bloco',
    );
  });

  it('mantém o conteúdo dos blocos de protocolo, tira só as cercas', () => {
    expect(stripBlockMarkers('[AGUARDA_APROVACAO]Subir verba pra 500[/AGUARDA_APROVACAO]')).toBe(
      'Subir verba pra 500',
    );
  });

  it('colapsa quebras excedentes', () => {
    expect(stripBlockMarkers('a[FIM_BLOCO][FIM_BLOCO]b')).toBe('a\n\nb');
  });
});

describe('extractApprovalProposal', () => {
  it('extrai a proposta de dentro do bloco', () => {
    expect(extractApprovalProposal('[AGUARDA_APROVACAO]Subir verba pra 500[/AGUARDA_APROVACAO]')).toBe(
      'Subir verba pra 500',
    );
  });

  it('devolve null quando não há bloco', () => {
    expect(extractApprovalProposal('Resposta normal sem proposta.')).toBeNull();
  });

  it('devolve null quando o bloco está vazio', () => {
    expect(extractApprovalProposal('[AGUARDA_APROVACAO]   [/AGUARDA_APROVACAO]')).toBeNull();
  });
});


describe('stripEmDashes preserva citação', () => {
  /**
   * Defeito medido no frontend real em 10/09/2026: a task foi criada no ClickUp com o nome
   * `E2E Claude - pode apagar` (conferido na API) e a resposta na tela citou
   * `"E2E Claude, pode apagar"`. Quem procura pelo nome que leu não acha a task.
   */
  it('hífen dentro de aspas sobrevive (nome de task citado)', () => {
    expect(stripEmDashes('Criei a task "E2E Claude - pode apagar" na lista interna.')).toBe(
      'Criei a task "E2E Claude - pode apagar" na lista interna.',
    );
  });

  it('travessão dentro de aspas também sobrevive', () => {
    expect(stripEmDashes('A headline é "Sabor \u2014 e memória" e fecha assim.')).toBe(
      'A headline é "Sabor \u2014 e memória" e fecha assim.',
    );
  });

  it('fora das aspas a regra continua valendo na MESMA frase', () => {
    expect(stripEmDashes('Criei a task "Plano A - fase 1" e sim \u2014 já atribuí.')).toBe(
      'Criei a task "Plano A - fase 1" e sim, já atribuí.',
    );
  });

  it('lista com item citado mantém marcador e citação', () => {
    expect(stripEmDashes('\u2014 item "A - B"\n\u2014 item "C \u2013 D"')).toBe(
      '- item "A - B"\n- item "C \u2013 D"',
    );
  });

  it('aspas não fechadas não engolem o resto do texto', () => {
    expect(stripEmDashes('Ele disse "isso aqui e prossegue \u2014 assim mesmo')).toBe(
      'Ele disse "isso aqui e prossegue, assim mesmo',
    );
  });

  it('nenhuma sentinela vaza pro texto final', () => {
    const saida = stripEmDashes('"a - b" e "c \u2014 d" fora \u2014 dentro');
    expect(saida).not.toMatch(/[\u0011\u0012\u0013]/);
  });
});

describe('corrupção de idioma em resposta PT-BR', () => {
  it('detecta o caso real medido no front (横跨 no meio da frase)', () => {
    expect(temCorrupcaoDeIdioma('Alicia tem 85 tarefas abertas横跨 14 clientes')).toBe(true);
  });

  it('não acusa português normal, com acento e emoji', () => {
    expect(temCorrupcaoDeIdioma('Alícia tem 85 tarefas abertas em 14 clientes 🚨 prazo 15/08')).toBe(false);
  });

  it('não acusa texto vazio nem nulo', () => {
    expect(temCorrupcaoDeIdioma('')).toBe(false);
    expect(temCorrupcaoDeIdioma(null)).toBe(false);
  });

  it('pega cirílico e hangul também', () => {
    expect(temCorrupcaoDeIdioma('prazo привет')).toBe(true);
    expect(temCorrupcaoDeIdioma('prazo 안녕')).toBe(true);
  });

  it('limpeza de última instância tira o glifo e fecha o espaço', () => {
    expect(removerGlifosForaDoIdioma('85 tarefas abertas 横跨 14 clientes')).toBe('85 tarefas abertas 14 clientes');
  });

  it('limpeza não deixa espaço antes de pontuação', () => {
    expect(removerGlifosForaDoIdioma('entrega 横跨, prazo')).toBe('entrega, prazo');
  });
});

/**
 * Regressão da exposição medida em 23/09/2026: o Bento citou o Client ID e o
 * tenant de uma app registration que estava indexada no vault.
 */
describe('redação de identificador na resposta', () => {
  it('esconde o valor mas mantém a frase legível', () => {
    const t = 'A credencial Client ID `3f1849a0-8682-45df-8ea2-b74be305f98b` do tenant institutoalmada.org.';
    const r = redigirIdentificadores(t);
    expect(r).not.toContain('3f1849a0-8682-45df-8ea2-b74be305f98b');
    expect(r).toContain('[não exibido]');
    expect(r).toContain('institutoalmada.org');
  });

  it('pega a forma de tabela markdown', () => {
    const t = '| Tenant ID | `3f1849a0-8682-45df-8ea2-b74be305f98b` |';
    expect(temIdentificadorExposto(t)).toBe(true);
    expect(redigirIdentificadores(t)).not.toContain('3f1849a0');
  });

  it('não mexe em UUID legítimo sem rótulo de credencial', () => {
    const t = 'Veja o artefato em claude.ai/artifact/3f1849a0-8682-45df-8ea2-b74be305f98b';
    expect(temIdentificadorExposto(t)).toBe(false);
    expect(redigirIdentificadores(t)).toBe(t);
  });

  it('não mexe em texto normal', () => {
    const t = 'Alícia tem 85 tarefas abertas em 14 clientes.';
    expect(redigirIdentificadores(t)).toBe(t);
  });
});
