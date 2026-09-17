import { describe, expect, it } from 'vitest';
import { classificarTurno, projetarBlocoDeCliente, relatarProjecao } from './otto-context-projection.js';

/**
 * O dossiê real da Elite, reduzido à mesma FORMA: identidade e marca curtas,
 * uma seção grande de ClickUp, e lacunas espalhadas. Foi essa forma — não o
 * texto das regras — que fez "me dá 3 títulos" voltar com nome de tarefa.
 */
const DOSSIE = [
  '# BRAIN — ELITE',
  '> Última atualização: 14/09/2026 · Responsável: `[FALTA]`',
  '',
  '## 1. IDENTIFICAÇÃO',
  '- **Segmento:** varejo de joias e moda',
  '- **Onde atua:** `[FALTA]`',
  '- **Quem decide na aprovação:** `[FALTA]`',
  '',
  '## 5. VOZ VERBAL',
  '`[FALTA]` — bloco inteiro. Personalidade, ritmo, formalidade.',
  '',
  '## 12. HISTÓRICO — o que a agência de fato já fez',
  'Campanha Dia das Mães 2026 com as peças Manifesto e Fashion Film.',
  '',
  '## ClickUp (sincronizado em 2026-09-08T01:59:28.850Z)',
  '- Elite, Aniversário 70 anos, SETEMBRO (aberto), com Alicia',
  '- Elite, Ads (aberto), com Jarbas de Andrade',
  '- Elite, Site (pronto), com Alicia',
  '- Elite, Dia dos Namorados 2026 (pronto), com Alicia',
  '',
  '## Evidências encontradas',
  'Layouts quinzenais validados.',
  '',
  '## 9. Lacunas a preencher',
  '- CTA aprovado: `[FALTA]`',
  '- Público: `[FALTA]`',
].join('\n');

describe('classificação do turno', () => {
  it('pedido de artefato é CRIACAO', () => {
    expect(classificarTurno('Me dá 3 títulos.').modo).toBe('CRIACAO');
  });

  it('"Agora faz uma legenda" é CRIACAO, não MISTO: ali "agora" é marcador de discurso', () => {
    expect(classificarTurno('Agora faz uma legenda.').modo).toBe('CRIACAO');
  });

  it('reprovação é REVISAO', () => {
    expect(classificarTurno('Tá com cara de IA.').modo).toBe('REVISAO');
    expect(classificarTurno('Faz de outro jeito então.').modo).toBe('REVISAO');
  });

  it('operational_query_receives_operational_context', () => {
    expect(classificarTurno('E vê como tá operacionalmente.').modo).toBe('OPERACIONAL');
  });

  it('mixed_turn_receives_compact_operational_snapshot: pedido criativo COM estado atual é MISTO', () => {
    expect(classificarTurno('Faz uma legenda considerando o que está pendente hoje.').modo).toBe('MISTO');
  });
});

describe('creative_turn_projects_only_relevant_context', () => {
  it('clickup_dump_is_removed_from_simple_creative_turn', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'CRIACAO');
    expect(p).not.toMatch(/## ClickUp/);
    expect(p).not.toMatch(/Elite, Ads \(aberto\)/);
  });

  it('task_names_are_not_creative_titles: nenhum nome de tarefa sobra pro modelo copiar', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'CRIACAO');
    expect(p).not.toMatch(/Aniversário 70 anos, SETEMBRO/);
  });

  it('a marca e o histórico SOBREVIVEM: é deles que sai a peça', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'CRIACAO');
    expect(p).toMatch(/varejo de joias e moda/);
    expect(p).toMatch(/Dia das Mães 2026/);
    expect(p).toMatch(/VOZ VERBAL/);
  });

  it('soft_gaps_do_not_dominate_creative_prompt: 24 marcações viram uma linha', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'CRIACAO');
    expect((p.match(/\[FALTA\]/g) ?? []).length).toBe(0);
    expect(p).toMatch(/O QUE O DOSSIÊ AINDA NÃO TEM:/);
  });

  it('hard_gap_survives_when_required: o que falta continua NOMEADO, só que uma vez', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'CRIACAO');
    expect(p).toMatch(/Onde atua|Quem decide|VOZ VERBAL/);
    expect(p).toMatch(/entregue, e cite o que falta DEPOIS da peça/);
  });

  it('e o recorte encolhe de verdade', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'CRIACAO');
    expect(p.length).toBeLessThan(DOSSIE.length * 0.8);
  });
});

describe('revision_turn_prioritizes_previous_artifact', () => {
  it('turno de revisão recebe o mesmo recorte criativo', () => {
    expect(projetarBlocoDeCliente(DOSSIE, 'REVISAO')).not.toMatch(/## ClickUp/);
  });
});

describe('context_projection_does_not_break_a2a', () => {
  it('turno operacional recebe o dossiê INTEIRO, com ClickUp e lacunas', () => {
    const p = projetarBlocoDeCliente(DOSSIE, 'OPERACIONAL');
    expect(p).toBe(DOSSIE);
  });

  it('turno misto também: pediu criação COM estado atual, precisa dos dois', () => {
    expect(projetarBlocoDeCliente(DOSSIE, 'MISTO')).toBe(DOSSIE);
  });

  it('turno fora das categorias não é recortado — o padrão é não mexer', () => {
    expect(projetarBlocoDeCliente(DOSSIE, 'OUTRO')).toBe(DOSSIE);
  });
});

describe('observabilidade', () => {
  it('relata o que foi cortado, em números', () => {
    const turno = classificarTurno('Me dá 3 títulos.');
    const r = relatarProjecao(DOSSIE, projetarBlocoDeCliente(DOSSIE, turno.modo), turno);
    expect(r.modo).toBe('CRIACAO');
    expect(r.antes).toBeGreaterThan(r.depois);
    expect(r.lacunasDepois).toBeLessThan(r.lacunasAntes);
  });
});
