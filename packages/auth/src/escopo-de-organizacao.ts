/**
 * escopo-de-organizacao.ts — o NÚCLEO da fronteira entre empresas.
 *
 * Mora em `packages/auth` porque a regra precisa valer igual nos três lugares
 * que decidem acesso: a API, o worker e o MCP. `apps/mcp` não importa de dentro
 * de outro app — e não deve, é exatamente a fronteira que a seção 83 pede para
 * não furar. Replicar estas funções lá seria duplicar a MESMA regra de negócio
 * que este trabalho inteiro existiu para centralizar.
 *
 * O que fica aqui é PURO: recebe ids e papéis, devolve decisão. O que depende
 * de banco ou do usuário autenticado do Fastify continua em
 * `apps/api/src/lib/escopo-de-organizacao.ts`, que passa a importar daqui.
 *
 * ---
 *
 * A REGRA, e por que ela é a mais cara de todas:
 *
 * Hoje `master` significa "dono da Desigual" e atravessar tudo está certo, com
 * uma organização só. Passa a estar ERRADO no minuto em que uma empresa cliente
 * tiver o próprio administrador: ele também é master — da empresa DELE — e o
 * mesmo atalho o deixaria ler outro tenant.
 *
 * Papel forte DENTRO de uma empresa não pode significar poder SOBRE todas as
 * empresas. Por isso `ehProvider` exige DUAS condições juntas: papel de
 * plataforma E pertencer à organização provedora.
 */

export interface EscopoDeOrganizacao {
  /** Empresas em que a pessoa é membro. Vazio = não vê nada além do próprio. */
  organizationIds: string[];
  /**
   * Opera no nível da plataforma, podendo alcançar outras empresas conforme a
   * rota permitir. NUNCA verdadeiro só por causa do papel.
   */
  ehProvider: boolean;
}

/**
 * A organização provedora, lida do ambiente.
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
 * Decide o escopo a partir do que já foi carregado. Pura de propósito: a regra
 * que separa tenant de provider não pode depender de subir banco para ser
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
