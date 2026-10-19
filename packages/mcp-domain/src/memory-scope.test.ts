import { describe, expect, it } from 'vitest';
import { escopoPadrao, filtrarVisiveis, isMemoryScope, MEMORY_SCOPES, podeVer, type MemoryScope } from './memory-scope';

const quem = (over: Partial<Parameters<typeof podeVer>[1]> = {}) => ({
  userId: 'tammy',
  clientesPermitidos: new Set(['cosentino', '3net']),
  podeLerMemoria: true,
  ...over,
});

describe('USER_PRIVATE — a garantia que não pode falhar', () => {
  it('memória privada de OUTRA pessoa nunca aparece', () => {
    expect(podeVer({ scope: 'USER_PRIVATE', userId: 'endrigo' }, quem())).toBe(false);
  });

  it('a própria memória privada aparece', () => {
    expect(podeVer({ scope: 'USER_PRIVATE', userId: 'tammy' }, quem())).toBe(true);
  });

  it('NEM COM TODAS AS PERMISSÕES a privada de outro vaza', () => {
    // Não existe papel que atravesse. Um admin que lê tudo transforma o
    // escopo privado em teatro.
    const admin = quem({ userId: 'pedro', podeLerMemoria: true, clientesPermitidos: new Set(['cosentino', '3net', 'qualquer']) });
    expect(podeVer({ scope: 'USER_PRIVATE', userId: 'tammy' }, admin)).toBe(false);
  });

  it('privada SEM dono não aparece para ninguém', () => {
    // Dono ausente é dado corrompido: o seguro é esconder, não mostrar.
    expect(podeVer({ scope: 'USER_PRIVATE', userId: null }, quem())).toBe(false);
    expect(podeVer({ scope: 'USER_PRIVATE' }, quem())).toBe(false);
  });

  it('VARREDURA: nenhum escopo além do próprio USER_PRIVATE vaza entre pessoas', () => {
    for (const scope of MEMORY_SCOPES) {
      const deOutro = { scope, userId: 'endrigo', clientId: 'cosentino' };
      const visivel = podeVer(deOutro, quem());
      if (scope === 'USER_PRIVATE') expect(visivel, scope).toBe(false);
      else expect(visivel, scope).toBe(true);
    }
  });
});

describe('CLIENT — segue a fronteira de cliente', () => {
  it('cliente permitido aparece; cliente de fora, não', () => {
    expect(podeVer({ scope: 'CLIENT', clientId: 'cosentino' }, quem())).toBe(true);
    expect(podeVer({ scope: 'CLIENT', clientId: 'outro-cliente' }, quem())).toBe(false);
  });

  it('memória de cliente SEM cliente não aparece', () => {
    expect(podeVer({ scope: 'CLIENT', clientId: null }, quem())).toBe(false);
  });
});

describe('sem memory.read, nada de memória — menos a própria', () => {
  it('escopos compartilhados ficam fora', () => {
    const viewer = quem({ podeLerMemoria: false });
    for (const scope of ['AGENCY', 'CLIENT', 'EMPLOYEE', 'DELIVERY_TYPE', 'CAMPAIGN', 'PROCESS'] as MemoryScope[]) {
      expect(podeVer({ scope, clientId: 'cosentino' }, viewer), scope).toBe(false);
    }
  });

  it('mas a própria privada continua visível — é dela', () => {
    expect(podeVer({ scope: 'USER_PRIVATE', userId: 'tammy' }, quem({ podeLerMemoria: false }))).toBe(true);
  });
});

describe('filtrarVisiveis — é o que as tools usam', () => {
  it('separa o que pode do que não pode numa lista real', () => {
    const lista = [
      { id: 1, scope: 'AGENCY' as const },
      { id: 2, scope: 'USER_PRIVATE' as const, userId: 'endrigo' },
      { id: 3, scope: 'USER_PRIVATE' as const, userId: 'tammy' },
      { id: 4, scope: 'CLIENT' as const, clientId: 'cosentino' },
      { id: 5, scope: 'CLIENT' as const, clientId: 'cliente-de-fora' },
    ];
    expect(filtrarVisiveis(lista, quem()).map((m) => m.id)).toEqual([1, 3, 4]);
  });

  it('lista vazia não quebra', () => {
    expect(filtrarVisiveis([], quem())).toEqual([]);
  });
});

describe('escopoPadrao — nunca adivinha privado', () => {
  it('deduz pelo que veio', () => {
    expect(escopoPadrao({ clientId: 'c1' })).toBe('CLIENT');
    expect(escopoPadrao({ campaignId: 'k1' })).toBe('CAMPAIGN');
    expect(escopoPadrao({ employeeId: 'e1' })).toBe('EMPLOYEE');
    expect(escopoPadrao({})).toBe('AGENCY');
  });

  it('NUNCA devolve USER_PRIVATE por dedução', () => {
    // Privado é escolha explícita. Adivinhar privado esconderia da equipe
    // algo que era pra ser compartilhado, e ninguém perceberia.
    for (const input of [{}, { clientId: 'c' }, { employeeId: 'e' }, { campaignId: 'k' }]) {
      expect(escopoPadrao(input)).not.toBe('USER_PRIVATE');
    }
  });

  it('escopo desconhecido é recusado', () => {
    expect(isMemoryScope('QUALQUER_COISA')).toBe(false);
    expect(isMemoryScope('AGENCY')).toBe(true);
  });
});
