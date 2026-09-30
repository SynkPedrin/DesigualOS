import { describe, expect, it } from 'vitest';
import { ehContaDeQa } from './environment';

/**
 * Guarda de regressão de 11 registros reais: episódios de aceite gravados como
 * conhecimento de PRODUÇÃO, listados na tela de Decisões como decisão da
 * agência ("Bento, guarda esta referência da conversa: marco-029857").
 *
 * A causa não foi a frase do teste — foi ambiente derivado de UMA dimensão
 * quando duas o determinam. O cliente decidia; quem pergunta, não. A cerca de
 * escrita do ClickUp já usava a identidade (`ehQaBot`); a cognição não usava, e
 * as duas divergiam em silêncio.
 */
describe('a conta de QA decide o ambiente', () => {
  const env = { BENTO_QA_BOT_EMAIL: 'qa-bot@institutoalmada.org' } as NodeJS.ProcessEnv;

  it('reconhece a conta de aceite', () => {
    expect(ehContaDeQa('qa-bot@institutoalmada.org', env)).toBe(true);
  });

  it('não confunde com gente de verdade', () => {
    expect(ehContaDeQa('tammy@segundocerebro.pro', env)).toBe(false);
    expect(ehContaDeQa('pedro@institutoalmada.org', env)).toBe(false);
  });

  /** Caixa e espaço não podem virar buraco: um e-mail com maiúscula passaria. */
  it('ignora caixa e espaço em volta', () => {
    expect(ehContaDeQa('  QA-Bot@InstitutoAlmada.org ', env)).toBe(true);
  });

  it('sem e-mail não é conta de QA — e o turno segue como produção', () => {
    expect(ehContaDeQa(null, env)).toBe(false);
    expect(ehContaDeQa('', env)).toBe(false);
  });

  /** O valor vem da MESMA variável do guard de escrita: é o que impede divergirem. */
  it('respeita a variável configurada', () => {
    expect(ehContaDeQa('outro@x.com', { BENTO_QA_BOT_EMAIL: 'outro@x.com' } as NodeJS.ProcessEnv)).toBe(true);
  });

  /**
   * A SEGUNDA CONTA, achada ao contar masters no banco real (30/09/2026):
   * `qa-motion@agenciadesigual.com.br`, criada pro e2e do motion, master, e
   * classificada como produção em tudo que escrevia. Mesmo buraco da conta de
   * aceite, aberto porque a regra só cabia UMA conta.
   */
  it('reconhece as duas contas de teste conhecidas, sem variável configurada', () => {
    const vazio = {} as NodeJS.ProcessEnv;

    expect(ehContaDeQa('qa-bot@institutoalmada.org', vazio)).toBe(true);
    expect(ehContaDeQa('qa-motion@agenciadesigual.com.br', vazio)).toBe(true);
    expect(ehContaDeQa('tammy@segundocerebro.pro', vazio)).toBe(false);
  });

  it('aceita lista na variável', () => {
    const env2 = { BENTO_QA_BOT_EMAIL: 'a@x.com, b@x.com' } as NodeJS.ProcessEnv;

    expect(ehContaDeQa('b@x.com', env2)).toBe(true);
  });

  /**
   * Variável configurada SUBSTITUI o padrão. Se ela só somasse, um ambiente que
   * aponta o QA pra outra organização herdaria as nossas contas de brinde — e
   * passaria a classificar gente de verdade de lá como teste.
   */
  it('a variável configurada substitui o padrão, não soma a ele', () => {
    const env2 = { BENTO_QA_BOT_EMAIL: 'outro@x.com' } as NodeJS.ProcessEnv;

    expect(ehContaDeQa('qa-bot@institutoalmada.org', env2)).toBe(false);
  });
});
