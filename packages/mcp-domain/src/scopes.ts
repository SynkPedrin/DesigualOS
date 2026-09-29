/**
 * scopes.ts — o vocabulário de autorização do MCP.
 *
 * O Desigual OS já tem RBAC em banco (`roles` + `permissions`, com curinga,
 * resolvido por `packages/auth/src/rbac.ts`). Este módulo NÃO o substitui: ele
 * traduz aquele modelo para o vocabulário que o OAuth do MCP precisa falar, e
 * acrescenta a única coisa que faltava — um papel por FUNÇÃO na agência, e não
 * só `master` / `colaborador`.
 *
 * A regra de ouro: **o scope é um teto, nunca um poder.** Um token com
 * `tasks.write` só escreve se o papel do usuário também permitir E se o recurso
 * estiver dentro da organização dele. Scope amplo com papel restrito dá acesso
 * restrito. Nunca o contrário.
 */

/** Scopes OAuth expostos ao cliente MCP. */
export const MCP_SCOPES = [
  'desigual.read',
  'desigual.write',
  'tasks.read',
  'tasks.write',
  'clients.read',
  'clients.write',
  'memory.read',
  'memory.write',
  'traffic.read',
  'assets.read',
  'assets.write',
  'admin.read',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/**
 * Papéis por FUNÇÃO na agência.
 *
 * Moram em `organization_members.role` (coluna `text`, já existente) e não no
 * enum `role_name` do Postgres — ampliar aquele enum quebraria todo código que
 * assume dois valores (`master` | `colaborador`), e o objetivo aqui é ser
 * aditivo. Os dois convivem: `role_name` continua governando a aplicação web,
 * este governa o MCP.
 */
export const MCP_ROLES = [
  'SUPER_ADMIN',
  'MANAGER',
  'CREATIVE',
  'CUSTOMER_SUCCESS',
  'TRAFFIC_MANAGER',
  'QA',
  'VIEWER',
] as const;

export type McpRole = (typeof MCP_ROLES)[number];

export function isMcpRole(value: string): value is McpRole {
  return (MCP_ROLES as readonly string[]).includes(value);
}

/**
 * O TETO de cada papel. É a lista completa do que aquele papel pode fazer —
 * o token pede um subconjunto disto, nunca mais.
 *
 * Desenho deliberado, e vale explicar duas escolhas:
 *
 *  - **VIEWER não lê memória.** Memória institucional carrega decisão
 *    comercial, feedback cru de cliente e aprendizado interno. Quem só observa
 *    a operação não precisa disso, e o custo de vazar é alto.
 *
 *  - **Ninguém além de SUPER_ADMIN e MANAGER escreve cliente.** Criar ou
 *    alterar cliente é ato comercial. Criativo e atendimento operam DENTRO de
 *    clientes que já existem.
 */
const TETO_POR_PAPEL: Record<McpRole, readonly McpScope[]> = {
  SUPER_ADMIN: MCP_SCOPES,
  MANAGER: [
    'desigual.read', 'desigual.write',
    'tasks.read', 'tasks.write',
    'clients.read', 'clients.write',
    'memory.read', 'memory.write',
    'traffic.read',
    'assets.read', 'assets.write',
    'admin.read',
  ],
  CREATIVE: [
    'desigual.read',
    'tasks.read', 'tasks.write',
    'clients.read',
    'memory.read', 'memory.write',
    'assets.read', 'assets.write',
  ],
  CUSTOMER_SUCCESS: [
    'desigual.read',
    'tasks.read', 'tasks.write',
    'clients.read',
    'memory.read', 'memory.write',
    'assets.read',
  ],
  TRAFFIC_MANAGER: [
    'desigual.read',
    'tasks.read', 'tasks.write',
    'clients.read',
    'memory.read', 'memory.write',
    'traffic.read',
    'assets.read',
  ],
  QA: [
    'desigual.read',
    'tasks.read', 'tasks.write',
    'clients.read',
    'memory.read', 'memory.write',
    'assets.read',
  ],
  VIEWER: ['desigual.read', 'tasks.read', 'clients.read'],
};

export function scopesDoPapel(role: McpRole): readonly McpScope[] {
  return TETO_POR_PAPEL[role];
}

/**
 * `desigual.read` e `desigual.write` são GUARDA-CHUVAS: pedir um deles é pedir
 * as leituras (ou as escritas) de uma vez. Existem porque a tela de
 * consentimento do OAuth fica ilegível com doze caixas de seleção.
 */
const COBERTO_POR_LEITURA: readonly McpScope[] = ['tasks.read', 'clients.read', 'memory.read', 'traffic.read', 'assets.read'];
const COBERTO_POR_ESCRITA: readonly McpScope[] = ['tasks.write', 'clients.write', 'memory.write', 'assets.write'];

/**
 * Os scopes EFETIVOS de uma sessão: o que o token pediu, com os guarda-chuvas
 * já abertos, cortado pelo teto do papel.
 *
 * ── POR QUE A EXPANSÃO ACONTECE AQUI, E NÃO NA CHECAGEM ──────────────────
 *
 * A primeira versão deste módulo guardava `desigual.read` inteiro no principal
 * e abria o guarda-chuva na hora de checar. O próprio teste desta pasta pegou o
 * furo: um CREATIVE com `desigual.read` passava em `traffic.read`, porque a
 * expansão não reconsultava o teto — e tráfego não está no teto de CREATIVE.
 * Era exatamente a falha que o comentário do topo deste arquivo promete impedir.
 *
 * Expandindo ANTES da interseção, o principal carrega uma lista concreta e já
 * limitada, e a checagem vira um `includes` que não tem como errar. A regra
 * "scope é teto, nunca poder" passa a ser estrutural em vez de depender de
 * quem escreve a função de checagem lembrar dela.
 */
export function scopesEfetivos(role: McpRole, scopesDoToken: readonly string[]): McpScope[] {
  const pedidos = new Set<McpScope>();
  for (const bruto of scopesDoToken) {
    if (!isMcpScope(bruto)) continue;
    pedidos.add(bruto);
    if (bruto === 'desigual.read') for (const s of COBERTO_POR_LEITURA) pedidos.add(s);
    if (bruto === 'desigual.write') for (const s of COBERTO_POR_ESCRITA) pedidos.add(s);
  }
  const teto = new Set<McpScope>(TETO_POR_PAPEL[role]);
  // A ordem de MCP_SCOPES dá saída estável — o principal vai para log e para
  // asserção de teste, e lista instável faz diff e teste piscarem.
  return MCP_SCOPES.filter((s) => pedidos.has(s) && teto.has(s));
}

/**
 * Tem o scope? Simples de propósito: a expansão de guarda-chuva e o corte pelo
 * papel já aconteceram em `scopesEfetivos`.
 */
export function temScope(scopesEfetivosDaSessao: readonly McpScope[], exigido: McpScope): boolean {
  return scopesEfetivosDaSessao.includes(exigido);
}

/** Papel que uma linha de `organization_members.role` representa. Desconhecido vira VIEWER. */
export function papelDaMembership(role: string | null | undefined): McpRole {
  const bruto = (role ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (isMcpRole(bruto)) return bruto;
  /**
   * `collaborator` é o default histórico da coluna e hoje descreve toda a
   * equipe. Mapear para VIEWER trancaria a agência inteira fora do MCP no
   * primeiro deploy; mapear para algo amplo daria escrita a quem nunca foi
   * classificado. CUSTOMER_SUCCESS é o meio: opera tarefa e memória, não mexe
   * em cliente nem vê tráfego nem admin.
   */
  if (bruto === 'COLLABORATOR' || bruto === 'COLABORADOR') return 'CUSTOMER_SUCCESS';
  if (bruto === 'OWNER' || bruto === 'ADMIN' || bruto === 'MASTER') return 'SUPER_ADMIN';
  return 'VIEWER';
}
