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
});
