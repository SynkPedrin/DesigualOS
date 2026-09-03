import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * ClickUp assina o corpo bruto do webhook com HMAC-SHA256 usando o `secret`
 * devolvido na criação do webhook (header `X-Signature`). Verificar isso é
 * o que torna seguro expor essa única rota publicamente (ver seção
 * "webhook público" do vault): sem o secret certo, o payload é ignorado,
 * mesmo que alguém descubra a URL.
 */
export function verifyClickUpSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export interface ClickUpMentionEvent {
  taskId: string;
  commentId: string;
  textContent: string;
}

/**
 * Payload do evento `taskCommentPosted` do ClickUp (confirmado na doc
 * oficial, https://developer.clickup.com/docs/webhooktaskpayloads):
 * `task_id` fica na RAIZ do payload, não aninhado em `history_items`. O
 * texto do comentário em si vem em formato tipo Quill delta
 * (`history_items[].comment`, lista de {text, attributes}), não documentado
 * pra menções (@user); em vez de tentar decifrar essa estrutura interna,
 * uso `text_content` (string plana, também documentada) e deixo quem
 * chama decidir se tem menção relevante ali (ex: `.includes('@Bento')`).
 */
export function parseTaskCommentPostedEvent(body: unknown): ClickUpMentionEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.event !== 'taskCommentPosted') return null;

  const taskId = record.task_id;
  if (typeof taskId !== 'string') return null;

  const historyItems = record.history_items;
  if (!Array.isArray(historyItems) || historyItems.length === 0) return null;
  const item = historyItems[0] as Record<string, unknown> | undefined;
  if (!item) return null;

  const commentId = typeof item.after === 'string' ? item.after : (item.comment as Record<string, unknown> | undefined)?.id;
  const commentRecord = item.comment as Record<string, unknown> | undefined;
  const textContent = commentRecord && typeof commentRecord.text_content === 'string' ? commentRecord.text_content : null;

  if (typeof commentId !== 'string' || textContent === null) return null;

  return { taskId, commentId, textContent };
}
