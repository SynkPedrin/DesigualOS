import { describe, expect, it } from 'vitest';
import { anexarFontes, autoriaDeMetadata, descreverAutoria, formatProvenanceBlock, pedeProveniencia } from './provenance-block';

/**
 * Regressão medida no navegador (16/09/2026): perguntado "quem trabalha na
 * conta da Cosentino e de onde você tirou essa informação?", o Bento nomeou a
 * equipe certa e não disse a origem. Resposta correta e mesmo assim inútil para
 * quem precisa decidir se confia nela.
 */
describe('pedeProveniencia', () => {
  it('reconhece as formas reais de perguntar a fonte', () => {
    for (const f of [
      'de onde você tirou essa informação?',
      'qual a fonte disso?',
      'como você sabe disso?',
      'em que você se baseou?',
      'quais as fontes?',
    ]) expect(pedeProveniencia(f), f).toBe(true);
  });

  it('não dispara em turno comum', () => {
    expect(pedeProveniencia('quem trabalha na conta da Cosentino?')).toBe(false);
    expect(pedeProveniencia('crie uma legenda')).toBe(false);
  });
});

describe('formatProvenanceBlock', () => {
  it('lista as fontes REAIS do turno em linguagem de gente', () => {
    const b = formatProvenanceBlock('e de onde você tirou isso?', ['cliente', 'pessoas']);
    expect(b).toContain('dossiê do cliente');
    expect(b).toContain('registro de pessoas');
    expect(b).toMatch(/N[ÃA]O invente fonte/i);
  });

  it('sem fonte no turno, manda declarar a ausência', () => {
    const b = formatProvenanceBlock('de onde veio isso?', []);
    expect(b).toMatch(/N[ÃA]O recebeu nenhuma fonte/i);
    expect(b).toMatch(/Diga isso com todas as letras/i);
  });

  it('proíbe a saída de escape mais comum', () => {
    // "meu conhecimento interno" não é resposta para quem precisa conferir.
    expect(formatProvenanceBlock('qual a fonte?', ['campanha'])).toMatch(/conhecimento interno/i);
  });

  it('turno que não pergunta não vira bibliografia', () => {
    expect(formatProvenanceBlock('me explica a campanha', ['cliente', 'campanha'])).toBe('');
  });
});

/**
 * A seção de fontes é escrita pelo SISTEMA, não pelo modelo. Medido no
 * navegador: o Bento recebeu as fontes e ainda assim respondeu sem citá-las —
 * a síntese do node prioriza o dado operacional e a instrução se perde.
 */
describe('anexarFontes', () => {
  it('explicit_source_question_returns_used_sources', () => {
    const r = anexarFontes('Tammy é a gestora da conta.', 'e de onde você tirou isso?', ['cliente', 'pessoas']);
    expect(r).toContain('Fontes utilizadas:');
    expect(r).toContain('dossiê do cliente');
    expect(r).toContain('registro de pessoas');
  });

  it('unused_evidence_is_not_reported_as_used', () => {
    // Só o que entrou no pacote é citado.
    const r = anexarFontes('resposta', 'qual a fonte?', ['campanha']);
    expect(r).toContain('registro de campanhas');
    expect(r).not.toContain('dossiê do cliente');
  });

  it('model_cannot_invent_source_name: a seção vem de nomes fixos', () => {
    const r = anexarFontes('resposta', 'como você sabe?', ['episodios']);
    expect(r).toMatch(/mem[óo]ria do que foi decidido/i);
  });

  it('sem fonte no turno, declara a ausência em vez de citar genérico', () => {
    expect(anexarFontes('resposta', 'de onde veio?', [])).toMatch(/nenhuma fonte estruturada/i);
  });

  it('turno que não pergunta não recebe rodapé', () => {
    const r = anexarFontes('Aqui está a legenda.', 'crie uma legenda', ['cliente']);
    expect(r).toBe('Aqui está a legenda.');
  });

  it('não duplica quando o modelo já citou', () => {
    const jaCitou = 'Tammy é a gestora.\n\nFontes utilizadas:\n- ClickUp';
    expect(anexarFontes(jaCitou, 'qual a fonte?', ['cliente'])).toBe(jaCitou);
  });
});

/**
 * AUTORIA na proveniência — o que permite ao Bento responder "foi a Tammy?"
 * com a verdade. A regra vem da escrita (apps/mcp/tools/autoria.ts): memória
 * gravada por credencial de conexão carrega metadata.recorded_by +
 * metadata.actor_type. Conta compartilhada NUNCA vira nome de pessoa.
 */
