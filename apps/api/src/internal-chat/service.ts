import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * Comunicação interna — regras de acesso e dados. Toda função recebe a
 * organização e a pessoa já autenticadas pela rota; NADA aqui confia num id
 * vindo do cliente sem antes passar por `conversaAcessivel`.
 *
 * Quem acessa o quê:
 *  - #Geral: membro ATIVO da organização (organization_members + users.active).
 *    Desativou, perdeu acesso na hora — nenhuma lista guardada a manter.
 *  - Privada: os dois participantes (internal_conversation_members), e só
 *    enquanto os dois forem membros ativos da organização. Administrador NÃO
 *    tem acesso automático ao conteúdo privado.
 */

type Conversa = typeof schema.internalConversations.$inferSelect;
type Mensagem = typeof schema.internalMessages.$inferSelect;
type Anexo = typeof schema.internalMessageAttachments.$inferSelect;

export const LIMITE_DE_TEXTO = 8000;

export class AcessoNegado extends Error {
  constructor(message = 'Conversa não encontrada.') {
    super(message);
    this.name = 'AcessoNegado';
  }
}

export class DadoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DadoInvalido';
  }
}

/** Membros ativos da organização (base do #Geral e do seletor de "Nova conversa"). */
export async function membrosAtivos(organizationId: string) {
  return db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.users.active, true), isNull(schema.users.deletedAt)))
    .orderBy(asc(schema.users.name));
}

export async function ehMembroAtivo(organizationId: string, userId: string): Promise<boolean> {
  const [linha] = await db
    .select({ id: schema.users.id })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(
      eq(schema.organizationMembers.organizationId, organizationId),
      eq(schema.organizationMembers.userId, userId),
      eq(schema.users.active, true),
      isNull(schema.users.deletedAt),
    ))
    .limit(1);
  return Boolean(linha);
}

/** O #Geral da organização, criado na primeira vez que alguém precisa dele (idempotente). */
export async function garantirGeral(organizationId: string): Promise<Conversa> {
  await db.insert(schema.internalConversations).values({ organizationId, kind: 'general', title: 'Geral' }).onConflictDoNothing();
  const [geral] = await db.select().from(schema.internalConversations)
    .where(and(eq(schema.internalConversations.organizationId, organizationId), eq(schema.internalConversations.kind, 'general')))
    .limit(1);
  return geral!;
}

/**
 * A conversa, se ESTA pessoa pode vê-la nesta organização; senão AcessoNegado
 * (sempre "não encontrada" — não confirmar que um id existe também é proteção).
 */
export async function conversaAcessivel(organizationId: string, userId: string, conversationId: string): Promise<Conversa> {
  const [conversa] = await db.select().from(schema.internalConversations)
    .where(and(eq(schema.internalConversations.id, conversationId), eq(schema.internalConversations.organizationId, organizationId)))
    .limit(1);
  if (!conversa) throw new AcessoNegado();
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  if (conversa.kind === 'general') return conversa;
  const participantes = await db.select({ userId: schema.internalConversationMembers.userId })
    .from(schema.internalConversationMembers)
    .where(eq(schema.internalConversationMembers.conversationId, conversa.id));
  if (!participantes.some((p) => p.userId === userId)) throw new AcessoNegado();
  return conversa;
}

/** Quem recebe os eventos ao vivo de uma conversa. */
export async function destinatarios(conversa: Conversa): Promise<string[]> {
  if (conversa.kind === 'general') return (await membrosAtivos(conversa.organizationId)).map((m) => m.id);
  const participantes = await db.select({ userId: schema.internalConversationMembers.userId })
    .from(schema.internalConversationMembers)
    .where(eq(schema.internalConversationMembers.conversationId, conversa.id));
  return participantes.map((p) => p.userId);
}

/** Conversa privada com `outro`: devolve a existente ou cria (nunca duas para o mesmo par). */
export async function abrirPrivada(organizationId: string, userId: string, outroId: string): Promise<Conversa> {
  if (outroId === userId) throw new DadoInvalido('Não dá para abrir uma conversa com você mesmo.');
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  if (!(await ehMembroAtivo(organizationId, outroId))) throw new DadoInvalido('Essa pessoa não é um colaborador ativo desta organização.');
  const directKey = [userId, outroId].sort().join(':');
  return db.transaction(async (tx) => {
    await tx.insert(schema.internalConversations).values({ organizationId, kind: 'direct', directKey }).onConflictDoNothing();
    const [conversa] = await tx.select().from(schema.internalConversations)
      .where(and(
        eq(schema.internalConversations.organizationId, organizationId),
        eq(schema.internalConversations.kind, 'direct'),
        eq(schema.internalConversations.directKey, directKey),
      ))
      .limit(1);
    await tx.insert(schema.internalConversationMembers)
      .values([userId, outroId].map((id) => ({ conversationId: conversa!.id, userId: id, organizationId })))
      .onConflictDoNothing();
    return conversa!;
  });
}

