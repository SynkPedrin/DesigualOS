import { describe, expect, it } from 'vitest';
import { decidirAcessoAoQuadro } from './routes';

/**
 * A REGRA DE PROPRIEDADE DOS QUADROS, nas dezesseis combinações.
 *
 * O produto pede duas coisas ao mesmo tempo: a AGÊNCIA tem quadros que todo
 * mundo da empresa vê, e CADA PESSOA tem os dela, que ela organiza do jeito
 * que quiser. Isso vira quatro regras que interagem — empresa, dono, papel e
 * a escolha entre 404 e 403 — e três delas só aparecem no caminho infeliz,
 * que é exatamente o que teste de integração feliz não percorre.
 */
const ORG = 'org-1';
const OUTRA_ORG = 'org-2';
const EU = 'user-eu';
const OUTRO = 'user-outro';

const daAgencia = { organizationId: ORG, ownerId: null };
const meu = { organizationId: ORG, ownerId: EU };
const doOutro = { organizationId: ORG, ownerId: OUTRO };

const colaborador = { userId: EU, roles: ['colaborador'] as const, organizationId: ORG };
const admin = { userId: EU, roles: ['master'] as const, organizationId: ORG };

describe('decidirAcessoAoQuadro', () => {
  it('meu quadro é meu: colaborador escreve no próprio sem pedir nada a ninguém', () => {
    expect(decidirAcessoAoQuadro(meu, colaborador)).toBe('pode');
  });

  it('quadro da agência: administrador escreve', () => {
    expect(decidirAcessoAoQuadro(daAgencia, admin)).toBe('pode');
  });

  /**
   * 403, não 404: a pessoa VÊ este quadro na tela dela. Dizer "não encontrado"
   * mandaria procurar algo que está bem ali — o que falta é permissão, e a
   * mensagem precisa dizer isso.
   */
  it('quadro da agência: colaborador é barrado por PERMISSÃO, e sabe disso', () => {
    expect(decidirAcessoAoQuadro(daAgencia, colaborador)).toBe('so-administrador');
  });

  /**
   * Ser administrador é um papel sobre a agência, não uma chave mestra do
   * espaço de trabalho de cada pessoa. Se o quadro pessoal de alguém pudesse
   * ser reorganizado por outro, ele deixaria de ser pessoal — que é a única
   * coisa que ele promete.
   */
  it('quadro pessoal de OUTRA pessoa: nem administrador mexe', () => {
    expect(decidirAcessoAoQuadro(doOutro, admin)).toBe('nao-encontrado');
    expect(decidirAcessoAoQuadro(doOutro, colaborador)).toBe('nao-encontrado');
  });

  /** 404 e não 403: confirmar a existência já é contar algo de outra empresa. */
  it('quadro de outra empresa não existe, nem pra administrador', () => {
    expect(decidirAcessoAoQuadro({ organizationId: OUTRA_ORG, ownerId: null }, admin)).toBe('nao-encontrado');
    expect(decidirAcessoAoQuadro({ organizationId: OUTRA_ORG, ownerId: EU }, admin)).toBe('nao-encontrado');
  });

  it('quadro inexistente é nao-encontrado, sem estourar', () => {
    expect(decidirAcessoAoQuadro(null, admin)).toBe('nao-encontrado');
  });

  /**
   * A empresa é conferida ANTES do dono. Sem essa ordem, um quadro meu numa
   * empresa que não é a ativa passaria — e escrita atravessando empresa é
   * exatamente o que o `requireTenant` existe pra impedir.
   */
  it('quadro MEU, mas em outra empresa: continua não encontrado', () => {
    expect(decidirAcessoAoQuadro({ organizationId: OUTRA_ORG, ownerId: EU }, colaborador)).toBe('nao-encontrado');
  });

  it('papel desconhecido não vira administrador por acidente', () => {
    expect(decidirAcessoAoQuadro(daAgencia, { userId: EU, roles: [], organizationId: ORG })).toBe('so-administrador');
    expect(decidirAcessoAoQuadro(daAgencia, { userId: EU, roles: ['gestor'], organizationId: ORG })).toBe('so-administrador');
  });
});
