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
  /** `organizations.id` — a fronteira de tenant. Toda query é recortada por ela. */
  organizationId: string;
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
 */
export function montarPrincipal(
  membership: MembershipRow,
  scopesDoToken: readonly string[],
  sessionId: string,
): McpPrincipal {
  const role = papelDaMembership(membership.role);
  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
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
