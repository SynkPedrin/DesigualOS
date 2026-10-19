import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { VIDA_DO_CODIGO_MS, hashDoCodigo } from './identity';
import type { MensagemRecebida } from './inbound';

/**
 * Persistência do canal. Interface separada da implementação para o gateway
 * ser testado com um armazém em memória (ver gateway.test.ts) — o que é
 * testado lá é a decisão, e a decisão não depende do Postgres.
 */

export interface Vinculo {
  id: string;
  userId: string;
  organizationId: string | null;
  phone: string;
  chatId: string;
  conversationId: string | null;
  lastInboundAt: Date | null;
}

export interface RegistroRecebido {
  id: string;
  status: string;
  createdAt: Date;
  chatId: string;
  senderPhone: string | null;
  waMessageId: string;
  text: string | null;
  linkId: string | null;
  userId: string | null;
  conversationId: string | null;
  executionId: string | null;
  updatedAt: Date;
}

export type ResultadoDoCodigo =
  | { tipo: 'reivindicado'; userId: string }
  | { tipo: 'invalido' }
  | { tipo: 'numero_ja_vinculado' };

export interface AtualizacaoDoRecebido {
  status?: string;
  reason?: string | null;
  linkId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  conversationId?: string | null;
  executionId?: string | null;
  text?: string | null;
  error?: string | null;
  replyMessageIds?: string[];
  processedAt?: Date;
  repliedAt?: Date;
  latencyMs?: number;
  incrementarTentativas?: boolean;
}

export interface ArmazemDoCanal {
  /** Grava a mensagem; `nova=false` quando o mesmo `dedupeKey` já existia (retry/duplicata). */
  registrar(mensagem: MensagemRecebida): Promise<{ id: string; nova: boolean }>;
  atualizar(id: string, patch: AtualizacaoDoRecebido): Promise<void>;
  vinculoAtivoPorTelefone(telefone: string): Promise<Vinculo | null>;
  definirConversa(linkId: string, conversationId: string | null): Promise<void>;
  tocarVinculo(linkId: string, quando: Date): Promise<void>;
  reivindicarCodigo(codigo: string, telefone: string, chatId: string, agora: Date): Promise<ResultadoDoCodigo>;
  /** Quantas mensagens com tentativa de código este número mandou desde `desde`. */
  tentativasDeCodigo(telefone: string, desde: Date): Promise<number>;
  /** Turnos levados ao Brain para este usuário desde `desde`. */
  turnosDoUsuario(userId: string, desde: Date): Promise<number>;
  /** Transcrição de áudio esperando "sim" deste vínculo, mais nova que `desde`. */
  aguardandoConfirmacao(linkId: string, desde: Date): Promise<RegistroRecebido | null>;
  /** Mensagens que não chegaram ao fim (para retomar depois de reinício). */
  inacabadas(desde: Date): Promise<RegistroRecebido[]>;
}

function paraVinculo(linha: typeof schema.bentoWhatsappLinks.$inferSelect): Vinculo {
  return {
    id: linha.id,
    userId: linha.userId,
    organizationId: linha.organizationId,
    phone: linha.phone,
    chatId: linha.chatId,
    conversationId: linha.conversationId,
    lastInboundAt: linha.lastInboundAt,
  };
}

function paraRegistro(linha: typeof schema.bentoWhatsappInbound.$inferSelect): RegistroRecebido {
  return {
    id: linha.id,
    status: linha.status,
    createdAt: linha.createdAt,
    chatId: linha.chatId,
    senderPhone: linha.senderPhone,
    waMessageId: linha.waMessageId,
    text: linha.text,
    linkId: linha.linkId,
    userId: linha.userId,
    conversationId: linha.conversationId,
    executionId: linha.executionId,
    updatedAt: linha.updatedAt,
  };
}

const t = schema.bentoWhatsappInbound;

