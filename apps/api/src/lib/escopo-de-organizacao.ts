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
  descendentesTransitivos,
  ehPapelDePlataforma,
  organizacaoProvedora,
  type EscopoDeOrganizacao,
  type NoDaArvore,
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
 * A SUBÁRVORE de uma empresa: ela mesma + descendentes diretos e transitivos.
 *
 * É a metade COM BANCO da regra pura de `packages/auth`
 * (hierarquia-de-organizacao.ts): aqui se carrega a árvore, lá se decide.
 * `organizations` é pequena (casa das dezenas mesmo com todos os clientes do
 * provedor migrados), então a árvore inteira vem numa consulta só e o BFS
 * acontece em memória — alternativa seria uma CTE recursiva por chamada, que
 * custaria uma ida ao banco por nível da árvore num pool de três conexões.
 *
 * ESTE HELPER É A PEÇA PRONTA da fronteira de leitura hierárquica. O rollout
 * nos leitores de memória (os 24 arquivos que hoje recortam só pela org
 * ativa) é follow-up documentado — quando acontecer, é daqui que cada um
 * busca a subárvore, nunca de uma query improvisada.
 */
export async function subarvoreDe(organizationId: string): Promise<string[]> {
  const arvore = await arvoreDeOrganizacoes();
  return [organizationId, ...descendentesTransitivos(arvore, organizationId)];
}

/**
 * A árvore inteira de empresas (id + pai). Separada de `subarvoreDe` porque
 * quem precisa da subárvore de VÁRIAS raízes (ex: GET /organizations de um
 * dono de agência com duas empresas) carrega uma vez e desce por todas —
 * uma ida ao banco por raiz, num pool de três conexões, é a armadilha
 * medida no /panorama.
 */
export async function arvoreDeOrganizacoes(): Promise<NoDaArvore[]> {
  return db
    .select({ id: schema.organizations.id, parentId: schema.organizations.parentId })
    .from(schema.organizations)
    .catch(() => [] as NoDaArvore[]);
}

/**
 * Os papéis que a pessoa tem em CADA empresa de que é membro — a metade com
 * banco de "quem administra o quê". O papel de plataforma (user.roles) não
 * responde isto: `master` da Cosentino é master da Cosentino, e só.
 */
export async function papeisPorOrganizacao(user: AuthenticatedUser): Promise<Map<string, string>> {
  const linhas = await db
    .select({
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, user.id))
    .catch(() => [] as Array<{ organizationId: string; role: string }>);

  return new Map(linhas.map((l) => [l.organizationId, l.role]));
}

/**
 * O recorte pela EMPRESA DE TRABALHO, como FRAGMENTO DE SQL — a regra decidida
 * em 05/10/2026 depois do vazamento cross-tenant confirmado em runtime (um
 * provedor dentro da "Empresa QA White Label" recebeu 50 memórias da operação
 * da Desigual por `GET /memories`).
 *
 * A regra tem DUAS pernas, e a segunda é a que importa:
 *
 *   1. a linha pertence à empresa de trabalho resolvida server-side (a mesma
 *      de `requireTenant` e de `GET /activity` — `organizacao_ativa`, nunca um
 *      id vindo do navegador);
 *   2. `organization_id IS NULL` é LEGADO PRÉ-MIGRAÇÃO 0045 — dado da própria
 *      plataforma, de quando existia uma empresa só. Entra SOMENTE quando a
 *      empresa de trabalho é a provedora; dentro de um tenant vendido, NULL
 *      NUNCA entra, nem para master. "Master dentro da Desigual vê o legado;
 *      master dentro da Empresa QA vê só Empresa QA."
 *
 * Antes desta função, cada rota improvisava: `tenantSharingScope` unia TODAS
 * as empresas da pessoa (e master atravessava tudo), e a CTE do `/panorama`
 * deixava `organization_id is null` entrar para qualquer um. As três formas
 * deram o mesmo vazamento em três telas.
 */
export function recorteDaOrganizacaoDeTrabalho(
  organizacaoDeTrabalhoId: string,
  coluna: SQL | unknown,
): SQL {
  const provedora = organizacaoProvedora();
  const legadoVisivel = provedora !== null && organizacaoDeTrabalhoId === provedora;
  return sql`(${coluna} = ${organizacaoDeTrabalhoId}::uuid or (${legadoVisivel} and ${coluna} is null))`;
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

/**
 * Porteiro de rota: SÓ O PROVEDOR passa.
 *
 * Diferente de recorte por empresa. Recorte serve para dado que EXISTE por
 * empresa (cliente, memória, tarefa). Isto serve para o que não tem dimensão de
 * empresa nenhuma e mesmo assim não é de todo mundo: a INFRAESTRUTURA da
 * plataforma.
 *
 * Conferido no banco em 30/09/2026: `nodes` (5 linhas), `health_checks`
 * (140.932) e `node_capabilities` (6) não têm `client_id`, `user_id` nem
 * `organization_id`. São as máquinas que rodam os agentes, compartilhadas por
 * toda a plataforma — recortá-las por empresa seria inventar uma dimensão que
 * o dado não tem, e sugerir que cada cliente tem servidor próprio, que é
 * falso no modelo cloud multi-tenant (seção 7).
 *
 * O problema real ali é outro: `/nodes` e `/health/nodes/:id` devolvem
 * `private_host` — o endereço interno das máquinas. Hoje isso é visível para
 * quem tem `nodes:read`; num mundo multiempresa, isso incluiria o
 * administrador de uma empresa cliente. A seção 22 é explícita: "cliente não
 * pode receber o Control Plane técnico", e a 53 põe observabilidade na área
 * administrativa.
 */
export function exigirProvedor(): (request: { authUser?: AuthenticatedUser }, reply: {
  code: (n: number) => unknown;
  send: (body: unknown) => unknown;
}) => Promise<void> {
  return async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      void reply.send({ error: 'Not authenticated' });
      return;
    }
    const escopo = await escopoDeOrganizacao(user);
    if (!escopo.ehProvider) {
      reply.code(403);
      void reply.send({
        error: 'Infraestrutura da plataforma é visível só para quem a opera.',
      });
    }
  };
}
