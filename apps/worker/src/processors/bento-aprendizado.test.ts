import { describe, expect, it } from 'vitest';
import { detectarRegraDeBriefing, regrasEmTexto, confirmacaoDeAprendizado } from './bento-aprendizado';

/**
 * Pedido da operação (29/09/2026), o ponto que ela chamou de mais importante:
 * "ela fala 'esse briefing ficou ruim, para social sempre coloque contexto,
 * objetivo, formato, referências, CTA e entregável'. O sistema não deveria
 * responder 'entendido'. A correção precisa virar conhecimento operacional."
 *
 * A metade perigosa não é deixar de aprender — é aprender o que não foi
 * ensinado. Regra errada gravada como permanente contamina todo briefing
 * seguinte, e ninguém vai saber de onde veio. Por isso a maioria destes testes
 * prova que ele NÃO grava.
 */

describe('o que VIRA regra', () => {
  it('o caso exato da operação', () => {
    const r = detectarRegraDeBriefing(
      'esse briefing ficou ruim. Para tarefas de social, sempre coloque contexto, objetivo, formato, referências, CTA e entregável.',
    );
    expect(r).not.toBeNull();
    expect(r!.deliveryType).toBe('social_content');
    // "para tarefas de social" é escopo dito: vale além deste cliente.
    expect(r!.escopoDeTipoExplicito).toBe(true);
  });

  it('crítica + instrução sem escopo de tipo fica presa ao cliente do turno', () => {
    const r = detectarRegraDeBriefing('não gostei, o briefing deveria explicar mais o conceito e trazer a referência da última campanha');
    expect(r).not.toBeNull();
    expect(r!.escopoDeTipoExplicito).toBe(false);
  });

  it('reconhece o tipo pelo texto quando o escopo não foi dito', () => {
    const r = detectarRegraDeBriefing('o briefing do reels ficou fraco, sempre inclua a duração e a trilha');
    expect(r!.deliveryType).toBe('video');
  });
});

describe('o que NÃO vira regra — e isto é o que protege a operação', () => {
  it('insatisfação sem instrução não é ensinamento', () => {
    expect(detectarRegraDeBriefing('não gostei desse briefing')).toBeNull();
    expect(detectarRegraDeBriefing('ficou ruim')).toBeNull();
  });

  it('instrução sem crítica é pedido, não correção', () => {
    expect(detectarRegraDeBriefing('sempre me avisa quando a task ficar pronta')).toBeNull();
  });

  it('pedido de escrita com "sempre" dentro não vira regra', () => {
    expect(detectarRegraDeBriefing('cria a task do carrossel e sempre coloca o prazo pra sexta')).toBeNull();
  });

  it('elogio não vira regra', () => {
    expect(detectarRegraDeBriefing('esse briefing ficou muito bom, obrigada')).toBeNull();
  });

  it('frase curta demais não é regra', () => {
    expect(detectarRegraDeBriefing('ruim, melhora')).toBeNull();
  });
});

describe('a regra aplicada, e a confirmação que a pessoa lê', () => {
  it('o bloco manda obedecer e proíbe ignorar por falta de dado', () => {
    const t = regrasEmTexto(['Para social, sempre CTA e entregável.'])!;
    expect(t).toContain('JÁ CORRIGIU');
    expect(t).toContain('sem exceção');
    expect(t).toContain('declare a lacuna — não ignore a regra');
  });

  it('sem regra, sem bloco — nada de instrução vazia no prompt', () => {
    expect(regrasEmTexto([])).toBeNull();
  });

  it('a confirmação diz ONDE vale e que vale a partir da próxima', () => {
    const c = confirmacaoDeAprendizado(
      { id: '1', regra: 'sempre CTA', deliveryType: 'social_content', clientId: null },
      'D. Carvalho',
    );
    expect(c).toContain('Aprendizado registrado');
    expect(c).toContain('briefings da agência');
    expect(c).toContain('próxima demanda');
  });

  it('regra de cliente diz o nome do cliente — escopo visível é escopo conferível', () => {
    const c = confirmacaoDeAprendizado(
      { id: '1', regra: 'trazer referência da última campanha', deliveryType: null, clientId: 'c1' },
      'D. Carvalho',
    );
    expect(c).toContain('D. Carvalho');
  });
});
