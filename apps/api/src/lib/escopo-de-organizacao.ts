import { db, schema } from '@desigual-os/database';
import { eq, inArray } from 'drizzle-orm';
import type { AuthenticatedUser } from '../auth/middleware';

/**
 * escopo-de-organizacao.ts — a resposta canônica de "quais empresas esta pessoa
 * pode ver".
 *
 * É a fonte única que a seção 83 do briefing pede ("uma regra de negócio crítica
 * deve possuir uma fonte canônica") para a regra mais cara de todas num produto
 * multiempresa: a fronteira entre tenants.
 *
 * POR QUE ISTO PRECISA EXISTIR, medido em 30/09/2026 no repositório:
 *
 *   29 módulos de API, 122 rotas.
 *   10 aplicam recorte de organização.
 *    9 checam SÓ o papel — quem a pessoa é, não de qual empresa.
 *   10 não checam nada disso.
 *
 * Com uma organização só no banco, os 19 sem recorte funcionam. Com duas, cada
 * um vira um vazamento entre empresas — e o código compila e responde igual, que
 * é o que torna esse defeito difícil de ver em revisão.
 *
 * E não é hipótese: a MESMA forma apareceu duas vezes num único dia, com um
 * tenant só. `/memories` e `search_memory` liam a mesma tabela sem a regra que
 * a primeira porta tinha. Nos dois casos a regra existia noutro arquivo.
 *
 * ---
 *
 * A CORREÇÃO DE FUNDO QUE ESTA FUNÇÃO FAZ, e que é o ponto:
 *
 * Hoje, em vários lugares, `master` atravessa tudo — por exemplo
 * `canReadConversationInOrg` começa com `if (user.roles.includes('master'))
 * return true`. Isso está CERTO enquanto existe uma organização e "master"
 * significa "dono da Desigual".
 *
 * Passa a estar ERRADO no minuto em que a Cosentino tiver o próprio
 * administrador: ele também é "master" da empresa DELE, e o mesmo atalho o
 * deixaria ler outro tenant. Um papel poderoso DENTRO de uma empresa não pode
 * significar poder SOBRE todas as empresas.
 *
 * Então aqui a separação é explícita:
 *
 *   organizationIds — em quais empresas esta pessoa é membro. SEMPRE aplicado.
 *   ehProvider      — se ela opera no nível da plataforma (Desigual), o que é
 *                     uma condição sobre a EMPRESA dela, não só sobre o papel.
 *
 * `ehProvider` não é "tem papel forte": é "tem papel forte E pertence à
 * organização provedora". As duas condições juntas, sempre — é o que impede o
 * administrador de um cliente virar administrador da plataforma por herdar um
 * nome de papel.
 */

export interface EscopoDeOrganizacao {
  /** Empresas em que a pessoa é membro. Vazio = não vê nada além do próprio. */
  organizationIds: string[];
  /**
   * Opera no nível da plataforma (Desigual), podendo alcançar outras empresas
   * conforme a rota permitir. NUNCA verdadeiro só por causa do papel.
   */
  ehProvider: boolean;
}

/**
 * A organização provedora. Lida do ambiente para não ficar hardcoded num
 * `if` de rota — quando a outra sessão entregar o modelo de provider no schema,
 * esta constante é o único lugar que muda.
 *
 * Sem configuração, NINGUÉM é provider. O default seguro é o restritivo: um
 * default permissivo transformaria erro de configuração em acesso total, que é
 * a pior direção possível para um default errar.
 */
export function organizacaoProvedora(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.PROVIDER_ORGANIZATION_ID?.trim() || null;
}

/** Papéis que operam no nível da plataforma — só valem DENTRO da provedora. */
const PAPEIS_DE_PLATAFORMA = ['master', 'provider_owner', 'provider_admin'];

export function ehPapelDePlataforma(roles: readonly string[]): boolean {
  return roles.some((r) => PAPEIS_DE_PLATAFORMA.includes(r.toLowerCase()));
}

/**
 * Decide o escopo a partir dos dados já carregados. Pura, para ter teste — a
 * regra que separa tenant de provider não pode depender de subir banco para ser
 * verificada.
 */
export function decidirEscopo(
  organizationIds: string[],
  roles: readonly string[],
  provedora: string | null,
): EscopoDeOrganizacao {
  const ehProvider = Boolean(provedora) && organizationIds.includes(provedora!) && ehPapelDePlataforma(roles);
  return { organizationIds, ehProvider };
}

/** Em quais empresas a pessoa é membro, e se ela opera no nível da plataforma. */
export async function escopoDeOrganizacao(user: AuthenticatedUser): Promise<EscopoDeOrganizacao> {
  const linhas = await db
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, user.id))
    .catch(() => [] as Array<{ organizationId: string }>);

  return decidirEscopo([...new Set(linhas.map((l) => l.organizationId))], user.roles, organizacaoProvedora());
}

/**
 * Os ids de usuário que esta pessoa pode enxergar — colegas das empresas dela.
 *
 * É o recorte que faltava em `/collaborators`, `/team`, `/mcp-status` e
 * `/panorama`: os quatro devolvem PESSOAS e nenhum perguntava de qual empresa.
 * Com um tenant, isso é a equipe da casa. Com dois, é a equipe do concorrente.
 */
export async function colegasVisiveis(user: AuthenticatedUser): Promise<{ userIds: string[]; ehProvider: boolean }> {
  const escopo = await escopoDeOrganizacao(user);

  // Provider enxerga todo mundo — é o que faz a tela de Empresas existir.
  if (escopo.ehProvider) return { userIds: [], ehProvider: true };

  if (escopo.organizationIds.length === 0) return { userIds: [user.id], ehProvider: false };

  const linhas = await db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(inArray(schema.organizationMembers.organizationId, escopo.organizationIds))
    .catch(() => [] as Array<{ userId: string }>);

  // A própria pessoa sempre entra: sem isso, alguém fora de qualquer
  // organização deixaria de se ver na própria tela de equipe.
  return { userIds: [...new Set([user.id, ...linhas.map((l) => l.userId)])], ehProvider: false };
}
