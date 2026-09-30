import { describe, expect, it } from 'vitest';
import { decidirEscopo, ehPapelDePlataforma, organizacaoProvedora } from './escopo-de-organizacao';

/**
 * A REGRA QUE SEPARA "PODEROSO NA MINHA EMPRESA" DE "PODEROSO SOBRE TODAS".
 *
 * Vive em packages/auth porque vale igual na API, no worker e no MCP — e o MCP
 * não pode importar de dentro de outro app. Duplicar esta regra seria repetir o
 * defeito que o trabalho inteiro existiu para corrigir.
 *
 * Hoje, com uma organização só, `master` significa "dono da Desigual" e
 * atravessar tudo está certo. No minuto em que uma empresa cliente tiver o
 * próprio administrador, ele também será master — da empresa DELE — e o mesmo
 * atalho o deixaria ler outro tenant.
 */
const PROVEDORA = 'org-desigual';
const CLIENTE = 'org-cosentino';

describe('quem opera no nível da plataforma', () => {
  it('master DENTRO da provedora é provider', () => {
    expect(decidirEscopo([PROVEDORA], ['master'], PROVEDORA).ehProvider).toBe(true);
  });

  /**
   * O CASO QUE JUSTIFICA O ARQUIVO INTEIRO. Mesmo papel, outra empresa.
   * Se este teste cair, um administrador de cliente virou administrador da
   * plataforma — e ninguém percebe, porque o código compila e responde igual.
   */
  it('master de um CLIENTE não é provider', () => {
    const escopo = decidirEscopo([CLIENTE], ['master'], PROVEDORA);

    expect(escopo.ehProvider).toBe(false);
    expect(escopo.organizationIds).toEqual([CLIENTE]);
  });

  it('pertencer à provedora sem papel forte também não basta', () => {
    expect(decidirEscopo([PROVEDORA], ['colaborador'], PROVEDORA).ehProvider).toBe(false);
  });

  it('as duas condições juntas, em qualquer ordem de organizações', () => {
    expect(decidirEscopo([CLIENTE, PROVEDORA], ['master'], PROVEDORA).ehProvider).toBe(true);
  });

  /**
   * DEFAULT SEGURO. Sem `PROVIDER_ORGANIZATION_ID` configurado, ninguém é
   * provider. Um default permissivo transformaria erro de configuração em
   * acesso total — a pior direção para um default errar.
   */
  it('sem provedora configurada, ninguém é provider', () => {
    expect(decidirEscopo([PROVEDORA], ['master'], null).ehProvider).toBe(false);
    expect(organizacaoProvedora({} as NodeJS.ProcessEnv)).toBeNull();
    expect(organizacaoProvedora({ PROVIDER_ORGANIZATION_ID: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('pessoa sem organização nenhuma não vira provider por acidente', () => {
    expect(decidirEscopo([], ['master'], PROVEDORA).ehProvider).toBe(false);
  });
});

describe('papéis de plataforma', () => {
  it('reconhece os nomes de hoje e os do modelo novo', () => {
    expect(ehPapelDePlataforma(['master'])).toBe(true);
    expect(ehPapelDePlataforma(['provider_owner'])).toBe(true);
    expect(ehPapelDePlataforma(['PROVIDER_ADMIN'])).toBe(true);
  });

  /**
   * `tenant_owner` é forte DENTRO do tenant e não pode ser confundido com
   * papel de plataforma. O prefixo importa; o "owner" sozinho, não.
   */
  it('papel forte de tenant NÃO é papel de plataforma', () => {
    expect(ehPapelDePlataforma(['tenant_owner'])).toBe(false);
    expect(ehPapelDePlataforma(['tenant_admin'])).toBe(false);
    expect(ehPapelDePlataforma(['colaborador'])).toBe(false);
  });
});

/**
 * O FRAGMENTO DE SQL que recorta pessoas por empresa.
 *
 * Serializa o SQL de verdade, com o dialeto do drizzle, em vez de inspecionar o
 * objeto. A versão equivalente na API começou fazendo `JSON.stringify` numa
 * condição e passou a afirmar coisas sobre um texto que não existia — teste que
 * verifica a própria ficção.
 */
