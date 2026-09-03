import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

export interface RecentMessage {
  role: string;
  agent: string | null;
  content: string;
}

export interface ExecutionContext {
  userName: string | null;
  clientName: string | null;
  clientToneOfVoice: string | null;
  recentMessages: RecentMessage[];
}

const RECENT_MESSAGES_LIMIT = 5;

/**
 * Contexto mínimo por execução (seção 6.4): não busca conhecimento do
 * agente aqui (isso é sob demanda, local ao Node, Fase 04), só o que o
 * Orchestrator já tem à mão sem ir a lugar nenhum: quem é o usuário, qual
 * cliente, e as últimas mensagens da conversa (nunca a conversa inteira).
 */
export async function buildContext(params: {
  userId: string;
  clientId: string | null;
  conversationId: string | null;
}): Promise<ExecutionContext> {
  // As três buscas abaixo não dependem uma da outra; rodar em paralelo
  // (Promise.all) em vez de sequencial corta essa chamada, que acontece em
  // TODO chat/execução, de até 4 round-trips ao banco pra 1.
  const [userRow, clientRows, recentRows] = await Promise.all([
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, params.userId)),
    params.clientId
      ? Promise.all([
          db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, params.clientId)),
          db
            .select({ toneOfVoice: schema.clientBrandKits.toneOfVoice })
            .from(schema.clientBrandKits)
            .where(eq(schema.clientBrandKits.clientId, params.clientId)),
        ])
      : null,
    params.conversationId
      ? db
          .select({ role: schema.messages.role, agent: schema.messages.agent, content: schema.messages.content })
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, params.conversationId))
          .orderBy(desc(schema.messages.createdAt))
          .limit(RECENT_MESSAGES_LIMIT)
      : Promise.resolve([]),
  ]);

  const [user] = userRow;
  const [clientRow, brandKitRow] = clientRows ?? [[], []];

  return {
    userName: user?.name ?? null,
    clientName: clientRow[0]?.name ?? null,
    clientToneOfVoice: brandKitRow[0]?.toneOfVoice ?? null,
    recentMessages: recentRows.reverse(),
  };
}

/** Formata o contexto como um bloco de texto curto pra anexar ao prompt. */
export function formatContextForPrompt(context: ExecutionContext): string {
  const lines: string[] = [];
  // buildContext já busca isso do banco (comentário logo acima: "quem é o
  // usuário" faz parte do contexto mínimo), mas nunca chegava a entrar no
  // texto formatado, então o agente nunca sabia com quem estava falando.
  if (context.userName) lines.push(`Usuário: ${context.userName}`);
  if (context.clientName) lines.push(`Cliente: ${context.clientName}`);
  if (context.clientToneOfVoice) lines.push(`Tom de voz do cliente: ${context.clientToneOfVoice}`);
  if (context.recentMessages.length > 0) {
    lines.push('Histórico recente da conversa:');
    for (const message of context.recentMessages) {
      const speaker = message.role === 'user' ? 'Usuário' : (message.agent ?? 'Assistente');
      lines.push(`- ${speaker}: ${message.content}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '';
}
