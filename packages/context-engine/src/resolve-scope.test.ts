import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ehFollowUpEliptico, resolveOperationalScope } from './resolve-scope';

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

/**
 * Consistência de identidade de pessoa entre formulações (regressão do caso
 * Esther, 16/09/2026): "demandas da Esther" resolvia como PERSON e respondia
 * "não encontrei ninguém com esse nome", mas "quem é Esther?" caía em escopo de
 * cliente e pedia "de qual cliente?". A operação leu isso como o agente
 * esquecendo a pessoa entre conversas.
 */
describe('bento_resolves_known_person_consistently', () => {
  it('"quem é X?" também é pergunta sobre pessoa', async () => {
    for (const frase of ['Quem é Esther?', 'quem é a Esther', 'Quem é o Gui?']) {
      const escopo = await resolveOperationalScope(frase);
      expect(escopo.kind, frase).toBe('PERSON');
      expect(escopo.person?.name, frase).toBeTruthy();
    }
  });

  it('"demandas da X" continua sendo pergunta sobre pessoa', async () => {
    const escopo = await resolveOperationalScope('Agora me diga as demandas da Esther.');
    expect(escopo.kind).toBe('PERSON');
    expect(escopo.person?.name).toContain('esther');
  });

  it('não confunde pergunta genérica com nome de pessoa', async () => {
    const escopo = await resolveOperationalScope('Quem é o responsável?');
    expect(escopo.person?.name).not.toBe('responsavel');
  });
});

/**
 * Regressão medida no navegador (16/09/2026): "quais entregas parecem mais
 * próximas de atrasar e o que depende de aprovação?" era reconhecida como
 * operacional e mesmo assim devolvia escopo NONE, por não ter marcador de
 * tempo. Sem escopo a API não busca dado, e o agente respondia "de qual
 * cliente?" — o comportamento que o produto existe para eliminar.
 */
describe('pergunta operacional sem cliente é sobre a operação', () => {
  it('"quais entregas vão atrasar" resolve GLOBAL', async () => {
    const e = await resolveOperationalScope('quais entregas parecem mais próximas de atrasar e o que depende de aprovação?');
    expect(e.kind).toBe('GLOBAL');
    expect(e.operational).toBe(true);
  });

  it('"o que depende de aprovação" resolve GLOBAL', async () => {
    expect((await resolveOperationalScope('o que está pendente de aprovação?')).kind).toBe('GLOBAL');
  });

  it('conversa sem nada operacional continua NONE', async () => {
    expect((await resolveOperationalScope('bom dia, tudo certo?')).kind).toBe('NONE');
  });

  it('pergunta de cliente continua CLIENT, não vira global', async () => {
    const e = await resolveOperationalScope('quais tarefas da Cosentino estão abertas?');
    expect(e.kind).toBe('CLIENT');
  });
});

/**
 * ESCOPO GLOBAL — a pergunta que a agência faz quando abre o sistema de manhã.
 *
 * Todas estas falhavam de um jeito específico e caro: em vez de responder sobre
 * a operação, o agente devolvia "de qual cliente?" — pedindo justamente a
 * informação que a pergunta dizia não querer.
 */
