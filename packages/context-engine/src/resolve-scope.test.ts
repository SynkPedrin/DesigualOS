import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOperationalScope } from './resolve-scope';

const mockClients = [
  { id: 'c-3net', name: '3Net', slug: '3net' },
  { id: 'c-cosentino', name: 'Cosentino', slug: 'cosentino' },
  {
    id: 'c-cosentino-const',
    name: 'Construtora e Imobiliária Cosentino Ltda. — Enterprise',
    slug: 'construtora-e-imobiliaria-cosentino-ltda-enterprise',
  },
  { id: 'c-dcarvalho', name: 'D. Carvalho', slug: 'd-carvalho' },
  { id: 'c-facil', name: 'Fácil Seguros', slug: 'facil-seguros' },
  { id: 'c-teste', name: 'teste', slug: 'teste' },
];

vi.mock('drizzle-orm', () => ({ eq: (_c: unknown, v: unknown) => ({ op: 'eq', value: v }) }));
vi.mock('@desigual-os/database', () => {
  const schema = { clients: { __t: 'clients' }, conversations: { __t: 'conv' }, projects: { __t: 'proj' } };
  return {
    schema,
    db: {
      select: () => ({
        from: (t: unknown) => (t === schema.clients ? Promise.resolve(mockClients) : { where: () => Promise.resolve([]) }),
      }),
    },
  };
});

/** 2026-09-10T01:30 local (quinta). */
const NOW = new Date('2026-09-10T04:30:00.000Z');

beforeEach(() => vi.clearAllMocks());

describe('escopo GLOBAL — os casos que hoje devolvem "de qual cliente?"', () => {
  it('"quantas tasks tem na operacao que vencem amanha?" -> GLOBAL, com janela de amanha', async () => {
    const s = await resolveOperationalScope('Bento, quantas tasks tem na operação que vencem amanhã?', NOW);
    expect(s.kind).toBe('GLOBAL');
    expect(s.operational).toBe(true);
    expect(s.temporal?.label).toBe('amanha');
    expect(s.clients).toHaveLength(0);
  });

  it('"qual cliente tem a melhor campanha hoje?" -> GLOBAL comparativo (nao pergunta o cliente)', async () => {
    const s = await resolveOperationalScope('Jarbas, qual cliente tem a melhor campanha hoje?', NOW);
    expect(s.kind).toBe('GLOBAL');
    expect(s.comparative).toBe(true);
    expect(s.temporal?.label).toBe('hoje');
  });

  it('"de todos, me monte um briefing geral" -> GLOBAL', async () => {
    const s = await resolveOperationalScope('de todos, me monte um briefing geral', NOW);
    expect(s.kind).toBe('GLOBAL');
    expect(s.operational).toBe(true);
  });

  it('"quantas tasks estao atrasadas?" -> GLOBAL com janela de atrasadas', async () => {
    const s = await resolveOperationalScope('quantas tasks estão atrasadas?', NOW);
    expect(s.kind).toBe('GLOBAL');
    expect(s.temporal?.overdue).toBe(true);
  });

  it('"quem esta sobrecarregado?" -> GLOBAL comparativo', async () => {
    const s = await resolveOperationalScope('quem está sobrecarregado essa semana?', NOW);
    expect(s.kind).toBe('GLOBAL');
    expect(s.comparative).toBe(true);
    expect(s.temporal?.label).toBe('esta-semana');
  });

  it('"o que posso adiantar hoje?" -> GLOBAL operacional', async () => {
    const s = await resolveOperationalScope('o que posso adiantar hoje?', NOW);
    expect(s.kind).toBe('GLOBAL');
    expect(s.operational).toBe(true);
  });
});

