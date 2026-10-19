import { z } from 'zod';

/**
 * CONTRATO COM O OPENWA (v0.25.0), só a parte que o Bento usa.
 *
 * Fonte: o código do OpenWA, não a documentação — as duas divergem em pontos
 * que importam aqui:
 *   - `sessionId` no envelope é o UUID da sessão, não o nome (a doc mostra o nome);
 *   - não existe `hasMedia` nem `participant` em `message.received`: mídia é a
 *     presença de `media`, e o remetente em grupo é `author`.
 * Arquivos de referência: src/engine/interfaces/whatsapp-engine.interface.ts
 * (IncomingMessage), src/modules/webhook/webhook-delivery.service.ts
 * (envelope) e src/modules/webhook/utils/deliver-once.ts (cabeçalhos).
 *
 * Tudo é `passthrough`/opcional além do mínimo: o OpenWA acrescenta campo
 * novo entre versões, e o Bento não pode parar de ouvir por causa de um campo
 * que ele nem lê.
 */

export const OPENWA_SIGNATURE_HEADER = 'x-openwa-signature';
export const OPENWA_IDEMPOTENCY_HEADER = 'x-openwa-idempotency-key';
export const OPENWA_EVENT_HEADER = 'x-openwa-event';

export const openwaIncomingMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string(),
    to: z.string().optional(),
    chatId: z.string().min(1),
    body: z.string().optional().default(''),
    type: z.string().default('unknown'),
    /** Unix em SEGUNDOS. */
    timestamp: z.number().optional(),
    fromMe: z.boolean().default(false),
    isGroup: z.boolean().default(false),
    kind: z.string().optional(),
    isStatusBroadcast: z.boolean().optional(),
    author: z.string().optional(),
    mentionedIds: z.array(z.string()).optional(),
    quotedMessage: z.object({ id: z.string(), body: z.string().optional() }).passthrough().optional(),
    media: z
      .object({
        mimetype: z.string(),
        filename: z.string().optional(),
        data: z.string().optional(),
        omitted: z.boolean().optional(),
        sizeBytes: z.number().optional(),
      })
      .passthrough()
      .optional(),
    senderPhone: z.string().nullable().optional(),
    isLidSender: z.boolean().optional(),
  })
  .passthrough();

export type OpenwaIncomingMessage = z.infer<typeof openwaIncomingMessageSchema>;

export const openwaWebhookEnvelopeSchema = z
  .object({
    event: z.string(),
    /** ISO do despacho. Está dentro do corpo assinado — é o que dá proteção contra replay. */
    timestamp: z.string(),
    sessionId: z.string(),
    idempotencyKey: z.string().optional(),
    deliveryId: z.string().optional(),
    data: z.unknown(),
  })
  .passthrough();

export type OpenwaWebhookEnvelope = z.infer<typeof openwaWebhookEnvelopeSchema>;

/** Status de sessão do OpenWA. */
export const OPENWA_SESSION_STATUSES = [
  'created',
  'initializing',
  'qr_ready',
  'authenticating',
  'ready',
  'disconnected',
  'action_required',
  'failed',
] as const;

export interface OpenwaSession {
  id: string;
  name: string;
  status: string;
  phone?: string | null;
  pushName?: string | null;
  connectedAt?: string | null;
  lastActive?: string | null;
  lastError?: string | null;
  engineLoaded?: boolean;
}

export interface OpenwaSentMessage {
  messageId: string;
  timestamp: number;
}

/**
 * O que o gateway do Bento precisa do transporte. É a fronteira com o OpenWA:
 * o gateway nunca fala HTTP, e os testes trocam isto por um dublê.
 *
 * Quando a integração OpenWA do Inbox (outra frente, mesma infraestrutura)
 * publicar um cliente compartilhado, basta um adaptador para esta interface.
 */
export interface BentoWhatsappTransport {
  sendText(input: { chatId: string; text: string; quotedMessageId?: string; idempotencyKey: string }): Promise<OpenwaSentMessage>;
  setTyping(input: { chatId: string; state: 'typing' | 'recording' | 'paused' }): Promise<void>;
  markRead(input: { chatId: string; messageIds: string[] }): Promise<void>;
  downloadMedia(input: { chatId: string; messageId: string; maxBytes: number }): Promise<Buffer>;
  resolvePhone(contactId: string): Promise<string | null>;
  getSession(): Promise<OpenwaSession>;
  startSession(): Promise<OpenwaSession>;
  getQr(): Promise<{ qrCode: string; status: string }>;
  /** Código de 8 caracteres para conectar digitando no celular (alternativa ao QR). */
  requestPairingCode(phoneNumber: string): Promise<{ pairingCode: string; status: string }>;
}