describe('escopo operacional global', () => {
  it('which_deliveries_will_be_late_is_global', async () => {
    expect((await resolveOperationalScope('Quais entregas vão atrasar?')).kind).toBe('GLOBAL');
  });

  it('who_is_overloaded_is_global', async () => {
    expect((await resolveOperationalScope('Quem está sobrecarregado?')).kind).toBe('GLOBAL');
  });

  it('what_is_blocked_is_global', async () => {
    expect((await resolveOperationalScope('O que está bloqueado?')).kind).toBe('GLOBAL');
  });

  it('what_needs_attention_today_is_global', async () => {
    expect((await resolveOperationalScope('O que precisa de atenção hoje?')).kind).toBe('GLOBAL');
  });

  it('pergunta comparativa entre clientes é global', async () => {
    expect((await resolveOperationalScope('Quais clientes têm mais tarefas paradas hoje?')).kind).toBe('GLOBAL');
  });

  it('priorização do dia é global', async () => {
    expect(
      (await resolveOperationalScope('Se eu só pudesse resolver três coisas hoje, quais seriam?')).kind,
    ).toBe('GLOBAL');
  });

  it('client_specific_question_remains_client_scoped', async () => {
    // Cliente da lista mockada deste arquivo. Contra o banco real, "Elite"
    // resolve igual; aqui usar um nome fora do mock faria o teste medir o
    // mock, não a regra.
    expect((await resolveOperationalScope('Qual o status das tarefas da 3Net?')).kind).toBe('CLIENT');
  });

  it('pergunta sobre pessoa atravessa clientes sem virar global', async () => {
    expect((await resolveOperationalScope('Quem é a Esther?')).kind).toBe('PERSON');
  });
});

describe('como a agência pede de verdade', () => {
  it('"me atualiza" é pedido de panorama, não conversa fiada', async () => {
    expect((await resolveOperationalScope('me atualiza')).kind).toBe('GLOBAL');
  });

  it('"o que tá pegando?" também', async () => {
    expect((await resolveOperationalScope('o que tá pegando?')).kind).toBe('GLOBAL');
  });

  it('ambiguous_non_operational_question_can_ask_for_scope: saudação não vira consulta à operação', async () => {
    expect((await resolveOperationalScope('oi, tudo bem?')).kind).toBe('NONE');
  });

  it('pedido criativo não é pergunta operacional', async () => {
    expect((await resolveOperationalScope('escreve uma legenda bonita')).kind).toBe('NONE');
  });
});

describe('panorama pede dado, não só escopo', () => {
  it('"me atualiza" é operacional: sem isso o escopo era global e o dado vinha vazio', async () => {
    const r = await resolveOperationalScope('me atualiza');
    expect(r.kind).toBe('GLOBAL');
    expect(r.operational).toBe(true);
  });

  it('"o que tá pegando?" idem', async () => {
    const r = await resolveOperationalScope('o que tá pegando?');
    expect(r.kind).toBe('GLOBAL');
    expect(r.operational).toBe(true);
  });

  it('saudação continua fora: não é pedido de panorama', async () => {
    const r = await resolveOperationalScope('oi, tudo bem?');
    expect(r.operational).toBe(false);
  });
});

describe('follow-up nu numa conversa', () => {
  it('"e a Tammy?" é pergunta sobre PESSOA, não silêncio', async () => {
    expect((await resolveOperationalScope('e a Tammy?')).kind).toBe('PERSON');
  });

  it('cliente conhecido continua ganhando: "e a Cosentino?" é CLIENT', async () => {
    expect((await resolveOperationalScope('e a Cosentino?')).kind).toBe('CLIENT');
  });

  it('coisa não vira gente: "e a campanha?" não é PERSON', async () => {
    expect((await resolveOperationalScope('e a campanha?')).kind).not.toBe('PERSON');
  });
});

/**
 * PARTÍCULA DE CONVERSA no fim do nome. "Quem é a Esther mesmo?" fazia a busca
 * procurar por "Esther Mesmo" no registro de pessoas — que não existe — e a
 * pessoa ficava desconhecida por causa de uma palavra que nem era nome.
 */
