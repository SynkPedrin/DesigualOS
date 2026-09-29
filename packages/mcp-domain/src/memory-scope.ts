/**
 * memory-scope.ts — quem pode ver o que a memória guarda.
 *
 * A memória compartilhada é o maior diferencial do control plane: o Claude da
 * Tammy aprende algo e o Claude do Endrigo passa a saber. E é também o maior
 * risco, porque "compartilhar tudo" e "compartilhar nada" são os dois erros
 * fáceis, em direções opostas.
 *
 * O escopo é o que separa os dois. E há uma garantia aqui que NÃO PODE FALHAR
 * em nenhuma circunstância:
 *
 *   USER_PRIVATE nunca alcança outro usuário.
 *
 * Não "quase nunca", não "se a query estiver certa". Por isso a decisão é uma
 * função pura, testada por varredura, e não um `where` espalhado por cada tool
 * que consulta memória.
 */

export const MEMORY_SCOPES = [
  /** Vale para a agência inteira. Todo mundo com memory.read alcança. */
  'AGENCY',
  /** Vale para um cliente. Alcança quem tem acesso àquele cliente. */
  'CLIENT',
  /** Sobre uma pessoa da equipe (função, forma de trabalhar). */
  'EMPLOYEE',
  /** Sobre um tipo de entrega (carrossel, reels, landing). */
  'DELIVERY_TYPE',
  /** Sobre uma campanha. */
  'CAMPAIGN',
  /** Sobre um processo interno da agência. */
  'PROCESS',
  /** Do próprio usuário. NUNCA alcança outra pessoa. */
  'USER_PRIVATE',
] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export function isMemoryScope(value: string): value is MemoryScope {
  return (MEMORY_SCOPES as readonly string[]).includes(value);
}

export interface MemoriaParaVisibilidade {
  scope: MemoryScope;
  /** Dono, quando o escopo é USER_PRIVATE. */
  userId?: string | null;
  /** Cliente, quando o escopo é CLIENT. */
  clientId?: string | null;
}

export interface QuemPergunta {
  userId: string;
  /** Clientes que esta pessoa pode ver. */
  clientesPermitidos: ReadonlySet<string>;
  /** A pessoa tem `memory.read`? Sem isso, nada de memória. */
  podeLerMemoria: boolean;
}

/**
 * Esta pessoa pode ver esta memória?
 *
 * Ordem deliberada: a checagem de USER_PRIVATE vem PRIMEIRO e é absoluta.
 * Nenhum papel, nem SUPER_ADMIN, atravessa — memória privada de um funcionário
 * não é dado da empresa, e um administrador que pode ler tudo transforma o
 * escopo privado em teatro.
 */
export function podeVer(memoria: MemoriaParaVisibilidade, quem: QuemPergunta): boolean {
  if (memoria.scope === 'USER_PRIVATE') {
    return Boolean(memoria.userId) && memoria.userId === quem.userId;
  }
  if (!quem.podeLerMemoria) return false;
  if (memoria.scope === 'CLIENT') {
    // Memória de cliente segue a fronteira de cliente, não a de memória.
    return Boolean(memoria.clientId) && quem.clientesPermitidos.has(memoria.clientId!);
  }
  return true;
}

/** Filtra uma lista inteira. É o que as tools chamam — nunca `podeVer` solto. */
export function filtrarVisiveis<T extends MemoriaParaVisibilidade>(
  memorias: readonly T[],
  quem: QuemPergunta,
): T[] {
  return memorias.filter((m) => podeVer(m, quem));
}

/**
 * Escopo padrão de um registro novo, pelo que ele traz.
 *
 * Nunca devolve USER_PRIVATE por dedução: privado é escolha explícita de quem
 * registra. Adivinhar para o lado privado esconderia da equipe algo que era
 * para ser compartilhado, e é o tipo de erro que ninguém percebe.
 */
export function escopoPadrao(input: { clientId?: string | null; employeeId?: string | null; campaignId?: string | null }): MemoryScope {
  if (input.clientId) return 'CLIENT';
  if (input.campaignId) return 'CAMPAIGN';
  if (input.employeeId) return 'EMPLOYEE';
  return 'AGENCY';
}
