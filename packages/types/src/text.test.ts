import { describe, expect, it } from 'vitest';

import { extractApprovalProposal, stripBlockMarkers, stripEmDashes } from './text';

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
