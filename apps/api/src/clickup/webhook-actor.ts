/**
 * webhook-actor.ts — extrai do payload do ClickUp o que o parseTaskChangedEvent
 * (tool-gateway) historicamente jogava fora: QUEM mexeu e QUANDO mexeu.
 *
 * O payload de taskCreated/taskUpdated/taskDeleted traz `history_items`, e cada
 * item tem `user` ({ id, username, email }) e `date` (epoch ms como string) —
 * ver a doc oficial de webhooktaskpayloads. Até 01/10/2026 o handler lia só
 * event/task_id/list_id, então todo evento nascia com `actor: null` e
 * `occurred_at = chegada`. Funções puras pra serem testadas sem Fastify e sem banco.
 */

export interface ClickUpEventAuthor {
  /** user.id do ClickUp como texto (a API manda número; o entity graph é texto). */
  clickupUserId: string;
  username: string | null;
  email: string | null;
}

export interface ClickUpHistoryContext {
  autor: ClickUpEventAuthor | null;
  /** Quando a mudança aconteceu no ClickUp (history_items[].date). */
  ocorridoEm: Date | null;
}

/**
 * Lê o primeiro history_item — o ClickUp manda um item por entrega de webhook.
 * Sem `user` (ou sem id), autor é null: quem chama NUNCA inventa quem mexeu,
 * registra actor_resolution='nao_resolvido' e segue.
 */
export function extrairContextoDoHistoryItem(raw: Record<string, unknown> | undefined): ClickUpHistoryContext {
  if (!raw) return { autor: null, ocorridoEm: null };
  const items = raw['history_items'];
  if (!Array.isArray(items) || items.length === 0) return { autor: null, ocorridoEm: null };
  const item = items[0] as Record<string, unknown> | undefined;
  if (!item || typeof item !== 'object') return { autor: null, ocorridoEm: null };

  let autor: ClickUpEventAuthor | null = null;
  const user = item['user'] as Record<string, unknown> | undefined;
  const id = user?.['id'];
  if (user && (typeof id === 'number' || typeof id === 'string')) {
    autor = {
      clickupUserId: String(id),
      username: typeof user['username'] === 'string' ? user['username'] : null,
      email: typeof user['email'] === 'string' ? user['email'] : null,
    };
  }

  let ocorridoEm: Date | null = null;
  const date = item['date'];
  const ms = typeof date === 'string' || typeof date === 'number' ? Number(date) : NaN;
  if (Number.isFinite(ms) && ms > 0) ocorridoEm = new Date(ms);

  return { autor, ocorridoEm };
}