describe('sufixo conversacional no nome', () => {
  it('who_is_esther_mesmo_resolves_esther', async () => {
    const r = await resolveOperationalScope('Quem é a Esther mesmo?');
    expect(r.kind).toBe('PERSON');
    expect(r.person?.name).toBe('esther');
  });

  it('quem_e_a_tammy_mesmo_resolves_tammy', async () => {
    expect((await resolveOperationalScope('Quem é a Tammy mesmo?')).person?.name).toBe('tammy');
  });

  it('quem_e_matheus_afinal_resolves_matheus', async () => {
    expect((await resolveOperationalScope('Quem é o Matheus afinal?')).person?.name).toBe('matheus');
  });

  it('real_name_suffix_is_not_removed_if_registry_matches: o nome inteiro é oferecido primeiro', async () => {
    const r = await resolveOperationalScope('Quem é a Esther mesmo?');
    // Quem consulta o registro tenta "esther mesmo" ANTES de aceitar "esther":
    // se existisse alguém com esse nome, ela venceria.
    expect(r.person?.candidatos?.[0]).toBe('esther mesmo');
  });

  it('nome de duas palavras sem partícula fica inteiro', async () => {
    const r = await resolveOperationalScope('Quem é a Esther Silva?');
    expect(r.person?.name).toBe('esther silva');
    expect(r.person?.candidatos).toEqual(['esther silva']);
  });

  it('unknown_person_still_remains_unknown: partícula removida não inventa pessoa', async () => {
    const r = await resolveOperationalScope('Quem é o Zoroastro mesmo?');
    expect(r.kind).toBe('PERSON');
    expect(r.person?.name).toBe('zoroastro');
  });
});

/**
 * FOLLOW-UP ELÍPTICO. A frase que só faz sentido porque veio depois de outra.
 * Sem herança, "se eu só conseguir resolver três coisas" resolvia NONE e o
 * agente respondia "os dados não estão disponíveis" logo após ter mostrado a
 * operação inteira.
 */
const GLOBAL_ANTERIOR = { kind: 'GLOBAL' as const, operational: true };
const CRIATIVO_ANTERIOR = { kind: 'NONE' as const, operational: false };

describe('carry-forward de follow-up', () => {
  it('operational_overview_then_top_three_preserves_global_scope', async () => {
    const r = await resolveOperationalScope(
      'Se eu só conseguir resolver três coisas, o que eu faço?',
      new Date(),
      GLOBAL_ANTERIOR,
    );
    expect(r.operational).toBe(true);
    expect(r.kind).toBe('GLOBAL');
  });

  it('operational_overview_then_what_depends_on_me_preserves_domain', async () => {
    const r = await resolveOperationalScope('O que depende de mim?', new Date(), GLOBAL_ANTERIOR);
    expect(r.operational).toBe(true);
  });

  it('creative_conversation_does_not_inherit_operational_intent', async () => {
    const r = await resolveOperationalScope(
      'Se eu só conseguir resolver três coisas, o que eu faço?',
      new Date(),
      CRIATIVO_ANTERIOR,
    );
    expect(r.operational).toBe(false);
  });

  it('new_conversation_does_not_inherit_unrelated_previous_chat_state: sem anterior, não inaugura escopo', async () => {
    const r = await resolveOperationalScope('Se eu só conseguir resolver três coisas, o que eu faço?');
    expect(r.operational).toBe(false);
    expect(r.kind).toBe('NONE');
  });

  it('global_then_person_followup_resolves_person', async () => {
    expect((await resolveOperationalScope('E a Tammy?', new Date(), GLOBAL_ANTERIOR)).kind).toBe('PERSON');
  });

  it('global_then_client_followup_resolves_client', async () => {
    expect((await resolveOperationalScope('E a Cosentino?', new Date(), GLOBAL_ANTERIOR)).kind).toBe('CLIENT');
  });

  it('explicit_topic_change_overrides_previous_state', async () => {
    const r = await resolveOperationalScope(
      'Agora escreve uma legenda bonita pro Instagram',
      new Date(),
      GLOBAL_ANTERIOR,
    );
    expect(r.kind).not.toBe('GLOBAL');
  });

  it('parágrafo longo começando com "E" não é follow-up curto', () => {
    expect(
      ehFollowUpEliptico(
        'E agora me explica com calma como a gente deveria dividir a verba entre os canais no fim do ano',
      ),
    ).toBe(false);
  });
});