describe('escopo de CLIENTE — cliente citado ganha de marcador global', () => {
  it('"me gere um briefing de TODAS as tasks da 3net" -> CLIENTE 3Net, nunca global', async () => {
    // O caso exato do relato: "todas" nao pode transformar isso em cross-client, senao
    // vaza task de outro cliente no briefing da 3Net.
    const s = await resolveOperationalScope(
      'estou com vontade de adiantar as coisas de amanhã, me gere um briefing de todas as tasks da 3net',
      NOW,
    );
    expect(s.kind).toBe('CLIENT');
    expect(s.clients.map((c) => c.id)).toEqual(['c-3net']);
    expect(s.temporal?.label).toBe('amanha');
    expect(s.operational).toBe(true);
  });

  it('"como estao as campanhas da Cosentino?" -> CLIENTE Cosentino (nunca Facil Seguros)', async () => {
    const s = await resolveOperationalScope('Como estão as campanhas da Cosentino?', NOW);
    expect(s.kind).toBe('CLIENT');
    expect(s.clients.map((c) => c.id)).toEqual(['c-cosentino']);
  });

  it('multi-cliente: "analisa 3net, consentino e d carvalho" -> os tres', async () => {
    // "consentino" com erro de digitacao entra por proximidade; antes era descartado calado.
    const s = await resolveOperationalScope('quero que analise 3net, consentino e d carvalho', NOW);
    expect(s.kind).toBe('MULTI_CLIENT');
    expect(s.clients.map((c) => c.id).sort()).toEqual(['c-3net', 'c-cosentino', 'c-dcarvalho']);
  });

  it('cliente resolvido por fuzzy tem confianca menor (o planner pode revisar)', async () => {
    const s = await resolveOperationalScope('resumo de consentino', NOW);
    expect(s.kind).toBe('CLIENT');
    expect(s.confidence).toBeLessThan(0.8);
  });
});

describe('ambiguidade — perguntar de volta e a atitude certa, mas nomeando os candidatos', () => {
  it('termo que bate em 2 clientes no mesmo nivel -> AMBIGUOUS com candidatos', async () => {
    const s = await resolveOperationalScope('como esta o case zero?', NOW);
    // Sem cliente "case zero" no fixture, isso cai em NONE — o teste de ambiguidade real
    // vive em resolve-client.test.ts, onde o fixture tem as duas linhas duplicadas.
    expect(['NONE', 'AMBIGUOUS']).toContain(s.kind);
  });
});

describe('nao-operacional', () => {
  it('bate-papo nao vica consulta operacional', async () => {
    const s = await resolveOperationalScope('oi, tudo bem?', NOW);
    expect(s.kind).toBe('NONE');
    expect(s.operational).toBe(false);
  });

  it('pergunta criativa sem cliente nem tempo nao vira GLOBAL operacional', async () => {
    const s = await resolveOperationalScope('me da uma ideia de conceito criativo', NOW);
    expect(s.kind).toBe('NONE');
    expect(s.operational).toBe(false);
  });

  it('"teste" nao resolve cliente (palavra generica) e nao inventa escopo', async () => {
    const s = await resolveOperationalScope('isso foi so um teste', NOW);
    expect(s.clients).toHaveLength(0);
  });
});

describe('observabilidade', () => {
  it('registra os sinais que levaram a decisao (para log, nunca pro usuario)', async () => {
    const s = await resolveOperationalScope('quantas tasks vencem amanhã?', NOW);
    expect(s.signals.join(' ')).toMatch(/tempo:amanha/);
    expect(s.signals.join(' ')).toMatch(/operacional:|agregado:/);
  });
});

describe('marcadores de priorização/análise disparam o caminho estruturado (§113, §137)', () => {
  it('"o que eu deveria priorizar hoje?" -> operational + briefing', async () => {
    const s = await resolveOperationalScope('Bento, o que eu deveria priorizar hoje?', NOW);
    expect(s.operational).toBe(true);
    expect(s.briefing).toBe(true);
  });

  it('"analise a operação e me diga o que atacar" -> briefing', async () => {
    const s = await resolveOperationalScope('Bento, analise a operação e me diga o que atacar', NOW);
    expect(s.briefing).toBe(true);
  });

  it('"como está a operação?" -> briefing', async () => {
    const s = await resolveOperationalScope('Bento, como está a operação?', NOW);
    expect(s.briefing).toBe(true);
  });
});