export const armazemPostgres: ArmazemDoCanal = {
  async registrar(mensagem) {
    const [inserida] = await db
      .insert(t)
      .values({
        dedupeKey: mensagem.dedupeKey,
        sessionId: mensagem.sessionId,
        waMessageId: mensagem.waMessageId,
        chatId: mensagem.chatId,
        senderPhone: mensagem.telefone,
        kind: mensagem.tipo,
        text: mensagem.texto || null,
        sentAt: mensagem.enviadaEm,
      })
      .onConflictDoNothing({ target: t.dedupeKey })
      .returning({ id: t.id });
    if (inserida) return { id: inserida.id, nova: true };
    const [existente] = await db.select({ id: t.id }).from(t).where(eq(t.dedupeKey, mensagem.dedupeKey));
    return { id: existente!.id, nova: false };
  },

  async atualizar(id, patch) {
    const { incrementarTentativas, ...campos } = patch;
    await db
      .update(t)
      .set({
        ...campos,
        ...(incrementarTentativas ? { attempts: sql`${t.attempts} + 1` } : {}),
      })
      .where(eq(t.id, id));
  },

  async vinculoAtivoPorTelefone(telefone) {
    const [linha] = await db
      .select()
      .from(schema.bentoWhatsappLinks)
      .where(and(eq(schema.bentoWhatsappLinks.phone, telefone), eq(schema.bentoWhatsappLinks.status, 'active')));
    return linha ? paraVinculo(linha) : null;
  },

  async definirConversa(linkId, conversationId) {
    await db
      .update(schema.bentoWhatsappLinks)
      .set({ conversationId })
      .where(eq(schema.bentoWhatsappLinks.id, linkId));
  },

  async tocarVinculo(linkId, quando) {
    await db
      .update(schema.bentoWhatsappLinks)
      .set({ lastInboundAt: quando })
      .where(eq(schema.bentoWhatsappLinks.id, linkId));
  },

  async reivindicarCodigo(codigo, telefone, chatId, agora) {
    const codigos = schema.bentoWhatsappLinkCodes;
    const [jaVinculado] = await db
      .select({ id: schema.bentoWhatsappLinks.id })
      .from(schema.bentoWhatsappLinks)
      .where(and(eq(schema.bentoWhatsappLinks.phone, telefone), eq(schema.bentoWhatsappLinks.status, 'active')));
    if (jaVinculado) return { tipo: 'numero_ja_vinculado' };
    // UPDATE condicional = uso único sem corrida: dois envios do mesmo código
    // ao mesmo tempo, só um encontra a linha ainda 'pending'.
    const [reivindicado] = await db
      .update(codigos)
      .set({ status: 'claimed', claimedPhone: telefone, claimedChatId: chatId, claimedAt: agora })
      .where(
        and(
          eq(codigos.codeHash, hashDoCodigo(codigo)),
          eq(codigos.status, 'pending'),
          gte(codigos.expiresAt, agora),
        ),
      )
      .returning({ userId: codigos.userId });
    return reivindicado ? { tipo: 'reivindicado', userId: reivindicado.userId } : { tipo: 'invalido' };
  },

  async tentativasDeCodigo(telefone, desde) {
    const [linha] = await db
      .select({ n: count() })
      .from(t)
      .where(
        and(
          eq(t.senderPhone, telefone),
          gte(t.createdAt, desde),
          inArray(t.reason, ['link_code_claimed', 'link_code_invalid', 'link_code_phone_taken']),
        ),
      );
    return Number(linha?.n ?? 0);
  },

  async turnosDoUsuario(userId, desde) {
    const [linha] = await db
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.userId, userId), gte(t.createdAt, desde), isNotNull(t.conversationId)));
    return Number(linha?.n ?? 0);
  },

  async aguardandoConfirmacao(linkId, desde) {
    const [linha] = await db
      .select()
      .from(t)
      .where(and(eq(t.linkId, linkId), eq(t.status, 'awaiting_confirmation'), gte(t.createdAt, desde)))
      .orderBy(desc(t.createdAt))
      .limit(1);
    return linha ? paraRegistro(linha) : null;
  },

  async inacabadas(desde) {
    const linhas = await db
      .select()
      .from(t)
      .where(and(inArray(t.status, ['received', 'processing', 'dispatched']), gte(t.createdAt, desde)))
      .orderBy(t.createdAt);
    return linhas.map(paraRegistro);
  },
};

/* ------------------------------------------------------------------ */
/* Lado web: código de vínculo, confirmação, revogação                  */
/* ------------------------------------------------------------------ */

const codigos = schema.bentoWhatsappLinkCodes;
const vinculos = schema.bentoWhatsappLinks;

/** Gerar código novo derruba os pendentes anteriores da mesma pessoa. */
export async function criarCodigo(input: {
  userId: string;
  organizationId: string | null;
  codigo: string;
  agora: Date;
}): Promise<{ id: string; expiresAt: Date }> {
  await db
    .update(codigos)
    .set({ status: 'cancelled' })
    .where(and(eq(codigos.userId, input.userId), inArray(codigos.status, ['pending', 'claimed'])));
  const expiresAt = new Date(input.agora.getTime() + VIDA_DO_CODIGO_MS);
  const [linha] = await db
    .insert(codigos)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      codeHash: hashDoCodigo(input.codigo),
      expiresAt,
    })
    .returning({ id: codigos.id });
  return { id: linha!.id, expiresAt };
}

export async function codigosGeradosDesde(userId: string, desde: Date): Promise<number> {
  const [linha] = await db
    .select({ n: count() })
    .from(codigos)
    .where(and(eq(codigos.userId, userId), gte(codigos.createdAt, desde)));
  return Number(linha?.n ?? 0);
}

