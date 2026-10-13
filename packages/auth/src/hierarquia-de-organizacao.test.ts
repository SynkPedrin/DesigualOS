import { describe, expect, it } from 'vitest';
import {
  administraOrganizacao,
  descendentesTransitivos,
  orgsVisiveisParaLeitura,
  podeCriarSubconta,
  podeEscreverNaOrganizacao,
  type NoDaArvore,
} from './hierarquia-de-organizacao';

/**
 * A REGRA DO WHITE LABEL: leitura desce, escrita não atravessa.
 *
 * A árvore dos testes:
 *
 *   DESIGUAL (provedora)
 *   AGENCIA ── CLIENTE_A ── NETO_A
 *          └─ CLIENTE_B
 *
 * Se estes testes caírem, ou uma agência deixou de ver a própria carteira, ou
 * — pior, e em silêncio — um cliente passou a enxergar a agência ou o
 * concorrente do lado.
 */
const ARVORE: NoDaArvore[] = [
  { id: 'desigual', parentId: null },
  { id: 'agencia', parentId: null },
  { id: 'cliente-a', parentId: 'agencia' },
  { id: 'cliente-b', parentId: 'agencia' },
  { id: 'neto-a', parentId: 'cliente-a' },
];

describe('leitura desce', () => {
  it('dono da agência lê a agência, os filhos e o neto (transitivo)', () => {
    const visiveis = orgsVisiveisParaLeitura({
      orgAtiva: 'agencia',
      papelNaAtiva: 'owner',
      ehProvider: false,
      arvore: ARVORE,
    });

    expect(visiveis.sort()).toEqual(['agencia', 'cliente-a', 'cliente-b', 'neto-a']);
  });

  it('admin também descende; caixa do papel não importa', () => {
    expect(administraOrganizacao('SUPER_ADMIN')).toBe(true);
    expect(administraOrganizacao('Admin')).toBe(true);

    const visiveis = orgsVisiveisParaLeitura({
      orgAtiva: 'agencia',
      papelNaAtiva: 'ADMIN',
      ehProvider: false,
      arvore: ARVORE,
    });
    expect(visiveis).toContain('neto-a');
  });

  it('provider lê a subárvore mesmo sem papel na empresa (visita como plataforma)', () => {
    const visiveis = orgsVisiveisParaLeitura({
      orgAtiva: 'agencia',
      papelNaAtiva: null,
      ehProvider: true,
      arvore: ARVORE,
    });

    expect(visiveis).toContain('cliente-a');
    expect(visiveis).toContain('neto-a');
  });
});

describe('a assimetria é o produto', () => {
  it('filho NÃO lê o pai — nem sendo dono da própria conta', () => {
    const visiveis = orgsVisiveisParaLeitura({
      orgAtiva: 'cliente-a',
      papelNaAtiva: 'owner',
      ehProvider: false,
      arvore: ARVORE,
    });

    expect(visiveis.sort()).toEqual(['cliente-a', 'neto-a']);
    expect(visiveis).not.toContain('agencia');
  });

  it('filho NÃO lê o irmão — subconta não enxerga subconta vizinha', () => {
    const visiveis = orgsVisiveisParaLeitura({
      orgAtiva: 'cliente-a',
      papelNaAtiva: 'owner',
      ehProvider: false,
      arvore: ARVORE,
    });

    expect(visiveis).not.toContain('cliente-b');
  });

  it('colaborador da agência não vê a carteira: só quem responde pela conta descende', () => {
    const visiveis = orgsVisiveisParaLeitura({
      orgAtiva: 'agencia',
      papelNaAtiva: 'collaborator',
      ehProvider: false,
      arvore: ARVORE,
    });

    expect(visiveis).toEqual(['agencia']);
  });
});

describe('escrita não atravessa, nunca', () => {
  it('dono da agência NÃO escreve na subconta sem entrar nela', () => {
    expect(podeEscreverNaOrganizacao('agencia', 'cliente-a')).toBe(false);
    expect(podeEscreverNaOrganizacao('agencia', 'neto-a')).toBe(false);
  });

  it('escrever na própria empresa ativa continua valendo', () => {
    expect(podeEscreverNaOrganizacao('agencia', 'agencia')).toBe(true);
  });
});

describe('quem cria subconta', () => {
  it('provider cria subconta de qualquer empresa', () => {
    expect(podeCriarSubconta({ ehProvider: true, papelNoPai: null })).toBe(true);
  });

  it('dono/admin do pai cria subconta dele', () => {
    expect(podeCriarSubconta({ ehProvider: false, papelNoPai: 'owner' })).toBe(true);
    expect(podeCriarSubconta({ ehProvider: false, papelNoPai: 'admin' })).toBe(true);
  });

  it('membro comum NÃO cria — abrir tenant não é decisão de quem só trabalha nele', () => {
    expect(podeCriarSubconta({ ehProvider: false, papelNoPai: 'collaborator' })).toBe(false);
    expect(podeCriarSubconta({ ehProvider: false, papelNoPai: null })).toBe(false);
  });
});

describe('a árvore em si', () => {
  it('raiz não tem descendentes por cima dela; empresa solta desce vazio', () => {
    expect(descendentesTransitivos(ARVORE, 'desigual')).toEqual([]);
    expect(descendentesTransitivos(ARVORE, 'neto-a')).toEqual([]);
    expect(descendentesTransitivos([], 'agencia')).toEqual([]);
  });

  /**
   * Ciclo é impossível por construção (parent_id só nasce na criação,
   * apontando para quem já existia) — mas se um dia alguém escrever um UPDATE
   * de parent_id, um ciclo corrompido vira resposta vazia, não loop infinito.
   */
  it('ciclo corrompido termina em vez de girar para sempre', () => {
    const corrompida: NoDaArvore[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(descendentesTransitivos(corrompida, 'a')).toEqual(['b']);
  });
});
