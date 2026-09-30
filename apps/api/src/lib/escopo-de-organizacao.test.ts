import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { decidirEscopo, ehPapelDePlataforma, organizacaoProvedora, recorteDePessoasVisiveis } from './escopo-de-organizacao';

/**
 * A REGRA QUE SEPARA "PODEROSO NA MINHA EMPRESA" DE "PODEROSO SOBRE TODAS".
 *
 * Hoje, com uma organização só, `master` significa "dono da Desigual" e
 * atravessar tudo está certo. No minuto em que a Cosentino tiver o próprio
 * administrador, ele também será master — da empresa DELE — e o mesmo atalho o
 * deixaria ler outro tenant.
 *
 * Estes testes existem para que essa distinção não dependa de alguém lembrar
 * dela ao escrever a próxima rota. São 122 rotas; 19 hoje não aplicam recorte
 * nenhum. Lembrar não é uma estratégia.
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
describe('recorte de pessoas visíveis, em SQL', () => {
  const usuario = { id: 'user-1', roles: ['colaborador'] } as unknown as Parameters<
    typeof recorteDePessoasVisiveis
  >[0];
  const sqlDe = (u: typeof usuario) =>
    new PgDialect().sqlToQuery(recorteDePessoasVisiveis(u, sql`u.id`));

  it('liga a pessoa às organizações de quem pergunta', () => {
    const { sql: texto } = sqlDe(usuario);

    expect(texto).toContain('organization_members');
    // O join é o que garante "mesma empresa" — sem ele, o EXISTS passaria
    // para qualquer par de pessoas.
    expect(texto.replace(/\s+/g, ' ')).toMatch(/join organization_members .* on .*organization_id/i);
  });

  /** Quem pergunta sempre se vê, mesmo sem empresa nenhuma. */
  it('inclui a própria pessoa', () => {
    const { params } = sqlDe(usuario);

    expect(params.filter((p) => p === 'user-1').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * O id entra PARAMETRIZADO. Já tentei montar essa lista concatenando string
   * neste mesmo módulo — funciona e é injeção esperando acontecer.
   */
  it('não concatena o id no texto do SQL', () => {
    const malicioso = { id: "'; drop table users; --", roles: [] } as unknown as typeof usuario;
    const { sql: texto, params } = sqlDe(malicioso);

    expect(texto).not.toContain('drop table');
    expect(params).toContain("'; drop table users; --");
  });
});
