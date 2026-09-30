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

/**
 * A INFRAESTRUTURA DA PLATAFORMA NÃO TEM DIMENSÃO DE EMPRESA — e nem por isso
 * é de todo mundo.
 *
 * Conferido no banco em 30/09/2026: `nodes` (5 linhas), `health_checks`
 * (140.932) e `node_capabilities` (6) não têm `client_id`, `user_id` nem
 * `organization_id`. São as máquinas que rodam os agentes, compartilhadas.
 *
 * Recortá-las por empresa seria inventar uma dimensão que o dado não tem, e
 * sugerir que cada cliente tem servidor próprio — falso no modelo cloud
 * multi-tenant. O risco real era outro: `/nodes` devolve `private_host`, o
 * endereço interno das máquinas, para quem tem `nodes:read`. Num mundo
 * multiempresa isso incluiria o administrador de uma empresa cliente.
 *
 * Estes testes travam quem passa por esse portão. São a mesma regra de
 * `ehProvider`, aplicada onde a resposta é sim/não em vez de um recorte.
 */
describe('porteiro da infraestrutura', () => {
  it('master da provedora entra', () => {
    expect(decidirEscopo([PROVEDORA], ['master'], PROVEDORA).ehProvider).toBe(true);
  });

  /** O caso que a regra existe para impedir. */
  it('administrador de uma empresa CLIENTE não entra', () => {
    expect(decidirEscopo([CLIENTE], ['master'], PROVEDORA).ehProvider).toBe(false);
    expect(decidirEscopo([CLIENTE], ['tenant_owner'], PROVEDORA).ehProvider).toBe(false);
  });

  /** Verificado contra o banco: a Tammy é colaborador, uma organização. */
  it('colaborador não entra nem na própria empresa', () => {
    expect(decidirEscopo([PROVEDORA], ['colaborador'], PROVEDORA).ehProvider).toBe(false);
  });
});