async function membroDaConversa(conversa: Conversa, userId: string) {
  await db.insert(schema.internalConversationMembers)
    .values({ conversationId: conversa.id, userId, organizationId: conversa.organizationId })
    .onConflictDoNothing();
}

/**
 * Lista de conversas de uma pessoa: #Geral primeiro, depois as privadas pela
 * mensagem mais recente — com a outra pessoa, a última mensagem e as não lidas.
 */
export async function listarConversas(organizationId: string, userId: string) {
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  const geral = await garantirGeral(organizationId);
  await membroDaConversa(geral, userId);
  const linhas = await db.execute<{
    id: string; kind: string; title: string | null; last_message_at: Date | string | null; muted_at: Date | string | null;
    partner_id: string | null; partner_name: string | null; partner_avatar: string | null; partner_active: boolean | null;
    last_content: string | null; last_sender_id: string | null; last_deleted: boolean | null; last_has_attachment: boolean | null; unread: number;
  }>(sql`
    select c.id, c.kind, c.title, c.last_message_at, me.muted_at,
      p.id as partner_id, p.name as partner_name, p.avatar_url as partner_avatar, (p.active and p.deleted_at is null) as partner_active,
      lm.content as last_content, lm.sender_id as last_sender_id, (lm.deleted_at is not null) as last_deleted,
      exists (select 1 from internal_message_attachments a where a.message_id = lm.id) as last_has_attachment,
      (select count(*)::int from internal_messages m
        where m.conversation_id = c.id and m.deleted_at is null and m.sender_id <> ${userId}
          and (me.last_read_at is null or m.created_at > me.last_read_at)) as unread
    from internal_conversations c
    join internal_conversation_members me on me.conversation_id = c.id and me.user_id = ${userId}
    left join lateral (
      select u.* from internal_conversation_members o join users u on u.id = o.user_id
      where o.conversation_id = c.id and o.user_id <> ${userId} limit 1
    ) p on c.kind = 'direct'
    left join lateral (
      select m.* from internal_messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1
    ) lm on true
    where c.organization_id = ${organizationId}
    order by (c.kind = 'general') desc, c.last_message_at desc nulls last, c.created_at desc
  `);
  return linhas.filter((c) => c.kind === 'general' || c.partner_active);
}

export async function totalNaoLidas(organizationId: string, userId: string): Promise<number> {
  const conversas = await listarConversas(organizationId, userId);
  return conversas.filter((c) => !c.muted_at).reduce((total, c) => total + Number(c.unread), 0);
}

export interface MensagemCompleta {
  message: Mensagem;
  sender: { id: string; name: string; avatarUrl: string | null } | null;
  attachments: Anexo[];
  reactions: Array<{ emoji: string; userIds: string[] }>;
  replyTo: { id: string; senderName: string | null; content: string | null; deleted: boolean } | null;
}

