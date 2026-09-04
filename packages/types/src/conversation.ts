export const CONVERSATION_VISIBILITIES = ['private', 'public'] as const;

export type ConversationVisibility = (typeof CONVERSATION_VISIBILITIES)[number];
