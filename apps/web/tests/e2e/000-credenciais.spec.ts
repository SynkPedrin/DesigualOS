import { test, expect } from '@playwright/test';

/**
 * O PORTÃO DAS CREDENCIAIS — o teste que impede a suíte de fingir que passou.
 *
 * O defeito que ele existe para matar, medido em 30/09/2026:
 * `playwright test control-plane.spec.ts` imprimiu "23 skipped" e saiu com
 * código ZERO. A suíte inteira se desligou sozinha porque as credenciais
 * moravam em `.env.local` e o config não as lia. Eu quase dei uma fase de QA
 * por concluída sem ter aberto uma única tela.
 *
 * Carregar o `.env.local` no config resolveu AQUELE caso. Não resolveu a
 * CLASSE: qualquer variável que falte volta a produzir skip silencioso, e skip
 * silencioso é indistinguível de sucesso para quem lê o terminal, o CI ou um
 * relatório de release.
 *
 * A regra que este arquivo impõe é simples: a ausência de credencial pode
 * impedir um teste de rodar, mas NÃO pode ser silenciosa. Ou a suíte roda, ou
 * ela diz em vermelho exatamente o que falta e por quê.
 *
 * COMO SAIR DAQUI, quando a falta é deliberada (rodar só um subconjunto, ou um
 * CI que não tem os segredos): `E2E_SKIP_PERMITIDO=1`. Explícito, rastreável na
 * linha de comando, e impossível de acontecer por descuido — que é a diferença
 * entre uma decisão e um acidente.
 */

/** O que cada grupo de specs precisa, e o que deixa de ser provado sem isso. */
const EXIGENCIAS = [
  {
    vars: ['QA_USER_EMAIL', 'QA_USER_PASSWORD'],
    cobre: 'Control Plane (16 telas), Tammy em operação, continuidade, gates de release',
  },
  {
    vars: ['STUDIO_TEST_EMAIL', 'STUDIO_TEST_PASSWORD'],
    cobre: 'os gates do editor Canva e a geração do Studio (a conta studio-test@ existe no banco)',
  },
  {
    vars: ['QA_ACEITE_EMAIL', 'QA_ACEITE_PASSWORD'],
    cobre: 'a bateria de aceite ponta a ponta (a conta qa-aceite-20260914@ existe no banco)',
  },
  {
    vars: ['CLICKUP_API_KEY'],
    cobre: 'a verificação de que a escrita chegou MESMO no ClickUp, e não só na nossa resposta',
  },
] as const;

function faltando(vars: readonly string[]): string[] {
  return vars.filter((v) => !process.env[v]);
}

test.describe('portão: a suíte pode mesmo rodar?', () => {
  test('nenhum spec vai se desligar em silêncio por falta de credencial', async () => {
    const lacunas = EXIGENCIAS.map((e) => ({ ...e, ausentes: faltando(e.vars) })).filter(
      (e) => e.ausentes.length > 0,
    );

    if (lacunas.length === 0) return;

    const relatorio = lacunas
      .map((l) => `  · ${l.ausentes.join(', ')}\n      sem isso NÃO se prova: ${l.cobre}`)
      .join('\n');

    /**
     * A válvula é explícita e some do caminho de quem não a usa. Ela existe
     * porque "rodar só a tela X" é legítimo; o que não é legítimo é isso
     * acontecer sem ninguém escolher.
     */
    if (process.env.E2E_SKIP_PERMITIDO === '1') {
      console.warn(
        `\n[portão] Rodando com cobertura REDUZIDA por escolha explícita (E2E_SKIP_PERMITIDO=1).\n${relatorio}\n`,
      );
      return;
    }

    expect(
      lacunas,
      `\n\nA suíte ia rodar PELA METADE e sair com sucesso.\n\n` +
        `Faltam credenciais:\n${relatorio}\n\n` +
        `As contas existem no banco — o que falta é a senha chegar até aqui.\n` +
        `Defina em .env.local (ou no shell), ou assuma a cobertura menor de\n` +
        `propósito com E2E_SKIP_PERMITIDO=1.\n`,
    ).toEqual([]);
  });
});
