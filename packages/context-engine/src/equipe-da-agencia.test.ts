import { describe, expect, it } from 'vitest';
import { equipeEmTexto, type MembroDaEquipe } from './equipe-da-agencia';

/**
 * O que estes testes protegem é a pergunta mais simples de responder errado:
 * "quem trabalha aqui?"
 *
 * Sem este bloco no contexto, o agente não tinha FONTE nenhuma sobre a equipe
 * e a única saída era inventar. A regra de ouro do produto é a mesma de sempre:
 * melhor não ter o bloco do que ter uma lista que parece completa e não é.
 */

const HOJE = new Date('2026-10-13T12:00:00-03:00');

function membro(over: Partial<MembroDaEquipe> = {}): MembroDaEquipe {
  return { nome: 'Tammy', funcao: 'Atendimento', papel: 'collaborator', entrouEm: new Date('2026-09-01T00:00:00-03:00'), emailClickUp: null, ...over };
}

describe('equipeEmTexto', () => {
  it('lista vazia NÃO gera bloco — ausência não vira afirmação', () => {
    expect(equipeEmTexto([], HOJE)).toBeNull();
  });

  it('cada membro sai com nome, função e data de entrada', () => {
    const texto = equipeEmTexto([membro()], HOJE)!;
    expect(texto).toContain('Tammy');
    expect(texto).toContain('Atendimento');
    expect(texto).toContain('01/09/2026');
  });

  it('vínculo com menos de 30 dias é marcado como NOVO(A)', () => {
    const novo = membro({ entrouEm: new Date('2026-10-10T00:00:00-03:00') });
    expect(equipeEmTexto([novo], HOJE)).toContain('NOVO(A)');
  });

  it('quem já tem 30 dias de casa NÃO é novo — a marca envelhece sozinha', () => {
    const veterano = membro({ entrouEm: new Date('2026-09-01T00:00:00-03:00') });
    expect(equipeEmTexto([veterano], HOJE)).not.toContain('NOVO(A)');
  });

  it('papel de gestão aparece; papel comum não vira ruído', () => {
    const dono = membro({ papel: 'owner' });
    const time = membro({ papel: 'collaborator' });
    expect(equipeEmTexto([dono], HOJE)).toContain('papel: owner');
    expect(equipeEmTexto([time], HOJE)).not.toContain('papel: collaborator');
  });

  it('sem função cadastrada a pessoa não some — sai só com o nome', () => {
    const texto = equipeEmTexto([membro({ funcao: null })], HOJE)!;
    expect(texto).toContain('Tammy');
    expect(texto).not.toContain('null');
  });

  /**
   * A instrução que fecha o bloco é a que impede a alucinação cara: pessoa
   * fora da lista não existe. Sem ela, "fala com o João do financeiro"
   * ganharia um João inventado com cargo inventado.
   */
  it('o bloco proíbe adivinhar quem não está na lista', () => {
    const texto = equipeEmTexto([membro()], HOJE)!;
    expect(texto).toContain('não existe para você');
  });
});
