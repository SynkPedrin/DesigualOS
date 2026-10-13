import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * principal.test.ts — quem AUTORIZOU × quem AGE, resolvidos uma vez por request.
 *
 * O que este arquivo prova:
 *  - identidade `person` chega ao principal com personId (pode ser atribuída);
 *  - identidade `shared_account` chega com personId NULL (nunca uma pessoa);
 *  - token legado (sem actorIdentityId) vira `ator: null` e nada mais muda;
 *  - FALHA na resolução (identidade sumida, banco fora) NUNCA derruba a request
 *    — o principal segue no comportamento legado;
 *  - a organização entra na consulta da identidade (fronteira de tenant).
 */

interface Cond {
  op: string;
  column?: string;
  value?: unknown;
  conditions?: Cond[];
}

vi.mock('drizzle-orm', () => {
  const bin = (op: string) => (column: unknown, value: unknown): Cond => ({ op, column: String(column), value });
  const un = (op: string) => (column: unknown): Cond => ({ op, column: String(column) });
  return {
    eq: bin('eq'),
    isNull: un('isNull'),
    gte: bin('gte'),
    desc: (column: unknown): Cond => ({ op: 'desc', column: String(column) }),
    and: (...conditions: Array<Cond | undefined>): Cond => ({ op: 'and', conditions: conditions.filter(Boolean) as Cond[] }),
  };
});

const h = vi.hoisted(() => ({
  membership: null as Record<string, unknown> | null,
  organizacoes: [{ organizationId: 'org1' }],
  identidade: null as null | { source: string; externalId: string },
  condsIdentidade: [] as Cond[],
  resolverAtorResultado: null as unknown,
  resolverAtorFalha: false,
  chamadasResolverAtor: [] as unknown[][],
}));

vi.mock('@desigual-os/database', () => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([['__table', name], ...fields.map((f) => [f, `${name}.${f}`])]) as Record<string, string>;
  return {
    db: {
      select: () => ({
        from: (t: { __table: string }) => {
          if (t.__table === 'operational_identities') {
            return {
              where: (cond: Cond) => {
                h.condsIdentidade.push(cond);
                return Promise.resolve(h.identidade ? [h.identidade] : []);
              },
            };
          }
          return {
            innerJoin: () => ({ where: () => Promise.resolve(h.membership ? [h.membership] : []) }),
            where: () => Promise.resolve(h.organizacoes),
          };
        },
      }),
    },
    schema: {
      organizationMembers: table('organization_members', ['id', 'userId', 'organizationId', 'role']),
      users: table('users', ['id', 'email', 'name', 'active', 'deletedAt', 'authUserId']),
      operationalIdentities: table('operational_identities', ['id', 'organizationId', 'source', 'externalId']),
      mcpSessions: table('mcp_sessions', ['id']),
      operationalEvents: table('operational_events', ['id']),
    },
    resolverAtor: vi.fn(async (...args: unknown[]) => {
      h.chamadasResolverAtor.push(args);
      if (h.resolverAtorFalha) throw new Error('banco indisponível');
      return h.resolverAtorResultado;
    }),
  };
});

vi.mock('@desigual-os/auth', () => ({
  decidirEscopo: (orgs: string[]) => ({ organizationIds: orgs, ehProvider: false }),
  loadUserAccess: async () => ({ roles: [] }),
  organizacaoProvedora: () => 'org-provedora',
}));

import { resolverPrincipal } from './principal';

const MEMBER = {
  userId: 'u-master',
  email: 'master@desigual.com',
  name: 'Pedro Gabriel',
  employeeId: 'e1',
  organizationId: 'org1',
  role: 'MANAGER',
};

function input(actorIdentityId?: string | null) {
  return {
    userId: 'u-master',
    organizationId: 'org1',
    scopesDoToken: ['desigual.read'],
    sessionId: 'sessao-1',
    ...(actorIdentityId !== undefined ? { actorIdentityId } : {}),
  };
}

beforeEach(() => {
  h.membership = MEMBER;
  h.organizacoes = [{ organizationId: 'org1' }];
  h.identidade = null;
  h.condsIdentidade = [];
  h.resolverAtorResultado = null;
  h.resolverAtorFalha = false;
  h.chamadasResolverAtor = [];
});