async function completar(mensagens: Mensagem[]): Promise<MensagemCompleta[]> {
  if (mensagens.length === 0) return [];
  const ids = mensagens.map((m) => m.id);
  const replyIds = [...new Set(mensagens.map((m) => m.replyToId).filter((id): id is string => Boolean(id)))];
  const senderIds = [...new Set(mensagens.map((m) => m.senderId))];
  const [anexos, reacoes, remetentes, respostas] = await Promise.all([
    db.select().from(schema.internalMessageAttachments).where(inArray(schema.internalMessageAttachments.messageId, ids)).orderBy(asc(schema.internalMessageAttachments.createdAt)),
    db.select().from(schema.internalMessageReactions).where(inArray(schema.internalMessageReactions.messageId, ids)).orderBy(asc(schema.internalMessageReactions.createdAt)),
    db.select({ id: schema.users.id, name: schema.users.name, avatarUrl: schema.users.avatarUrl }).from(schema.users).where(inArray(schema.users.id, senderIds)),
    replyIds.length
      ? db.select({ id: schema.internalMessages.id, content: schema.internalMessages.content, deletedAt: schema.internalMessages.deletedAt, senderName: schema.users.name })
        .from(schema.internalMessages).leftJoin(schema.users, eq(schema.users.id, schema.internalMessages.senderId))
        .where(inArray(schema.internalMessages.id, replyIds))
      : Promise.resolve([]),
  ]);
  return mensagens.map((message) => {
    const porEmoji = new Map<string, string[]>();
    for (const r of reacoes.filter((x) => x.messageId === message.id)) porEmoji.set(r.emoji, [...(porEmoji.get(r.emoji) ?? []), r.userId]);
    const resposta = respostas.find((r) => r.id === message.replyToId);
    const apagada = Boolean(message.deletedAt);
    return {
      message: apagada ? { ...message, content: null } : message,
      sender: remetentes.find((s) => s.id === message.senderId) ?? null,
      attachments: apagada ? [] : anexos.filter((a) => a.messageId === message.id),
      reactions: [...porEmoji].map(([emoji, userIds]) => ({ emoji, userIds })),
      replyTo: resposta ? { id: resposta.id, senderName: resposta.senderName, content: resposta.deletedAt ? null : resposta.content?.slice(0, 200) ?? null, deleted: Boolean(resposta.deletedAt) } : null,
    };
  });
}

/**
 * Página de mensagens por cursor (created_at, id) — estável mesmo com
 * mensagens chegando no meio. `antes` = id da mensagem mais antiga já vista.
 */
export async function paginaDeMensagens(conversa: Conversa, opcoes: { antes?: string | undefined; depois?: string | undefined; limite: number }) {
  const condicoes = [eq(schema.internalMessages.conversationId, conversa.id)];
  // Cursor comparado DENTRO do banco, como par (created_at, id): passar a data
  // pelo Date do JS corta os microssegundos e a mensagem de referência voltava
  // na própria página (mesmo defeito do sync do WhatsApp, 19/10/2026).
  const ref = (id: string) => sql`(select m.created_at, m.id from internal_messages m where m.id = ${id} and m.conversation_id = ${conversa.id})`;
  if (opcoes.antes) condicoes.push(sql`(${schema.internalMessages.createdAt}, ${schema.internalMessages.id}) < ${ref(opcoes.antes)}`);
  if (opcoes.depois) {
    // Recuperação após reconexão: só o que chegou depois da última vista.
    condicoes.push(sql`(${schema.internalMessages.createdAt}, ${schema.internalMessages.id}) > ${ref(opcoes.depois)}`);
    const linhas = await db.select().from(schema.internalMessages).where(and(...condicoes))
      .orderBy(asc(schema.internalMessages.createdAt), asc(schema.internalMessages.id)).limit(opcoes.limite);
    return { messages: await completar(linhas), hasMore: linhas.length === opcoes.limite };
  }
  const linhas = await db.select().from(schema.internalMessages).where(and(...condicoes))
    .orderBy(desc(schema.internalMessages.createdAt), desc(schema.internalMessages.id)).limit(opcoes.limite + 1);
  const temMais = linhas.length > opcoes.limite;
  return { messages: await completar(linhas.slice(0, opcoes.limite).reverse()), hasMore: temMais };
}

function limparTexto(texto: string | undefined | null): string | null {
  if (!texto) return null;
  // Sem caracteres de controle (exceto quebra de linha e tab). A tela mostra
  // como texto puro (nunca HTML), então isto é higiene, não a defesa de XSS.
  const limpo = texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (limpo.length > LIMITE_DE_TEXTO) throw new DadoInvalido(`Mensagem acima de ${LIMITE_DE_TEXTO} caracteres.`);
  return limpo || null;
}

/**
 * Envio idempotente: o mesmo `clientMessageId` da mesma pessoa na mesma
 * conversa devolve a mensagem já gravada (`criada: false`), nunca uma segunda.
 */