describe('autoriaDeMetadata', () => {
  it('lê recorded_by + actor_type de uma memória gravada por identidade operacional', () => {
    expect(autoriaDeMetadata({ recorded_by: 'Equipe Atendimento', actor_type: 'shared_account' })).toEqual({
      recordedBy: 'Equipe Atendimento',
      actorType: 'shared_account',
    });
  });

  it('recorded_by sozinho (legado) NÃO vira autoria — sem actor_type não há o que afirmar', () => {
    expect(autoriaDeMetadata({ recorded_by: 'Pedro Gabriel' })).toBeNull();
  });

  it('memória sem metadata renderiza como antes: null', () => {
    expect(autoriaDeMetadata(null)).toBeNull();
    expect(autoriaDeMetadata(undefined)).toBeNull();
    expect(autoriaDeMetadata({ mcp_status: 'OBSERVED' })).toBeNull();
  });

  it('actor_type fora do vocabulário não é autoria', () => {
    expect(autoriaDeMetadata({ recorded_by: 'X', actor_type: 'robo' })).toBeNull();
  });
});

describe('descreverAutoria', () => {
  it('person renderiza o nome', () => {
    expect(descreverAutoria({ recordedBy: 'Pedro Claude', actorType: 'person' })).toBe('registrado por Pedro Claude');
  });

  it('shared_account carrega o aviso no próprio texto', () => {
    expect(descreverAutoria({ recordedBy: 'Equipe Atendimento', actorType: 'shared_account' }))
      .toBe('registrado por Equipe Atendimento (conta compartilhada)');
  });

  it('service é automação, não gente', () => {
    expect(descreverAutoria({ recordedBy: 'Jev', actorType: 'service' })).toBe('registrado por Jev (automação)');
  });
});

describe('proveniência com autoria', () => {
  it('conta compartilhada: o bloco diz quem registrou E proíbe atribuir a uma pessoa', () => {
    const b = formatProvenanceBlock('de onde você tirou isso?', ['memoria_semantica'], [
      { recordedBy: 'Equipe Atendimento', actorType: 'shared_account' },
    ]);
    expect(b).toContain('registrado por Equipe Atendimento (conta compartilhada)');
    expect(b).toMatch(/não é possível atribuir/i);
    expect(b).toMatch(/foi a Tammy\?/);
  });

  it('person: o bloco nomeia a identidade, sem o aviso de conta compartilhada', () => {
    const b = formatProvenanceBlock('qual a fonte?', ['memoria_semantica'], [
      { recordedBy: 'Pedro Claude', actorType: 'person' },
    ]);
    expect(b).toContain('registrado por Pedro Claude');
    expect(b).not.toMatch(/conta compartilhada/i);
  });

  it('sem autoria, o bloco é EXATAMENTE o de antes — memória sem metadata não muda o formato', () => {
    expect(formatProvenanceBlock('qual a fonte?', ['campanha'])).toBe(
      formatProvenanceBlock('qual a fonte?', ['campanha'], []),
    );
  });

  it('autorias repetidas (a mesma identidade em várias memórias) aparecem uma vez só', () => {
    const b = formatProvenanceBlock('de onde veio?', ['memoria_semantica'], [
      { recordedBy: 'Equipe Atendimento', actorType: 'shared_account' },
      { recordedBy: 'Equipe Atendimento', actorType: 'shared_account' },
      { recordedBy: 'Pedro Claude', actorType: 'person' },
    ]);
    expect(b.match(/Equipe Atendimento/g)).toHaveLength(1);
    expect(b).toContain('registrado por Pedro Claude');
  });

  it('o rodapé determinístico também expõe a autoria', () => {
    const r = anexarFontes('Essa preferência está registrada.', 'como você sabe?', ['memoria_semantica'], [
      { recordedBy: 'Equipe Atendimento', actorType: 'shared_account' },
    ]);
    expect(r).toContain('Autoria dos registros da equipe:');
    expect(r).toContain('registrado por Equipe Atendimento (conta compartilhada)');
  });

  it('rodapé sem autoria: formato atual preservado', () => {
    const r = anexarFontes('resposta', 'qual a fonte?', ['campanha']);
    expect(r).not.toContain('Autoria');
  });
});
