import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveClientForConversation, resolveClientFromText, resolveClientsFromText, resolveDefaultProjectForClient } from './resolve-client';

/**
 * Casos reais do banco de produção (consultados em 09/09/2026, 56 clientes) — de propósito, não
 * nomes inventados. São as armadilhas que fizeram o matcher precisar de normalização e do corte
 * "ambíguo = não resolve": emoji + ™ + sufixo depois de travessão, nomes quase-duplicados
 * (Cosentino / Construtora Cosentino), abreviação que colide com sigla comum (3Net vs "3 net" em
 * frase qualquer).
 */
interface FakeClient {
  id: string;
  name: string;
  slug: string;
}

interface FakeProject {
  id: string;
  clientId: string;
}

const mockClients: FakeClient[] = [];
const mockProjects: FakeProject[] = [];
let mockConversationClientId: string | null | undefined;

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, value: unknown) => ({ op: 'eq', value }),
}));

vi.mock('@desigual-os/database', () => {
  const schema = {
    clients: { __table: 'clients' },
    conversations: { __table: 'conversations' },
    projects: { __table: 'projects' },
  };
  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => {
        if (table === schema.clients) {
          return Promise.resolve(mockClients.map((c) => ({ id: c.id, name: c.name, slug: c.slug })));
        }
        if (table === schema.conversations) {
          return {
            where: (_cond: unknown) =>
              Promise.resolve(
                mockConversationClientId === undefined ? [] : [{ clientId: mockConversationClientId }],
              ),
          };
        }
        if (table === schema.projects) {
          return {
            where: (cond: { value: string }) =>
              Promise.resolve(mockProjects.filter((p) => p.clientId === cond.value).map((p) => ({ id: p.id }))),
          };
        }
        throw new Error('tabela inesperada no mock');
      },
    }),
  };
  return { db, schema };
});

function seed(clients: FakeClient[]): void {
  mockClients.length = 0;
  mockClients.push(...clients);
}

const REAIS: FakeClient[] = [
  { id: 'c-3net', name: '3Net', slug: '3net' },
  { id: 'c-bravvo', name: 'Bravvo', slug: 'bravvo' },
  { id: 'c-cosentino', name: 'Cosentino', slug: 'cosentino' },
  {
    id: 'c-cosentino-const',
    name: 'Construtora e Imobiliária Cosentino Ltda. — Enterprise',
    slug: 'construtora-e-imobiliaria-cosentino-ltda-enterprise',
  },
  { id: 'c-citavel', name: '🔥 CITÁVEL™ — Enterprise', slug: 'citavel-enterprise' },
  { id: 'c-fratelli', name: 'Gelateria Fratelli', slug: 'gelateria-fratelli' },
  { id: 'c-damata', name: 'Da Mata', slug: 'da-mata' },
  { id: 'c-teste', name: 'teste', slug: 'teste' },
];

beforeEach(() => {
  mockConversationClientId = undefined;
  mockProjects.length = 0;
  seed(REAIS);
});

describe('resolveClientFromText', () => {
  it('resolve pelo nome citado em texto livre, sem seletor de UI', async () => {
    const r = await resolveClientFromText('Jarbas, como estão as campanhas da 3NET hoje?');
    expect(r?.id).toBe('c-3net');
  });

  it('e insensivel a maiusculas/minusculas e a acento', async () => {
    const r = await resolveClientFromText('qual o melhor criativo da 3net?');
    expect(r?.id).toBe('c-3net');
  });

  it('resolve nome com emoji e (TM) na origem, mesmo sem o usuario digitar isso', async () => {
    const r = await resolveClientFromText('bento, o que sabemos sobre o citavel?');
    expect(r?.id).toBe('c-citavel');
  });

  it('nome EXATO ganha de nome-contido: "cosentino" resolve o cliente chamado Cosentino', async () => {
    // MUDANCA DELIBERADA DE COMPORTAMENTO (10/09/2026). Antes esta resolucao devolvia null,
    // porque "cosentino" aparece tanto no cliente "Cosentino" quanto em "Construtora e
    // Imobiliaria Cosentino Ltda. - Enterprise", e o matcher tratava os dois como empate.
    // Efeito medido em producao: o cliente Cosentino era PERMANENTEMENTE irresolvivel, e o
    // agente perguntava "de qual cliente?" mesmo com o nome escrito na mensagem.
    // Agora vale precedencia por precisao: nome completo exato e evidencia mais forte que
    // palavra contida num nome maior - mesmo principio do matcher de listas do bento-qa.
    // Isso NAO e adivinhar: pra falar da Construtora, escreve-se o nome dela.
    const r = await resolveClientFromText('como esta o cosentino essa semana?');
    expect(r?.id).toBe('c-cosentino');
  });

  it('ambiguidade REAL (dois clientes com o mesmo nome normalizado) continua nao adivinhando', async () => {
    // Caso real do banco: as duas linhas de "Case #0" existem, diferindo so na caixa das letras.
    seed([
      { id: 'c-case-a', name: '🧪 CASE #0 — Endrigo Almada / CITÁVEL™', slug: 'case-0-endrigo-a' },
      { id: 'c-case-b', name: '🧪 Case #0 — Endrigo Almada / CITÁVEL™', slug: 'case-0-endrigo-b' },
    ]);
    const r = await resolveClientFromText('o que temos no case 0 endrigo almada?');
    expect(r).toBeNull();
  });
});

