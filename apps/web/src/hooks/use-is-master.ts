import { useMe } from './use-me';

/**
 * `costs:read` is master-only on the backend (confirmed 2026-09-01): colaborador gets a 403.
 * Gate cost-related nav and widgets on this instead of surfacing that error to the user.
 */
export function useIsMaster() {
  const { data: me, isPending } = useMe();
  /**
   * `me?.roles?.includes(...)`, com o segundo `?.` — e ele vale por doze telas.
   *
   * O `?.` sozinho protegia `me`. Se o /me respondesse sem `roles` (API mais
   * velha num deploy escalonado, corpo truncado, resposta de erro com forma
   * diferente), isto estourava DENTRO do render — e como `useIsMaster` é usado
   * pela barra lateral e por doze telas, o estouro levava cada uma delas
   * junto. Medido em 08/10/2026 pelo teste de fumaça do sidebar: com um /me
   * sem `roles`, 12 de 35 telas não renderizavam.
   *
   * Papel ausente conta como NÃO-master: na dúvida, menos poder, nunca mais.
   */
  return { isMaster: me?.roles?.includes('master') ?? false, isPending };
}