export async function enviarMensagem(conversa: Conversa, remetenteId: string, input: {
  content?: string | null | undefined;
  clientMessageId: string;
  replyToId?: string | null | undefined;
  attachmentIds?: string[] | undefined;
  mentions?: string[] | undefined;
}): Promise<{ criada: boolean; mensagem: MensagemCompleta; mencionados: string[]; autorRespondido: string | null }> {
  const content = limparTexto(input.content);
  const attachmentIds = [...new Set(input.attachmentIds ?? [])].slice(0, 10);
  if (!content && attachmentIds.length === 0) throw new DadoInvalido('Mensagem vazia.');

  let autorRespondido: string | null = null;
  if (input.replyToId) {
    const [original] = await db.select({ senderId: schema.internalMessages.senderId }).from(schema.internalMessages)
      .where(and(eq(schema.internalMessages.id, input.replyToId), eq(schema.internalMessages.conversationId, conversa.id)));
    if (!original) throw new DadoInvalido('A mensagem respondida não é desta conversa.');
    autorRespondido = original.senderId;
  }
  // Menção só vale para quem pode ler a conversa — nunca notifica alguém de fora.
  const podemLer = new Set(await destinatarios(conversa));
  const mencionados = [...new Set(input.mentions ?? [])].filter((id) => podemLer.has(id) && id !== remetenteId).slice(0, 50);

  return db.transaction(async (tx) => {
    const [criada] = await tx.insert(schema.internalMessages).values({
      organizationId: conversa.organizationId,
      conversationId: conversa.id,
      senderId: remetenteId,
      content,
      replyToId: input.replyToId ?? null,
      mentions: mencionados,
      clientMessageId: input.clientMessageId,
    }).onConflictDoNothing().returning();
    if (!criada) {
      const [existente] = await tx.select().from(schema.internalMessages).where(and(
        eq(schema.internalMessages.conversationId, conversa.id),
        eq(schema.internalMessages.senderId, remetenteId),
        eq(schema.internalMessages.clientMessageId, input.clientMessageId),
      ));
      return { criada: false, mensagem: (await completar([existente!]))[0]!, mencionados: [], autorRespondido: null };
    }
    if (attachmentIds.length) {
      // Só anexo desta conversa, desta pessoa, ainda solto: id de anexo alheio não "rouba" arquivo.
      const presos = await tx.update(schema.internalMessageAttachments).set({ messageId: criada.id }).where(and(
        inArray(schema.internalMessageAttachments.id, attachmentIds),
        eq(schema.internalMessageAttachments.conversationId, conversa.id),
        eq(schema.internalMessageAttachments.uploaderId, remetenteId),
        isNull(schema.internalMessageAttachments.messageId),
      )).returning({ id: schema.internalMessageAttachments.id });
      if (presos.length !== attachmentIds.length) throw new DadoInvalido('Algum anexo não pertence a esta conversa ou já foi enviado.');
    }
    await tx.update(schema.internalConversations).set({ lastMessageAt: criada.createdAt }).where(eq(schema.internalConversations.id, conversa.id));
    // Quem envia leu até aqui.
    await tx.insert(schema.internalConversationMembers)
      .values({ conversationId: conversa.id, userId: remetenteId, organizationId: conversa.organizationId, lastReadAt: criada.createdAt })
      .onConflictDoUpdate({ target: [schema.internalConversationMembers.conversationId, schema.internalConversationMembers.userId], set: { lastReadAt: criada.createdAt } });
    return { criada: true, mensagem: null as unknown as MensagemCompleta, mencionados, autorRespondido, id: criada.id };
  }).then(async (r) => {
    if (!r.criada) return r;
    const [linha] = await db.select().from(schema.internalMessages).where(eq(schema.internalMessages.id, (r as { id: string }).id));
    return { criada: true, mensagem: (await completar([linha!]))[0]!, mencionados: r.mencionados, autorRespondido: r.autorRespondido };
  });
}

async function mensagemPropria(conversa: Conversa, userId: string, messageId: string): Promise<Mensagem> {
  const [mensagem] = await db.select().from(schema.internalMessages)
    .where(and(eq(schema.internalMessages.id, messageId), eq(schema.internalMessages.conversationId, conversa.id)));
  if (!mensagem || mensagem.deletedAt) throw new AcessoNegado('Mensagem não encontrada.');
  if (mensagem.senderId !== userId) throw new AcessoNegado('Só quem enviou pode alterar a mensagem.');
  return mensagem;
}

export async function editarMensagem(conversa: Conversa, userId: string, messageId: string, novoTexto: string) {
  const mensagem = await mensagemPropria(conversa, userId, messageId);
  const content = limparTexto(novoTexto);
  if (!content) throw new DadoInvalido('Texto vazio. Para tirar a mensagem, exclua.');
  const [editada] = await db.update(schema.internalMessages).set({ content, editedAt: new Date() }).where(eq(schema.internalMessages.id, mensagem.id)).returning();
  return (await completar([editada!]))[0]!;
}