export async function codigoEmAndamento(userId: string, agora: Date) {
  // Expira o que passou do prazo antes de responder, para a tela nunca
  // mostrar um código morto como vivo.
  await db
    .update(codigos)
    .set({ status: 'expired' })
    .where(and(eq(codigos.userId, userId), inArray(codigos.status, ['pending', 'claimed']), lt(codigos.expiresAt, agora)));
  const [linha] = await db
    .select()
    .from(codigos)
    .where(and(eq(codigos.userId, userId), inArray(codigos.status, ['pending', 'claimed'])))
    .orderBy(desc(codigos.createdAt))
    .limit(1);
  return linha ?? null;
}

export async function vinculoAtivoDoUsuario(userId: string) {
  const [linha] = await db
    .select()
    .from(vinculos)
    .where(and(eq(vinculos.userId, userId), eq(vinculos.status, 'active')));
  return linha ?? null;
}

export type ResultadoDaConfirmacao =
  | { tipo: 'vinculado'; linkId: string; phone: string; substituiu: string | null }
  | { tipo: 'sem_codigo' }
  | { tipo: 'numero_ja_vinculado' };

/**
 * Confirma o número reivindicado. Transação: revoga o vínculo anterior da
 * pessoa (troca de número) e cria o novo. Os índices únicos parciais seguram
 * a corrida em que o mesmo número é confirmado por duas pessoas ao mesmo
 * tempo — a segunda transação falha e vira 'numero_ja_vinculado'.
 */
export async function confirmarVinculo(input: {
  userId: string;
  organizationId: string | null;
  codeId: string;
  agora: Date;
}): Promise<ResultadoDaConfirmacao> {
  try {
    return await db.transaction(async (tx) => {
      const [codigo] = await tx
        .update(codigos)
        .set({ status: 'confirmed', confirmedAt: input.agora })
        .where(
          and(
            eq(codigos.id, input.codeId),
            eq(codigos.userId, input.userId),
            eq(codigos.status, 'claimed'),
            gte(codigos.expiresAt, input.agora),
          ),
        )
        .returning();
      if (!codigo?.claimedPhone || !codigo.claimedChatId) return { tipo: 'sem_codigo' } as const;

      const [doOutro] = await tx
        .select({ id: vinculos.id, userId: vinculos.userId })
        .from(vinculos)
        .where(and(eq(vinculos.phone, codigo.claimedPhone), eq(vinculos.status, 'active')));
      if (doOutro && doOutro.userId !== input.userId) return { tipo: 'numero_ja_vinculado' } as const;

      const [anterior] = await tx
        .update(vinculos)
        .set({ status: 'revoked', revokedAt: input.agora, revokedByUserId: input.userId, revokedReason: 'replaced' })
        .where(and(eq(vinculos.userId, input.userId), eq(vinculos.status, 'active')))
        .returning({ id: vinculos.id, phone: vinculos.phone });

      const [novo] = await tx
        .insert(vinculos)
        .values({
          userId: input.userId,
          organizationId: input.organizationId,
          phone: codigo.claimedPhone,
          chatId: codigo.claimedChatId,
        })
        .returning({ id: vinculos.id });
      return {
        tipo: 'vinculado',
        linkId: novo!.id,
        phone: codigo.claimedPhone,
        substituiu: anterior?.phone ?? null,
      } as const;
    });
  } catch (error) {
    const codigoPg = (error as { code?: string }).code;
    if (codigoPg === '23505') return { tipo: 'numero_ja_vinculado' };
    throw error;
  }
}

export async function recusarCodigo(userId: string, codeId: string): Promise<boolean> {
  const linhas = await db
    .update(codigos)
    .set({ status: 'cancelled' })
    .where(and(eq(codigos.id, codeId), eq(codigos.userId, userId), inArray(codigos.status, ['pending', 'claimed'])))
    .returning({ id: codigos.id });
  return linhas.length > 0;
}

export async function revogarVinculo(input: {
  linkId: string;
  porUserId: string;
  motivo: 'user' | 'admin';
  agora: Date;
  /** Quando presente, só revoga se o vínculo for deste usuário. */
  somenteDoUsuario?: string;
}) {
  const [revogado] = await db
    .update(vinculos)
    .set({ status: 'revoked', revokedAt: input.agora, revokedByUserId: input.porUserId, revokedReason: input.motivo })
    .where(
      and(
        eq(vinculos.id, input.linkId),
        eq(vinculos.status, 'active'),
        ...(input.somenteDoUsuario ? [eq(vinculos.userId, input.somenteDoUsuario)] : []),
      ),
    )
    .returning();
  return revogado ?? null;
}
