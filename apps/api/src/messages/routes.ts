import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { publishWsEvent } from '@desigual-os/orchestrator';
import { requireAuth } from '../auth/middleware';
import { uploadUserFile } from '../lib/storage';

const sendMessageSchema = z.object({
  recipient_id: z.string().uuid(),
  content: z.string().min(1).optional(),
});

function serializeMessage(row: typeof schema.directMessages.$inferSelect) {
  return {
    id: row.id,
    sender_id: row.senderId,
    recipient_id: row.recipientId,
    content: row.content,
    attachment_url: row.attachmentUrl,
    attachment_type: row.attachmentType,
    attachment_filename: row.attachmentFilename,
    read: row.readAt !== null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Mensageria direta entre pessoas (pedido do usuário, confirmado via
 * AskUserQuestion: "Sim, quero mensageria entre pessoas também"). Sem
 * conceito de grupo, só thread 1:1 entre dois `users`.
 */
export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/messages', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const senderId = request.authUser.id;

    let recipientId: string;
    let content: string | undefined;
    let attachment: { url: string; type: string; filename: string } | undefined;

    if (request.isMultipart()) {
      // @fastify/multipart só popula file.fields com os campos de texto que
      // já passaram no stream até aqui; o cliente precisa enviar
      // recipient_id/content ANTES do campo de arquivo no multipart form.
      const file = await request.file();
      if (!file) {
        reply.code(400);
        return { error: 'No file sent' };
      }

      const fields = file.fields as Record<string, { value?: unknown } | undefined>;
      const recipientField = fields.recipient_id?.value;
      const contentField = fields.content?.value;
      if (typeof recipientField !== 'string' || !z.string().uuid().safeParse(recipientField).success) {
        reply.code(400);
        return { error: 'Missing or invalid recipient_id field' };
      }
      recipientId = recipientField;
      content = typeof contentField === 'string' && contentField.length > 0 ? contentField : undefined;

      const buffer = await file.toBuffer();
      const path = `messages/${senderId}/${Date.now()}-${file.filename}`;
      const uploaded = await uploadUserFile(path, buffer, file.mimetype);
      attachment = { url: uploaded.url, type: file.mimetype, filename: file.filename };
    } else {
      const body = sendMessageSchema.parse(request.body);
      recipientId = body.recipient_id;
      content = body.content;
    }

    if (!content && !attachment) {
      reply.code(400);
      return { error: 'Message must have content or an attachment' };
    }
    if (recipientId === senderId) {
      reply.code(400);
      return { error: 'Cannot send a message to yourself' };
    }

    const [recipient] = await db.select().from(schema.users).where(eq(schema.users.id, recipientId));
    if (!recipient) {
      reply.code(404);
      return { error: `User '${recipientId}' not found` };
    }

    const [created] = await db
      .insert(schema.directMessages)
      .values({
        senderId,
        recipientId,
        content: content ?? null,
        attachmentUrl: attachment?.url ?? null,
        attachmentType: attachment?.type ?? null,
        attachmentFilename: attachment?.filename ?? null,
      })
      .returning();

    if (!created) {
      reply.code(500);
      return { error: 'Failed to create message' };
    }

    const serialized = serializeMessage(created);
    await publishWsEvent({ type: 'dm.received', payload: serialized });

    reply.code(201);
    return serialized;
  });

  app.get('/messages/threads', { preHandler: requireAuth }, async (request) => {
    const myId = request.authUser?.id ?? '';

    const rows = await db
      .select()
      .from(schema.directMessages)
      .where(or(eq(schema.directMessages.senderId, myId), eq(schema.directMessages.recipientId, myId)))
      .orderBy(desc(schema.directMessages.createdAt))
      .limit(500);

    const threads = new Map<string, { lastMessage: typeof rows[number]; unread: number }>();
    for (const row of rows) {
      const partnerId = row.senderId === myId ? row.recipientId : row.senderId;
      const existing = threads.get(partnerId);
      const isUnreadForMe = row.recipientId === myId && row.readAt === null;
      if (!existing) {
        threads.set(partnerId, { lastMessage: row, unread: isUnreadForMe ? 1 : 0 });
      } else if (isUnreadForMe) {
        existing.unread += 1;
      }
    }

    const partnerIds = [...threads.keys()];
    const partners = partnerIds.length > 0 ? await db.select().from(schema.users).where(or(...partnerIds.map((id) => eq(schema.users.id, id)))) : [];
    const partnerById = new Map(partners.map((partner) => [partner.id, partner]));

    return {
      threads: partnerIds
        .map((partnerId) => {
          const thread = threads.get(partnerId);
          const partner = partnerById.get(partnerId);
          if (!thread || !partner) {
            return null;
          }
          return {
            user: { id: partner.id, name: partner.name, avatar_url: partner.avatarUrl },
            last_message: serializeMessage(thread.lastMessage),
            unread_count: thread.unread,
          };
        })
        .filter((thread): thread is NonNullable<typeof thread> => thread !== null)
        .sort((a, b) => b.last_message.created_at.localeCompare(a.last_message.created_at)),
    };
  });

  app.get<{ Params: { userId: string } }>('/messages/:userId', { preHandler: requireAuth }, async (request) => {
    const myId = request.authUser?.id ?? '';
    const partnerId = request.params.userId;

    const rows = await db
      .select()
      .from(schema.directMessages)
      .where(
        or(
          and(eq(schema.directMessages.senderId, myId), eq(schema.directMessages.recipientId, partnerId)),
          and(eq(schema.directMessages.senderId, partnerId), eq(schema.directMessages.recipientId, myId)),
        ),
      )
      .orderBy(schema.directMessages.createdAt)
      .limit(200);

    await db
      .update(schema.directMessages)
      .set({ readAt: new Date() })
      .where(and(eq(schema.directMessages.senderId, partnerId), eq(schema.directMessages.recipientId, myId), isNull(schema.directMessages.readAt)));

    return { messages: rows.map(serializeMessage) };
  });
}