export async function excluirMensagem(conversa: Conversa, userId: string, messageId: string) {
  const mensagem = await mensagemPropria(conversa, userId, messageId);
  const [apagada] = await db.update(schema.internalMessages).set({ deletedAt: new Date() }).where(eq(schema.internalMessages.id, mensagem.id)).returning();
  const anexos = await db.select({ storageKey: schema.internalMessageAttachments.storageKey }).from(schema.internalMessageAttachments)
    .where(eq(schema.internalMessageAttachments.messageId, mensagem.id));
  return { mensagem: (await completar([apagada!]))[0]!, storageKeys: anexos.map((a) => a.storageKey) };
}

export async function alternarReacao(conversa: Conversa, userId: string, messageId: string, emoji: string) {
  const [mensagem] = await db.select({ id: schema.internalMessages.id, deletedAt: schema.internalMessages.deletedAt }).from(schema.internalMessages)
    .where(and(eq(schema.internalMessages.id, messageId), eq(schema.internalMessages.conversationId, conversa.id)));
  if (!mensagem || mensagem.deletedAt) throw new AcessoNegado('Mensagem não encontrada.');
  const removidas = await db.delete(schema.internalMessageReactions).where(and(
    eq(schema.internalMessageReactions.messageId, messageId),
    eq(schema.internalMessageReactions.userId, userId),
    eq(schema.internalMessageReactions.emoji, emoji),
  )).returning();
  if (removidas.length === 0) await db.insert(schema.internalMessageReactions).values({ messageId, userId, emoji }).onConflictDoNothing();
  const [linha] = await db.select().from(schema.internalMessages).where(eq(schema.internalMessages.id, messageId));
  return (await completar([linha!]))[0]!;
}

export async function marcarComoLida(conversa: Conversa, userId: string): Promise<Date> {
  const agora = new Date();
  await db.insert(schema.internalConversationMembers)
    .values({ conversationId: conversa.id, userId, organizationId: conversa.organizationId, lastReadAt: agora })
    .onConflictDoUpdate({ target: [schema.internalConversationMembers.conversationId, schema.internalConversationMembers.userId], set: { lastReadAt: agora } });
  return agora;
}

export async function silenciar(conversa: Conversa, userId: string, silenciada: boolean) {
  await db.insert(schema.internalConversationMembers)
    .values({ conversationId: conversa.id, userId, organizationId: conversa.organizationId, mutedAt: silenciada ? new Date() : null })
    .onConflictDoUpdate({ target: [schema.internalConversationMembers.conversationId, schema.internalConversationMembers.userId], set: { mutedAt: silenciada ? new Date() : null } });
}

/** Estado de quem recebe: para não notificar quem está olhando a conversa nem quem silenciou. */
export async function estadoDosMembros(conversa: Conversa, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { lastReadAt: Date | null; mutedAt: Date | null }>();
  const linhas = await db.select({ userId: schema.internalConversationMembers.userId, lastReadAt: schema.internalConversationMembers.lastReadAt, mutedAt: schema.internalConversationMembers.mutedAt })
    .from(schema.internalConversationMembers)
    .where(and(eq(schema.internalConversationMembers.conversationId, conversa.id), inArray(schema.internalConversationMembers.userId, userIds)));
  return new Map(linhas.map((l) => [l.userId, { lastReadAt: l.lastReadAt, mutedAt: l.mutedAt }]));
}

/** Busca em todas as conversas que a pessoa pode ler (nunca nas privadas dos outros). */
export async function buscar(organizationId: string, userId: string, termo: string, limite = 30) {
  const q = termo.trim();
  if (q.length < 2) return [];
  const conversas = await listarConversas(organizationId, userId);
  const ids = conversas.map((c) => c.id);
  if (ids.length === 0) return [];
  const padrao = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const linhas = await db.select().from(schema.internalMessages).where(and(
    inArray(schema.internalMessages.conversationId, ids),
    isNull(schema.internalMessages.deletedAt),
    sql`${schema.internalMessages.content} ilike ${padrao}`,
  )).orderBy(desc(schema.internalMessages.createdAt)).limit(limite);
  return completar(linhas);
}