describe('resolveClientsFromText (multi-cliente e ambiguidade explicita)', () => {
  it('resolve VARIOS clientes citados na mesma mensagem', async () => {
    // Caso real que falhou em producao: o usuario pediu analise de tres clientes de uma vez e
    // o sistema tratou como "nenhum cliente resolvido" (a API antiga so sabia dizer 0 ou 1).
    const r = await resolveClientsFromText('quero que analise 3net, cosentino e bravvo e me passe um resumo');
    expect(r.matches.map((m) => m.id).sort()).toEqual(['c-3net', 'c-bravvo', 'c-cosentino']);
    expect(r.ambiguous).toHaveLength(0);
  });

  it('distingue "nenhum cliente" de "ambiguo" (era a mesma coisa antes: null)', async () => {
    const nenhum = await resolveClientsFromText('oi, tudo bem?');
    expect(nenhum.matches).toHaveLength(0);
    expect(nenhum.ambiguous).toHaveLength(0);
    expect(nenhum.tier).toBe('none');

    seed([
      { id: 'c-case-a', name: 'Case Zero — Alfa', slug: 'case-zero-alfa' },
      { id: 'c-case-b', name: 'Case Zero — Beta', slug: 'case-zero-beta' },
    ]);
    const ambiguo = await resolveClientsFromText('como esta o case zero?');
    expect(ambiguo.matches).toHaveLength(0);
    expect(ambiguo.ambiguous).toHaveLength(1);
    expect(ambiguo.ambiguous[0]!.candidates.map((c) => c.id).sort()).toEqual(['c-case-a', 'c-case-b']);
  });

  it('erro de digitacao resolve por proximidade: "consentino" -> Cosentino', async () => {
    // Caso real: o usuario escreveu "consentino" e o cliente foi silenciosamente ignorado na
    // resposta, sem nenhum aviso de que um dos tres nomes nao tinha sido encontrado.
    const r = await resolveClientsFromText('me da um resumo de consentino');
    expect(r.tier).toBe('fuzzy');
    expect(r.matches.map((m) => m.id)).toEqual(['c-cosentino']);
  });

  it('fuzzy NUNCA passa na frente de um match exato', async () => {
    const r = await resolveClientsFromText('resumo de 3net por favor');
    expect(r.tier).toBe('exact');
    expect(r.matches.map((m) => m.id)).toEqual(['c-3net']);
  });

  it('fuzzy nao adivinha quando dois clientes estao igualmente perto do erro de digitacao', async () => {
    // "Cardassi" e cliente real; "Cardossi" e construido de proposito pra provar a guarda.
    seed([
      { id: 'c-cardassi', name: 'Cardassi', slug: 'cardassi' },
      { id: 'c-cardossi', name: 'Cardossi', slug: 'cardossi' },
    ]);
    const r = await resolveClientsFromText('como esta o cardessi?');
    expect(r.matches).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0]!.candidates).toHaveLength(2);
  });

  it('palavra generica nao vira match nem por fuzzy', async () => {
    const r = await resolveClientsFromText('isso foi so um testee, ignora');
    expect(r.matches).toHaveLength(0);
  });

  it('mensagem sem nenhum cliente citado nao resolve nada', async () => {
    const r = await resolveClientFromText('oi, tudo bem?');
    expect(r).toBeNull();
  });

  it('nome curto e generico ("teste") nao vira match automatico', async () => {
    const r = await resolveClientFromText('isso foi so um teste, ignora');
    expect(r).toBeNull();
  });

  it('cliente prospect (Fratelli) resolve igual a cliente ativo - nao filtra por status', async () => {
    const r = await resolveClientFromText('a Fratelli confirmou o briefing de pascoa');
    expect(r?.id).toBe('c-fratelli');
  });

  it('nao casa substring dentro de outra palavra (limite real conhecido, nao um bug)', async () => {
    // "netflix" contem "net" mas nao "3net" inteiro - nao deveria casar, e o teste confirma que
    // o \b da regex protege isso.
    const r = await resolveClientFromText('vamos assistir netflix hoje');
    expect(r).toBeNull();
  });
});