describe('resolverPrincipal — a identidade que AGE', () => {
  it('person: ator chega com personId — esta identidade PODE ser atribuída', async () => {
    h.identidade = { source: 'claude', externalId: 'conn-pedro-claude' };
    h.resolverAtorResultado = {
      identityId: 'ident-1', nome: 'Pedro Claude', actorType: 'person', personId: 'pessoa-pedro',
      membros: [], organizationId: 'org1',
    };

    const principal = await resolverPrincipal(input('ident-1'));

    expect(principal).not.toBeNull();
    expect(principal!.ator).toEqual({
      identityId: 'ident-1',
      displayName: 'Pedro Claude',
      actorType: 'person',
      personId: 'pessoa-pedro',
    });
    // Contraprova: a resolução canônica foi chamada com a origem da LINHA do
    // banco, não com o id solto — sem isto, o teste passaria com o valor certo
    // vindo do lugar errado.
    expect(h.chamadasResolverAtor).toEqual([['org1', 'claude', 'conn-pedro-claude']]);
    // Quem autorizou continua sendo o master — as duas identidades coexistem.
    expect(principal!.userId).toBe('u-master');
    expect(principal!.name).toBe('Pedro Gabriel');
  });

  it('shared_account: ator chega com personId NULL — nunca uma pessoa, mesmo que a resolução trouxesse uma', async () => {
    h.identidade = { source: 'claude', externalId: 'conn-atendimento' };
    h.resolverAtorResultado = {
      identityId: 'ident-2', nome: 'Equipe Atendimento', actorType: 'shared_account', personId: null,
      membros: [
        { personId: 'p-tammy', nome: 'Tammy' },
        { personId: 'p-alicia', nome: 'Alicia' },
        { personId: 'p-jamile', nome: 'Jamile' },
      ],
      organizationId: 'org1',
    };

    const principal = await resolverPrincipal(input('ident-2'));

    expect(principal!.ator).toEqual({
      identityId: 'ident-2',
      displayName: 'Equipe Atendimento',
      actorType: 'shared_account',
      personId: null,
    });
    // A composição (Tammy/Alicia/Jamile) NÃO vaza para o principal: é
    // informação para explicar ambiguidade, nunca para resolvê-la.
    expect(JSON.stringify(principal!.ator)).not.toContain('Tammy');
  });

  it('token LEGADO (sem actorIdentityId): ator null, fluxo idêntico ao atual', async () => {
    const principal = await resolverPrincipal(input());

    expect(principal).not.toBeNull();
    expect(principal!.ator).toBeNull();
    expect(h.chamadasResolverAtor).toHaveLength(0);
    expect(principal!.scopes.length).toBeGreaterThan(0);
  });

  it('identidade que não existe (ou é de OUTRA organização) vira ator null — a request segue', async () => {
    h.identidade = null; // a consulta por (id, organizationId) não achou nada
    const principal = await resolverPrincipal(input('ident-inexistente'));

    expect(principal).not.toBeNull();
    expect(principal!.ator).toBeNull();
    expect(h.chamadasResolverAtor).toHaveLength(0); // nem chega na resolução canônica
  });

  it('FALHA na resolução canônica não derruba a request — ator null e o turno segue', async () => {
    h.identidade = { source: 'claude', externalId: 'conn-x' };
    h.resolverAtorFalha = true;

    const principal = await resolverPrincipal(input('ident-1'));

    expect(principal).not.toBeNull();
    expect(principal!.ator).toBeNull();
  });

  it('resolução canônica devolvendo null (identidade inativa) vira ator null', async () => {
    h.identidade = { source: 'claude', externalId: 'conn-x' };
    h.resolverAtorResultado = null;

    const principal = await resolverPrincipal(input('ident-1'));

    expect(principal!.ator).toBeNull();
  });

  it('a ORGANIZAÇÃO entra na consulta da identidade — identidade de um tenant não resolve no outro', async () => {
    h.identidade = { source: 'claude', externalId: 'conn-x' };
    h.resolverAtorResultado = {
      identityId: 'ident-1', nome: 'Pedro Claude', actorType: 'person', personId: 'p1', membros: [], organizationId: 'org1',
    };
    await resolverPrincipal(input('ident-1'));

    expect(h.condsIdentidade).toHaveLength(1);
    const texto = JSON.stringify(h.condsIdentidade[0]);
    expect(texto).toContain('operational_identities.id');
    expect(texto).toContain('ident-1');
    expect(texto).toContain('operational_identities.organizationId');
    expect(texto).toContain('org1');
  });

  it('pessoa sem membership ativa continua devolvendo null (comportamento intacto)', async () => {
    h.membership = null;
    const principal = await resolverPrincipal(input('ident-1'));
    expect(principal).toBeNull();
  });
});