/** Arquivos compartilhados numa conversa, com quem enviou e a mensagem de origem. */
export async function arquivosDaConversa(conversa: Conversa, filtro: { kind?: string | undefined; q?: string | undefined; limite: number }) {
  const condicoes = [
    eq(schema.internalMessageAttachments.conversationId, conversa.id),
    sql`${schema.internalMessageAttachments.messageId} is not null`,
    isNull(schema.internalMessages.deletedAt),
  ];
  if (filtro.kind) condicoes.push(eq(schema.internalMessageAttachments.kind, filtro.kind));
  if (filtro.q) condicoes.push(sql`${schema.internalMessageAttachments.filename} ilike ${`%${filtro.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`);
  return db.select({ attachment: schema.internalMessageAttachments, senderName: schema.users.name, messageCreatedAt: schema.internalMessages.createdAt })
    .from(schema.internalMessageAttachments)
    .innerJoin(schema.internalMessages, eq(schema.internalMessages.id, schema.internalMessageAttachments.messageId))
    .leftJoin(schema.users, eq(schema.users.id, schema.internalMessageAttachments.uploaderId))
    .where(and(...condicoes))
    .orderBy(desc(schema.internalMessageAttachments.createdAt))
    .limit(filtro.limite);
}

/** Anexo + a conversa dele, conferindo que a pessoa pode ler essa conversa (download autorizado). */
export async function anexoAcessivel(organizationId: string, userId: string, attachmentId: string): Promise<Anexo> {
  const [anexo] = await db.select().from(schema.internalMessageAttachments)
    .where(and(eq(schema.internalMessageAttachments.id, attachmentId), eq(schema.internalMessageAttachments.organizationId, organizationId)));
  if (!anexo) throw new AcessoNegado('Arquivo não encontrado.');
  await conversaAcessivel(organizationId, userId, anexo.conversationId);
  // Anexo solto (ainda não enviado) só para quem subiu; mensagem apagada leva o arquivo junto.
  if (!anexo.messageId && anexo.uploaderId !== userId) throw new AcessoNegado('Arquivo não encontrado.');
  if (anexo.messageId) {
    const [mensagem] = await db.select({ deletedAt: schema.internalMessages.deletedAt }).from(schema.internalMessages).where(eq(schema.internalMessages.id, anexo.messageId));
    if (mensagem?.deletedAt) throw new AcessoNegado('Arquivo não encontrado.');
  }
  return anexo;
}

export async function espacoUsado(organizationId: string): Promise<number> {
  const [linha] = await db.select({ total: sql<string>`coalesce(sum(${schema.internalMessageAttachments.sizeBytes}), 0)` })
    .from(schema.internalMessageAttachments).where(eq(schema.internalMessageAttachments.organizationId, organizationId));
  return Number(linha?.total ?? 0);
}

export async function registrarAnexo(input: {
  conversa: Conversa; uploaderId: string; storageKey: string; filename: string; mimetype: string; kind: string; sizeBytes: number; width: number | null; height: number | null;
}) {
  const [anexo] = await db.insert(schema.internalMessageAttachments).values({
    organizationId: input.conversa.organizationId,
    conversationId: input.conversa.id,
    uploaderId: input.uploaderId,
    storageKey: input.storageKey,
    filename: input.filename,
    mimetype: input.mimetype,
    kind: input.kind,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
  }).returning();
  return anexo!;
}

/** Anexo solto há mais de um dia (subiu e nunca virou mensagem): para a faxina. */
export async function anexosOrfaos(antesDe: Date) {
  return db.select({ id: schema.internalMessageAttachments.id, storageKey: schema.internalMessageAttachments.storageKey })
    .from(schema.internalMessageAttachments)
    .where(and(isNull(schema.internalMessageAttachments.messageId), lt(schema.internalMessageAttachments.createdAt, antesDe)))
    .limit(500);
}

/**
 * Apaga os registros dos órfãos e devolve só as chaves que REALMENTE saíram.
 * A condição "ainda sem mensagem" vai no próprio DELETE: um anexo que virou
 * mensagem entre a listagem e a faxina fica, e o arquivo dele também.
 */
export async function apagarOrfaos(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const apagados = await db.delete(schema.internalMessageAttachments)
    .where(and(inArray(schema.internalMessageAttachments.id, ids), isNull(schema.internalMessageAttachments.messageId)))
    .returning({ storageKey: schema.internalMessageAttachments.storageKey });
  return apagados.map((a) => a.storageKey);
}

export { ne };
