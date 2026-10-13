import { describe, expect, it } from 'vitest';
import { descreverAtor, podeAtribuirAPessoa, type AtorResolvido } from './resolucao-de-ator';

/**
 * Os casos abaixo são os do produto, com os nomes reais da operação: a conta
 * `atendimento@` é usada por Tammy, Alicia e Jamile; a `criativo@` por Matheus
 * Sain e outros. Nenhum teste aqui aceita que o sistema escolha uma delas.
 */
const PEDRO: AtorResolvido = {
  identityId: 'id-pedro',
  nome: 'Pedro Gabriel',
  actorType: 'person',
  personId: 'people-pedro',
  membros: [],
  organizationId: 'org-desigual',
};

const ATENDIMENTO: AtorResolvido = {
  identityId: 'id-atendimento',
  nome: 'Equipe Atendimento',
  actorType: 'shared_account',
  personId: null,
  membros: [
    { personId: 'people-tammy', nome: 'Tammy' },
    { personId: 'people-alicia', nome: 'Alicia' },
    { personId: 'people-jamile', nome: 'Jamile Galdino' },
  ],
  organizationId: 'org-desigual',
};

const CRIATIVO: AtorResolvido = {
  identityId: 'id-criativo',
  nome: 'Equipe Criativa',
  actorType: 'shared_account',
  personId: null,
  membros: [{ personId: 'people-sain', nome: 'Matheus Sain' }],
  organizationId: 'org-desigual',
};

describe('podeAtribuirAPessoa — a regra que impede autoria inventada', () => {
  it('identidade individual pode ser atribuída', () => {
    expect(podeAtribuirAPessoa(PEDRO)).toBe(true);
  });

  it('conta compartilhada NUNCA pode ser atribuída a uma pessoa', () => {
    expect(podeAtribuirAPessoa(ATENDIMENTO)).toBe(false);
  });

  /**
   * O CASO QUE PARECE INOFENSIVO E NÃO É. Hoje só o Sain usa a `criativo@`;
   * se o sistema atribuísse a ele por ser o único membro, o histórico ficaria
   * com o nome dele gravado — e amanhã, quando entrar mais gente na conta, não
   * haveria como distinguir o que foi dele do que foi dos outros.
   */
  it('conta compartilhada com UM membro só também não atribui', () => {
    expect(podeAtribuirAPessoa(CRIATIVO)).toBe(false);
  });

  it('identidade de pessoa sem personId não atribui', () => {
    expect(podeAtribuirAPessoa({ ...PEDRO, personId: null })).toBe(false);
  });
});

describe('descreverAtor — como o agente fala do ator', () => {
  it('pessoa é chamada pelo nome, sem ressalva', () => {
    expect(descreverAtor(PEDRO)).toBe('Pedro Gabriel');
  });

  /**
   * A frase precisa fazer DUAS coisas: dar a informação útil (quem usa a
   * conta) e negar explicitamente a atribuição. Só uma das duas não serve —
   * citar os nomes sem a negativa convida o leitor a escolher.
   */
  it('conta compartilhada nomeia a equipe, lista quem usa e NEGA a atribuição', () => {
    const frase = descreverAtor(ATENDIMENTO);
    expect(frase).toContain('Equipe Atendimento');
    expect(frase).toContain('Tammy');
    expect(frase).toContain('Jamile Galdino');
    expect(frase).toMatch(/não é possível atribuir/i);
  });

  it('conta compartilhada sem membros cadastrados ainda se declara compartilhada', () => {
    expect(descreverAtor({ ...ATENDIMENTO, membros: [] })).toContain('conta compartilhada');
  });

  it('automação é marcada como automação, não como gente', () => {
    const servico: AtorResolvido = { ...PEDRO, nome: 'Rotina noturna', actorType: 'service', personId: null };
    expect(descreverAtor(servico)).toContain('automação');
  });

  /**
   * TESTE H DO BRIEFING: "Foi a Tammy quem registrou isso?" com origem em conta
   * compartilhada. A descrição NUNCA pode produzir uma frase que afirme a
   * Tammy como autora.
   */
  it('a descrição nunca afirma uma pessoa como autora em conta compartilhada', () => {
    const frase = descreverAtor(ATENDIMENTO);
    expect(frase).not.toMatch(/^Tammy/);
    expect(frase).not.toMatch(/Tammy (fez|registrou|criou)/i);
  });
});
