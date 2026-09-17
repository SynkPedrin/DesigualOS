import { describe, expect, it } from 'vitest';
import {
  ehPerguntaDeFonteAnterior,
  montarProveniencia,
  responderFonteAnterior,
  rotuloDaFonte,
} from './response-provenance.js';

const evConversa = {
  type: 'memory',
  source: 'conversation:learned',
  sourceId: '2026-09-17T02:02:00.000Z',
  summary: 'Informado na conversa em 2026-09-17 (decision): a decisora da Colpar é Fernanda Alves.',
  retrievedAt: '2026-09-17T12:00:00.000Z',
};
const evClickUp = {
  type: 'clickup_task',
  source: 'clickup',
  sourceId: 'task-1',
  summary: 'Elite, Ads (aberto), com Jarbas',
  retrievedAt: '2026-09-17T12:00:00.000Z',
};
const evDossie = {
  type: 'document',
  source: 'client.profile',
  sourceId: 'cli-1',
  summary: 'Dossiê de Colpar: ...',
  retrievedAt: '2026-09-17T12:00:00.000Z',
};

describe('conversation_learned_fact_is_not_misattributed_to_clickup', () => {
  it('fato da conversa é rotulado como conversa, com a data', () => {
    expect(rotuloDaFonte(evConversa)).toMatch(/conversa/i);
    expect(rotuloDaFonte(evConversa)).toContain('2026-09-17');
    expect(rotuloDaFonte(evConversa)).not.toMatch(/ClickUp/i);
  });
});

describe('clickup_fact_followup_remains_clickup', () => {
  it('tarefa do ClickUp continua sendo ClickUp', () => {
    expect(rotuloDaFonte(evClickUp)).toMatch(/ClickUp/);
  });
});

describe('person_registry_fact_reports_person_registry', () => {
  it('registro de pessoas é nomeado como tal', () => {
    expect(rotuloDaFonte({ type: 'database', source: 'people.registry', sourceId: 'p1' })).toMatch(
      /registro de pessoas/i,
    );
  });

  it('registro de campanhas idem', () => {
    expect(rotuloDaFonte({ type: 'document', source: 'campaign.registry', sourceId: 'c1' })).toMatch(
      /registro de campanhas/i,
    );
  });

  it('nunca devolve identificador técnico como resposta ao humano', () => {
    const r = rotuloDaFonte(evConversa);
    expect(r).not.toMatch(/sourceId|memory_id|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe('followup_where_did_you_get_that_uses_previous_claim_provenance', () => {
  it('reconhece as formas que a equipe usa', () => {
    for (const q of [
      'de onde você tirou isso?',
      'De onde veio essa informação?',
      'qual a fonte disso?',
      'como você sabe?',
      'baseado em quê?',
    ]) {
      expect(ehPerguntaDeFonteAnterior(q)).toBe(true);
    }
  });

  it('pergunta nova e longa NÃO é follow-up: responder a fonte da anterior ignoraria o que foi pedido', () => {
    expect(
      ehPerguntaDeFonteAnterior(
        'Me explica de onde vem a verba da campanha de fim de ano e como a gente deveria dividir entre os canais, considerando o que foi acordado',
      ),
    ).toBe(false);
  });

  it('pergunta comum não vira follow-up de fonte', () => {
    expect(ehPerguntaDeFonteAnterior('Quem é o decisor da Colpar?')).toBe(false);
  });
});

describe('multiple_claims_keep_individual_sources', () => {
  it('fontes diferentes viram atribuição por afirmação', () => {
    const prov = montarProveniencia({
      claims: [
        { text: 'A decisora da Colpar é Fernanda Alves.', evidence_ids: ['2026-09-17T02:02:00.000Z'] },
        { text: 'A Elite tem 6 tarefas abertas.', evidence_ids: ['task-1'] },
      ],
      evidence: [evConversa, evClickUp],
      agente: 'bento',
    })!;
    const texto = responderFonteAnterior(prov);
    expect(texto).toMatch(/Fernanda Alves.*conversa/s);
    expect(texto).toMatch(/tarefas abertas.*ClickUp/s);
  });

  it('fonte única responde em uma frase, sem burocracia', () => {
    const prov = montarProveniencia({
      claims: [{ text: 'A decisora da Colpar é Fernanda Alves.', evidence_ids: ['2026-09-17T02:02:00.000Z'] }],
      evidence: [evConversa],
      agente: 'bento',
    })!;
    expect(responderFonteAnterior(prov)).toMatch(/^Isso veio da conversa/);
    expect(responderFonteAnterior(prov)).not.toMatch(/Cada parte/);
  });
});

describe('montarProveniencia', () => {
  it('claim sem evidência não entra: citar fonte que não sustentou é o defeito original', () => {
    const prov = montarProveniencia({
      claims: [{ text: 'Afirmação solta', evidence_ids: [] }],
      evidence: [evDossie],
      agente: 'bento',
    })!;
    expect(prov.claims).toHaveLength(0);
    expect(prov.fontes).toContain('o dossiê do cliente registrado no sistema');
  });

  it('turno sem evidência nenhuma não produz registro', () => {
    expect(montarProveniencia({ claims: [], evidence: [], agente: 'bento' })).toBeNull();
  });

  it('não guarda raciocínio, só afirmação e fonte', () => {
    const prov = montarProveniencia({
      claims: [{ text: 'A decisora é Fernanda.', evidence_ids: ['2026-09-17T02:02:00.000Z'] }],
      evidence: [evConversa],
      agente: 'bento',
    })!;
    expect(Object.keys(prov.claims[0]!)).toEqual(['texto', 'fontes']);
  });
});

describe('português da atribuição', () => {
  it('contrai a preposição: "do dossiê", nunca "de o dossiê"', () => {
    const prov = montarProveniencia({
      claims: [{ text: 'X', evidence_ids: ['cli-1'] }],
      evidence: [evDossie],
      agente: 'bento',
    })!;
    const texto = responderFonteAnterior(prov);
    expect(texto).toContain('do dossiê');
    expect(texto).not.toContain('de o ');
  });

  it('e com fonte feminina: "da conversa"', () => {
    const prov = montarProveniencia({
      claims: [{ text: 'X', evidence_ids: ['2026-09-17T02:02:00.000Z'] }],
      evidence: [evConversa],
      agente: 'bento',
    })!;
    expect(responderFonteAnterior(prov)).toContain('da conversa');
  });
});