describe('resolveClientForConversation', () => {
  it('resolve pelo texto quando a conversa ainda nao tem cliente', async () => {
    mockConversationClientId = null;
    const r = await resolveClientForConversation('conv-1', 'e a 3net, como ta?');
    expect(r?.id).toBe('c-3net');
  });

  it('NUNCA sobrescreve um clientId que a conversa ja tem, mesmo se outro nome aparecer no texto', async () => {
    mockConversationClientId = 'c-bravvo';
    const r = await resolveClientForConversation('conv-1', 'e a 3net, como ta?');
    expect(r).toBeNull();
  });
});

describe('resolveDefaultProjectForClient', () => {
  it('resolve o projeto quando o cliente tem exatamente um (o caso real: 1 projeto por cliente)', async () => {
    mockProjects.push({ id: 'proj-3net', clientId: 'c-3net' });
    const r = await resolveDefaultProjectForClient('c-3net');
    expect(r).toBe('proj-3net');
  });

  it('nao adivinha quando o cliente tem mais de um projeto', async () => {
    mockProjects.push({ id: 'proj-3net-a', clientId: 'c-3net' }, { id: 'proj-3net-b', clientId: 'c-3net' });
    const r = await resolveDefaultProjectForClient('c-3net');
    expect(r).toBeNull();
  });

  it('cliente sem projeto nenhum devolve null', async () => {
    const r = await resolveDefaultProjectForClient('c-3net');
    expect(r).toBeNull();
  });
});

/**
 * Regressão do achado de 15/09/2026: a pergunta executiva
 * "o que eu deveria OLHAR primeiro?" resolvia o escopo da operação inteira
 * para o cliente Colpar — "olhar" fica a distância 2 de "colpar" — e o Bento
 * respondia com confiança sobre o cliente errado.
 */
describe('fuzzy não sequestra a operação com palavra comum', () => {
  it('"olhar" NÃO resolve para Colpar', async () => {
    const r = await resolveClientsFromText('Bento, o que está pegando hoje? O que eu deveria olhar primeiro e por quê?');
    expect(r.matches).toHaveLength(0);
    expect(r.tier).toBe('none');
  });

  it.each([
    'o que eu preciso fazer primeiro',
    'me diz o que está pegando',
    'qual campanha merece atenção',
    'quais tarefas estão atrasadas',
  ])('pergunta operacional sem cliente não casa: %s', async (m) => {
    expect((await resolveClientsFromText(m)).matches).toHaveLength(0);
  });

  it('erro de digitação REAL em nome longo continua resolvendo', async () => {
    const r = await resolveClientsFromText('analisa a campanha da consentino');
    expect(r.matches.map((m) => m.name)).toContain('Cosentino');
  });
});

/**
 * Regressão do sequestro por palavra comum (16/09/2026): "campanha de
 * aniversário do Jardim Europa 5" resolvia para o cliente "Jardim do Lago" com
 * confiança total, e o Otto entregou a legenda de um empreendimento em
 * Penápolis para uma campanha da Cosentino.
 */
describe('palavra comum não sequestra cliente', () => {
  it('não resolve cliente quando o texto estende a palavra em outro nome', async () => {
    seed([{ id: 'c-lago', name: 'Jardim do Lago', slug: 'jardim-do-lago' }]);
    const r = await resolveClientsFromText('legenda para a campanha de aniversário do Jardim Europa 5');
    expect(r.matches).toEqual([]);
  });

  it('continua resolvendo o cliente quando é dele que se fala', async () => {
    seed([{ id: 'c-lago', name: 'Jardim do Lago', slug: 'jardim-do-lago' }]);
    const r = await resolveClientsFromText('as tarefas do Jardim do Lago');
    expect(r.matches.map((m) => m.name)).toContain('Jardim do Lago');
  });

  it('palavra comum seguida de VERBO continua resolvendo (não é outra entidade)', async () => {
    // A primeira versão da regra rejeitava "a Fratelli confirmou" porque
    // "confirmou" não está no nome — rejeitar frase legítima é pior que o bug
    // original. Só nome próprio depois da palavra indica outra entidade.
    seed([{ id: 'c-fratelli', name: 'Gelateria Fratelli', slug: 'gelateria-fratelli' }]);
    const r = await resolveClientsFromText('a Fratelli confirmou o layout');
    expect(r.matches.map((m) => m.name)).toContain('Gelateria Fratelli');
  });

  it('nome composto de outro cliente não vaza pelo primeiro token', async () => {
    seed([{ id: 'c-costa', name: 'Costa Azul', slug: 'costa-azul' }]);
    // "Costa" sozinho não pode arrastar "Costa Azul" quando o texto diz outra coisa.
    const r = await resolveClientsFromText('falei com a Costa Rica ontem');
    expect(r.matches.map((m) => m.name)).not.toContain('Costa Azul');
  });
});
