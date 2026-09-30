import { papelDaMembership, scopesEfetivos, temScope, type McpRole, type McpScope } from './scopes.js';

/**
 * principal.ts — QUEM está chamando, resolvido uma vez por requisição.
 *
 * O requisito §3 da missão em uma frase: nunca assumir que todos os usuários
 * têm as mesmas permissões. Este tipo é o que torna isso estrutural — nenhuma
 * tool recebe `userId` solto; todas recebem um `McpPrincipal` já resolvido, com
 * organização, papel e scopes efetivos.
 *
 * O que NÃO está aqui é tão importante quanto o que está: não há campo
 * `isAdmin`, não há booleano de bypass. A decisão passa sempre por papel +
 * scope + fronteira de organização.
 */
export interface McpPrincipal {
  /** `users.id` — quem é a pessoa no Desigual OS. */
  userId: string;
  /**
   * `organizations.id` — a organização ATIVA desta sessão. Continua sendo a
   * fronteira de toda query (`exigirMesmaOrganizacao`): nada aqui muda esse
   * comportamento, nenhuma tool passa a atravessar organização sozinha.
   */
  organizationId: string;
  /**
   * TODAS as organizações de que esta pessoa é membro — não só a ativa.
   * Mesmo campo que `apps/api` expõe em `/me` (`organizacoes`), calculado
   * pela mesma regra (`decidirEscopo`, `@desigual-os/auth`). Existe pra dar
   * base a uma tool de nível de plataforma decidir atravessar organização —
   * de propósito, NENHUMA tool hoje lê este campo pra isso. Adicionar o
   * dado não é autorizar o atravessamento; é o primeiro passo dos dois.
   */
  organizationIds: string[];
  /**
   * Opera no nível da plataforma (Desigual). NUNCA true só por papel forte —
   * exige também pertencer à organização provedora
   * (`PROVIDER_ORGANIZATION_ID`). Mesma regra de `apps/api`, mesma fonte
   * (`decidirEscopo`), pra não duplicar a decisão mais cara do produto.
   */
  ehProvider: boolean;
  /**
   * `organization_members.id`. A missão chama de `employee_id`: é a IDENTIDADE
   * DE TRABALHO, distinta da identidade de login. A mesma pessoa em duas
   * organizações é dois funcionários, com papéis podendo divergir.
   */
  employeeId: string;
  email: string;
  name: string;
  role: McpRole;
  /** Já é a interseção token ∩ papel. Ver `scopesEfetivos`. */
  scopes: McpScope[];
  /** Sessão MCP viva (`mcp_sessions.id`), para auditoria e correlação. */
  sessionId: string;
}

export interface MembershipRow {
  userId: string;
  organizationId: string;
  employeeId: string;
  email: string;
  name: string;
  role: string | null;
}

/**
 * Monta o principal a partir da membership do banco e dos scopes do token.
 *
 * O papel vem SEMPRE do banco, nunca do token: é isso que faz a revogação de
 * privilégio valer no próximo turno, sem esperar o token expirar.
 *
 * `escopoDePlataforma` chega PRONTO de quem chama (apps/mcp), calculado por
 * `decidirEscopo` (`@desigual-os/auth`) — este pacote fica sem depender de
 * banco nem de `@desigual-os/auth` de propósito (mcp-domain é lógica pura).
 * Duas opções aqui seriam errado: recalcular a regra (duplicaria a fonte
 * canônica) ou importar o pacote inteiro só pelo tipo (acoplaria um domínio
 * puro a infraestrutura). Receber o resultado já pronto evita as duas.
 */
export function montarPrincipal(
  membership: MembershipRow,
  scopesDoToken: readonly string[],
  sessionId: string,
  escopoDePlataforma: { organizationIds: string[]; ehProvider: boolean },
): McpPrincipal {
  const role = papelDaMembership(membership.role);
  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
    organizationIds: escopoDePlataforma.organizationIds,
    ehProvider: escopoDePlataforma.ehProvider,
    employeeId: membership.employeeId,
    email: membership.email,
    name: membership.name,
    role,
    scopes: scopesEfetivos(role, scopesDoToken),
    sessionId,
  };
}

/** Erro de autorização com o vocabulário que o MCP devolve ao Claude. */
export class McpAuthorizationError extends Error {
  readonly code: 'PERMISSION_DENIED' | 'SCOPE_MISSING' | 'OUT_OF_ORGANIZATION';
  readonly detalhe: Record<string, unknown>;
  constructor(
    code: 'PERMISSION_DENIED' | 'SCOPE_MISSING' | 'OUT_OF_ORGANIZATION',
    message: string,
    detalhe: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'McpAuthorizationError';
    this.code = code;
    this.detalhe = detalhe;
  }
}

/**
 * Porta de scope. Lança em vez de devolver booleano de propósito: um `if`
 * esquecido numa tool vira acesso indevido silencioso, e a exceção não tem como
 * ser esquecida.
 */
export function exigirScope(principal: McpPrincipal, exigido: McpScope): void {
  if (!temScope(principal.scopes, exigido)) {
    throw new McpAuthorizationError(
      'SCOPE_MISSING',
      `Seu acesso não inclui "${exigido}". Papel atual: ${principal.role}.`,
      { exigido, papel: principal.role, scopes: principal.scopes },
    );
  }
}

/**
 * Fronteira de tenant. Recurso de outra organização não existe para este
 * principal — e a mensagem diz "não encontrei", não "sem permissão", porque
 * confirmar a EXISTÊNCIA de um recurso de outro tenant já é vazamento.
 */
export function exigirMesmaOrganizacao(principal: McpPrincipal, organizationIdDoRecurso: string | null): void {
  if (organizationIdDoRecurso !== principal.organizationId) {
    throw new McpAuthorizationError('OUT_OF_ORGANIZATION', 'Não encontrei esse recurso.', {
      organizacaoDoPrincipal: principal.organizationId,
    });
  }
}
