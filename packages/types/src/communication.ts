/**
 * Comunicação EXTERNA (P1-A, 06/10/2026) — contato/canal/conversa de fora da
 * agência. Distinto do chat interno com Bento (packages/database
 * schema/conversation.ts), que não tem canal nem contato externo.
 */
export const COMMUNICATION_CHANNELS = ['whatsapp'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const CONVERSATION_STATUSES = ['open', 'waiting_client', 'waiting_agency', 'archived'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_DELIVERY_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];
