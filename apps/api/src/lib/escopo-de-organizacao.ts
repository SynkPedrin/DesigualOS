import { db, schema } from '@desigual-os/database';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AuthenticatedUser } from '../auth/middleware';
/**
 * O NÚCLEO DA REGRA mora em `@desigual-os/auth` — o MCP precisa dela e não
 * pode importar de dentro de outro app. Aqui ficam só as partes que dependem
 * de banco e do usuário autenticado do Fastify.
 */
import {
  decidirEscopo,
  ehPapelDePlataforma,
  organizacaoProvedora,
  type EscopoDeOrganizacao,
} from '@desigual-os/auth';

export { decidirEscopo, ehPapelDePlataforma, organizacaoProvedora, type EscopoDeOrganizacao };

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

/**
 * O recorte de pessoas visíveis, como FRAGMENTO DE SQL.
 *
 * Existe porque a alternativa é pior das duas formas possíveis:
 *
 *   - resolver as organizações antes e filtrar depois custa duas idas ao banco
 *     ANTES da consulta principal, e o pool desta API tem três conexões. Já
 *     derrubei o /panorama assim duas vezes no mesmo dia (0,16s -> 2,9s);
 *   - escrever o `EXISTS` à mão em cada rota é a seção 82 sendo violada pela
 *     mesma pessoa que a citou — e treze cópias é treze chances de uma divergir.
 *
 * Então: uma consulta só, e uma fonte só. O fragmento vai dentro do `where` que
 * a rota já tem.
 *
 * `colunaDoUsuario` é a coluna que identifica a pessoa naquela consulta —
 * `schema.users.id` numa listagem de gente, `schema.mcpTokens.userId` numa de
 * conexões. Passar a coluna errada não quebra: silenciosamente não recorta
 * nada, que é o motivo de esta função existir em vez de cada rota improvisar.
 */
export function recorteDePessoasVisiveis(
  user: AuthenticatedUser,
  colunaDoUsuario: SQL | unknown,
): SQL {
  const papelDePlataforma = ehPapelDePlataforma(user.roles);
  const provedora = organizacaoProvedora();

  return sql`(
    (
      ${papelDePlataforma}
      and ${provedora}::uuid is not null
      and exists (
        select 1 from organization_members om
        where om.user_id = ${user.id}::uuid and om.organization_id = ${provedora}::uuid
      )
    )
    or exists (
      select 1 from organization_members meu
      join organization_members dele on dele.organization_id = meu.organization_id
      where meu.user_id = ${user.id}::uuid and dele.user_id = ${colunaDoUsuario}
    )
    or ${colunaDoUsuario} = ${user.id}::uuid
  )`;
}

/**
 * O recorte para tabelas que NÃO têm `organization_id` — só `client_id` e/ou
 * `user_id`.
 *
 * É o caso de `studio_assets`, `studio_jobs`, `cost_records` e `token_usage`:
 * ficaram de fora da migração 0045 porque não são conteúdo do Brain, e mesmo
 * assim carregam dado sensível de empresa (peça criativa de um cliente, quanto
 * cada conta gastou).
 *
 * A fronteira sai do vínculo que já existe: a empresa dona do CLIENTE, ou a
 * empresa de quem CRIOU. Mesma precedência de `organizacaoDaEscrita` em
 * packages/auth — cliente primeiro, pessoa depois — para as duas não
 * divergirem.
 *
 * `null` nas duas pontas continua visível: são linhas antigas sem vínculo, e
 * escondê-las faria a tela encolher hoje sem ninguém entender por quê. Quando
 * existir uma segunda empresa, essas linhas precisam ser resolvidas antes —
 * está anotado no inventário.
 */
export function recorteViaClienteOuPessoa(
  user: AuthenticatedUser,
  colunaDeCliente: SQL | unknown,
  colunaDeUsuario?: SQL | unknown,
): SQL {
  const papelDePlataforma = ehPapelDePlataforma(user.roles);
  const provedora = organizacaoProvedora();

  const porPessoa =
    colunaDeUsuario === undefined
      ? sql`false`
      : sql`exists (
          select 1 from organization_members dono
          join organization_members meu on meu.organization_id = dono.organization_id
          where dono.user_id = ${colunaDeUsuario} and meu.user_id = ${user.id}::uuid
        )`;

  return sql`(
    (
      ${papelDePlataforma}
      and ${provedora}::uuid is not null
      and exists (
        select 1 from organization_members om
        where om.user_id = ${user.id}::uuid and om.organization_id = ${provedora}::uuid
      )
    )
    or exists (
      select 1 from clients c
      join organization_members meu on meu.organization_id = c.organization_id
      where c.id = ${colunaDeCliente} and meu.user_id = ${user.id}::uuid
    )
    or ${porPessoa}
    or (${colunaDeCliente} is null${colunaDeUsuario === undefined ? sql`` : sql` and ${colunaDeUsuario} is null`})
  )`;
}
