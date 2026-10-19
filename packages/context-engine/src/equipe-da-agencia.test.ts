import { describe, expect, it } from 'vitest';
import { equipeEmTexto, pessoaEEquipeEmTexto, type MembroDaEquipe } from './equipe-da-agencia';

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

describe('pessoaEEquipeEmTexto', () => {
  const pedro = { nome: 'Pedro Gabriel', funcao: 'Gestão', emailClickUp: 'pedro@institutoalmada.org' };

  it('diz quem pergunta e amarra "eu/minhas" a essa pessoa', () => {
    const t = pessoaEEquipeEmTexto({ quemPergunta: pedro, primeiraMensagem: false, equipe: null })!;
    expect(t).toContain('QUEM ESTÁ PERGUNTANDO: Pedro Gabriel (função: Gestão; e-mail no ClickUp: pedro@institutoalmada.org)');
    expect(t).toContain('"Eu", "meu" e "minhas"');
    expect(t).not.toContain('PRIMEIRA mensagem');
  });

  it('primeira mensagem: a boas-vindas vem antes de tudo, com o nome', () => {
    const t = pessoaEEquipeEmTexto({ quemPergunta: pedro, primeiraMensagem: true, equipe: 'A EQUIPE...' })!;
    expect(t.startsWith('Esta é a PRIMEIRA mensagem que Pedro Gabriel')).toBe(true);
    expect(t.indexOf('QUEM ESTÁ PERGUNTANDO')).toBeLessThan(t.indexOf('A EQUIPE...'));
  });

  it('sem nada para dizer, devolve null em vez de bloco vazio', () => {
    expect(pessoaEEquipeEmTexto({ quemPergunta: null, primeiraMensagem: true, equipe: null })).toBeNull();
  });
});

import { fatosDaEquipeEmTexto } from './equipe-da-agencia';

describe('fatosDaEquipeEmTexto (Bento 3.1)', () => {
  const quando = new Date('2026-10-14T15:00:00.000Z');
  it('as preferências de quem pergunta vêm separadas e rotuladas', () => {
    const t = fatosDaEquipeEmTexto([{ userId: 'u-ana', conteudo: 'Ana — briefing com objetivo e CTA', classe: 'CONFIRMED_PREFERENCE', informadoPor: 'Ana', atualizadoEm: quando }], 'u-ana')!;
    expect(t).toContain('COMO QUEM PERGUNTA PREFERE TRABALHAR');
    expect(t).toContain('[confirmado pela própria pessoa, 14/10/2026]');
  });
  it('o que um colega contou aparece como NÃO confirmado, com quem disse', () => {
    const t = fatosDaEquipeEmTexto([{ userId: 'u-bruno', conteudo: 'Bruno — briefing em áudio', classe: 'INFERENCE', informadoPor: 'Ana', atualizadoEm: quando }], 'u-ana')!;
    expect(t).toContain('[NÃO confirmado; informado por Ana, 14/10/2026]');
    expect(t).toContain('nunca como regra da agência');
  });
  it('sem nada registrado de quem pergunta: a instrução de perguntar UMA vez, só se precisar', () => {
    expect(fatosDaEquipeEmTexto([], 'u-ana')).toContain('faça UMA pergunta curta');
  });
});
