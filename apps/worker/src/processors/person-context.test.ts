import { describe, expect, it } from 'vitest';
import { candidatosAPessoa, formatPersonBlock } from './person-context';

/**
 * Regressões do caso Esther (16/09/2026): o Bento afirmou que ela era
 * responsável pela conta D. Carvalho. A relação não existe — e a própria Esther
 * não aparece em nenhuma fonte autorizada (auditado: 0 de 19 membros, 0 de
 * 7.408 tasks, 0 de 1.285 comentários, 0 no banco, 0 nos vaults).
 */
describe('formatPersonBlock', () => {
  it('person_mention_does_not_imply_client_ownership', () => {
    const b = formatPersonBlock({
      encontradas: [{
        id: 'p1', canonicalName: 'Gui', employmentType: 'agency_member', activeStatus: 'active',
        relacoes: [{ clientId: 'c1', clientName: 'D. Carvalho', relationType: 'TASK_ASSIGNEE', temporalStatus: 'current', evidenceCount: 42, lastSeenAt: null }],
      }],
      naoEncontradas: [],
    });
    expect(b).toContain('D. Carvalho');
    expect(b).toMatch(/N[ÃA]O significa que responde pela conta/i);
    expect(b).toMatch(/s[óo] afirme que algu[ée]m responde por uma conta/i);
  });

  it('task_assignment_does_not_imply_account_ownership', () => {
    const b = formatPersonBlock({
      encontradas: [{
        id: 'p1', canonicalName: 'Tammy', employmentType: 'agency_member', activeStatus: 'active',
        relacoes: [{ clientId: 'c1', clientName: 'Cosentino', relationType: 'TASK_ASSIGNEE', temporalStatus: 'current', evidenceCount: 10, lastSeenAt: null }],
      }],
      naoEncontradas: [],
    });
    expect(b).not.toMatch(/responde pela conta \(relação registrada/);
    expect(b).toMatch(/trabalho\s+pontual N[ÃA]O é membro fixo do squad/i);
  });

  it('pessoa inexistente é declarada ausente, nunca inventada', () => {
    const b = formatPersonBlock({ encontradas: [], naoEncontradas: ['Esther'] });
    expect(b).toContain('Esther');
    expect(b).toContain('NÃO EXISTE no registro');
    expect(b).toMatch(/N[ÃA]O invente função, cliente ou relação/i);
  });

  it('inactive_people_are_not_presented_as_current_team', () => {
    const b = formatPersonBlock({
      encontradas: [{
        id: 'p1', canonicalName: 'Oscar Menezes', employmentType: 'external', activeStatus: 'unknown',
        relacoes: [{ clientId: 'c1', clientName: 'D. Carvalho', relationType: 'TASK_ASSIGNEE', temporalStatus: 'historical', evidenceCount: 3, lastSeenAt: null }],
      }],
      naoEncontradas: [],
    });
    expect(b).toContain('HISTÓRICO');
    expect(b).toMatch(/N[ÃA]O está no diretório do workspace/i);
  });

  it('pessoa sem relação não recebe cliente algum', () => {
    const b = formatPersonBlock({
      encontradas: [{ id: 'p1', canonicalName: 'Gi', employmentType: 'agency_member', activeStatus: 'active', relacoes: [] }],
      naoEncontradas: [],
    });
    expect(b).toMatch(/Nenhuma relação com cliente registrada/i);
    expect(b).toMatch(/N[ÃA]O atribua nenhum cliente/i);
  });

  it('turno sem pessoa citada não gera bloco', () => {
    expect(formatPersonBlock({ encontradas: [], naoEncontradas: [] })).toBe('');
  });
});

describe('candidatosAPessoa', () => {
  it('pega o nome citado sem confundir com o começo da frase', () => {
    expect(candidatosAPessoa('Liste as demandas da Esther')).toEqual(['Esther']);
    expect(candidatosAPessoa('Agora me diga as demandas da Alícia')).toContain('Alícia');
  });

  it('pega nome composto', () => {
    expect(candidatosAPessoa('quais tarefas da Ana Luiza?')).toEqual(expect.arrayContaining(['Ana', 'Luiza']));
  });
});
