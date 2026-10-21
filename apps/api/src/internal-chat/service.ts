import { and, asc, desc, eq, getTableColumns, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * Comunicação interna — regras de acesso e dados. Toda função recebe a
 * organização e a pessoa já autenticadas pela rota; NADA aqui confia num id
 * vindo do cliente sem antes passar por `conversaAcessivel`.
 *
 * QUEM LÊ O QUÊ (uma regra só, a mesma em lista, busca, arquivos e anexos):
 *  - #Geral ('general') e canal público ('channel' + visibility 'public'):
 *    membro ATIVO da organização. Desativou, perdeu acesso na hora.
 *  - Canal privado, grupo ('group') e conversa individual ('direct'): só quem
 *    está em internal_conversation_members.
 *  - Discussão ('discussion'): quem pode ver o objeto da operação ao qual ela
 *    pertence (cliente, projeto/quinzena) DENTRO desta organização. Conferido
 *    a cada acesso; a participação só guarda leitura.
 *  Administrador NÃO tem acesso automático ao que é privado. Agente de IA
 *  também não: ele só vê o que a pessoa que pediu escolheu mandar.
 */

export type Conversa = typeof schema.internalConversations.$inferSelect;
type Mensagem = typeof schema.internalMessages.$inferSelect;
type Anexo = typeof schema.internalMessageAttachments.$inferSelect;
type ObjetoDaMensagem = typeof schema.internalMessageObjects.$inferSelect;

export const LIMITE_DE_TEXTO = 8000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEMBROS_POR_GRUPO = 50;

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

/** Sem permissão para uma AÇÃO numa conversa que a pessoa lê (vira 403). */
export class SemPermissao extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SemPermissao';
  }
}

// ---------------------------------------------------------------------------
// Fragmentos de SQL da regra de acesso (usados em várias consultas)
// ---------------------------------------------------------------------------

export function ativoSql(organizationId: string, userId: string): SQL {
  return sql`exists (select 1 from organization_members om join users u on u.id = om.user_id
    where om.organization_id = ${organizationId} and om.user_id = ${userId} and u.active and u.deleted_at is null)`;
}

/**
 * A conversa `c` (alias SQL) é legível por `userId`? Discussão entra só por
 * participação aqui — a regra do objeto é conferida em `conversaAcessivel`,
 * que tira a participação de quem perdeu acesso ao objeto.
 */
export function leituraSql(alias: string, organizationId: string, userId: string): SQL {
  const c = sql.raw(alias);
  return sql`(${c}.organization_id = ${organizationId} and ${ativoSql(organizationId, userId)} and (
    ${c}.kind = 'general'
    or (${c}.kind = 'channel' and ${c}.visibility = 'public')
    or exists (select 1 from internal_conversation_members cm where cm.conversation_id = ${c}.id and cm.user_id = ${userId})
  ))`;
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

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

/** Dos ids pedidos, os que são membros ativos desta organização. */
async function filtrarAtivos(organizationId: string, ids: string[]): Promise<string[]> {
  const validos = [...new Set(ids)].filter((id) => UUID.test(id));
  if (validos.length === 0) return [];
  const linhas = await db.select({ id: schema.users.id })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), inArray(schema.users.id, validos), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
  return linhas.map((l) => l.id);
}

// ---------------------------------------------------------------------------
// #Geral e acesso
// ---------------------------------------------------------------------------

/** O #Geral da organização, criado na primeira vez que alguém precisa dele (idempotente). */
export async function garantirGeral(organizationId: string): Promise<Conversa> {
  // Insere e lê no mesmo comando: o "union" pega a linha nova (se inseriu) ou a existente.
  const [geral] = await db.execute<Record<string, unknown>>(sql`
    with nova as (
      insert into internal_conversations (organization_id, kind, title) values (${organizationId}, 'general', 'Geral')
      on conflict do nothing returning id
    )
    select id from nova
    union all
    select id from internal_conversations where organization_id = ${organizationId} and kind = 'general'
    limit 1
  `);
  // Corrida no primeiro acesso: se outra pessoa inseriu ao mesmo tempo, este
  // comando esperou o insert dela mas lê com a foto tirada ANTES — e não vê a
  // linha. Uma leitura nova (foto nova) acha. Visto no teste de 3 acessos simultâneos.
  const [conversa] = await db.select().from(schema.internalConversations)
    .where(geral ? eq(schema.internalConversations.id, String(geral.id)) : and(eq(schema.internalConversations.organizationId, organizationId), eq(schema.internalConversations.kind, 'general')))
    .limit(1);
  return conversa!;
}

export interface ConversaComAcesso extends Conversa {
  /** Tem linha em internal_conversation_members (entrou/participa). */
  souMembro: boolean;
  /** 'owner' | 'member' | null (não é membro). */
  meuPapel: string | null;
}

/**
 * Acesso a uma discussão: o objeto existe NESTA organização e a pessoa pode
 * vê-lo. Cliente e quinzena (demands) são da organização inteira para quem é
 * membro ativo dela — a mesma regra de hasClientAccess, mas presa à empresa de
 * trabalho (hasClientAccess sozinho aceita cliente de qualquer empresa em que a
 * pessoa tenha vínculo).
 */
export async function podeVerEntidade(organizationId: string, userId: string, entityType: string | null, entityId: string | null): Promise<boolean> {
  if (!entityType || !entityId || !UUID.test(entityId)) return false;
  if (!(await ehMembroAtivo(organizationId, userId))) return false;
  if (entityType === 'client') {
    const [c] = await db.select({ id: schema.clients.id }).from(schema.clients)
      .where(and(eq(schema.clients.id, entityId), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt))).limit(1);
    return Boolean(c);
  }
  if (entityType === 'demand') {
    const [d] = await db.execute<{ id: string }>(sql`select d.id from demands d where d.id = ${entityId} and d.organization_id = ${organizationId} limit 1`);
    return Boolean(d);
  }
  return false;
}

/**
 * A conversa, se ESTA pessoa pode vê-la nesta organização; senão AcessoNegado
 * (sempre "não encontrada" — não confirmar que um id existe também é proteção).
 */
export async function conversaAcessivel(organizationId: string, userId: string, conversationId: string): Promise<ConversaComAcesso> {
  // Id malformado é "não encontrada", não erro de banco.
  if (!UUID.test(conversationId)) throw new AcessoNegado();
  // Uma ida ao banco só (cada ida custa ~250 ms daqui até o banco): a conversa
  // e as condições de acesso vêm juntas.
  const [linha] = await db.select({
    conversa: schema.internalConversations,
    ativo: sql<boolean>`${ativoSql(organizationId, userId)}`,
    papel: sql<string | null>`(select cm.role from internal_conversation_members cm
      where cm.conversation_id = ${schema.internalConversations.id} and cm.user_id = ${userId})`,
  }).from(schema.internalConversations)
    .where(and(eq(schema.internalConversations.id, conversationId), eq(schema.internalConversations.organizationId, organizationId)))
    .limit(1);
  if (!linha || !linha.ativo) throw new AcessoNegado();
  const c = linha.conversa;
  const souMembro = linha.papel !== null;
  const comAcesso = { ...c, souMembro, meuPapel: linha.papel };
  if (c.kind === 'general') return comAcesso;
  if (c.kind === 'channel' && c.visibility === 'public') return comAcesso;
  if (c.kind === 'discussion') {
    if (await podeVerEntidade(organizationId, userId, c.entityType, c.entityId)) return comAcesso;
    // Perdeu acesso ao objeto: a participação (que alimenta lista e busca) sai junto.
    if (souMembro) await db.delete(schema.internalConversationMembers).where(and(eq(schema.internalConversationMembers.conversationId, c.id), eq(schema.internalConversationMembers.userId, userId)));
    throw new AcessoNegado();
  }
  if (!souMembro) throw new AcessoNegado();
  return comAcesso;
}

/** Pode escrever: lê, a conversa não está arquivada. Canal público/discussão: entra ao escrever. */
export async function garantirEscrita(conversa: ConversaComAcesso, userId: string): Promise<void> {
  if (conversa.archivedAt) throw new SemPermissao('Este canal está arquivado: dá para ler, não para escrever.');
  if (!conversa.souMembro) {
    await db.insert(schema.internalConversationMembers)
      .values({ conversationId: conversa.id, userId, organizationId: conversa.organizationId })
      .onConflictDoNothing();
    conversa.souMembro = true;
    conversa.meuPapel = 'member';
  }
}

/** Quem recebe os eventos ao vivo de uma conversa. */
export async function destinatarios(conversa: Pick<Conversa, 'id' | 'kind' | 'organizationId'>): Promise<string[]> {
  if (conversa.kind === 'general') return (await membrosAtivos(conversa.organizationId)).map((m) => m.id);
  const participantes = await db.select({ userId: schema.internalConversationMembers.userId })
    .from(schema.internalConversationMembers)
    .where(eq(schema.internalConversationMembers.conversationId, conversa.id));
  return participantes.map((p) => p.userId);
}

// ---------------------------------------------------------------------------
// Criar e administrar conversas
// ---------------------------------------------------------------------------

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

function nomeDeCanal(bruto: string): string {
  const nome = bruto.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLocaleLowerCase('pt-BR');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(nome)) throw new DadoInvalido('Nome de canal: letras, números, "-" e "_", até 80 caracteres.');
  if (nome === 'geral') throw new DadoInvalido('O #geral já existe e é de todos.');
  return nome;
}

export async function mensagemDeSistema(conversa: Pick<Conversa, 'id' | 'organizationId'>, autorId: string, texto: string) {
  const [m] = await db.insert(schema.internalMessages).values({
    organizationId: conversa.organizationId,
    conversationId: conversa.id,
    senderId: autorId,
    content: texto,
    kind: 'system',
    clientMessageId: `sistema-${crypto.randomUUID()}`,
  }).returning();
  await db.update(schema.internalConversations).set({ lastMessageAt: m!.createdAt }).where(eq(schema.internalConversations.id, conversa.id));
  return m!;
}

export async function criarCanal(organizationId: string, userId: string, input: { name: string; description?: string | null | undefined; visibility: 'public' | 'private'; memberIds?: string[] | undefined }) {
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  const title = nomeDeCanal(input.name);
  const outros = (await filtrarAtivos(organizationId, input.memberIds ?? [])).filter((id) => id !== userId).slice(0, 200);
  try {
    const [canal] = await db.insert(schema.internalConversations).values({
      organizationId, kind: 'channel', title, description: input.description?.trim().slice(0, 500) || null, visibility: input.visibility, createdBy: userId,
    }).returning();
    await db.insert(schema.internalConversationMembers).values([
      { conversationId: canal!.id, userId, organizationId, role: 'owner' },
      ...outros.map((id) => ({ conversationId: canal!.id, userId: id, organizationId, role: 'member' })),
    ]).onConflictDoNothing();
    await mensagemDeSistema(canal!, userId, `criou o canal #${title}`);
    return { canal: canal!, adicionados: outros };
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505') throw new DadoInvalido(`Já existe um canal #${title}.`);
    throw erro;
  }
}

export async function criarGrupo(organizationId: string, userId: string, input: { title?: string | null | undefined; memberIds: string[] }) {
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  const outros = (await filtrarAtivos(organizationId, input.memberIds)).filter((id) => id !== userId);
  if (outros.length < 2) throw new DadoInvalido('Um grupo precisa de pelo menos duas outras pessoas (para uma só, use a conversa privada).');
  if (outros.length + 1 > MAX_MEMBROS_POR_GRUPO) throw new DadoInvalido(`Grupo com no máximo ${MAX_MEMBROS_POR_GRUPO} pessoas — para mais, crie um canal.`);
  const [grupo] = await db.insert(schema.internalConversations).values({
    organizationId, kind: 'group', title: input.title?.trim().slice(0, 80) || null, createdBy: userId,
  }).returning();
  await db.insert(schema.internalConversationMembers).values([
    { conversationId: grupo!.id, userId, organizationId, role: 'owner' },
    ...outros.map((id) => ({ conversationId: grupo!.id, userId: id, organizationId, role: 'member' })),
  ]);
  await mensagemDeSistema(grupo!, userId, 'criou o grupo');
  return { grupo: grupo!, adicionados: outros };
}

/** Discussão de um objeto da operação: a existente ou uma nova (uma por objeto). */
export async function abrirDiscussao(organizationId: string, userId: string, entityType: string, entityId: string, titulo: string) {
  if (!(await podeVerEntidade(organizationId, userId, entityType, entityId))) throw new AcessoNegado('Objeto não encontrado.');
  await db.insert(schema.internalConversations).values({
    organizationId, kind: 'discussion', title: titulo.slice(0, 120), entityType, entityId, visibility: 'org',
  }).onConflictDoNothing();
  const [conversa] = await db.select().from(schema.internalConversations).where(and(
    eq(schema.internalConversations.organizationId, organizationId),
    eq(schema.internalConversations.kind, 'discussion'),
    eq(schema.internalConversations.entityType, entityType),
    eq(schema.internalConversations.entityId, entityId),
  )).limit(1);
  await db.insert(schema.internalConversationMembers).values({ conversationId: conversa!.id, userId, organizationId }).onConflictDoNothing();
  return conversa!;
}

/** Sair da discussão: some da lista (volta ao abrir de novo pelo cliente/quinzena). */
export async function sairDaDiscussao(conversa: Pick<Conversa, 'id'>, userId: string) {
  await db.delete(schema.internalConversationMembers).where(and(eq(schema.internalConversationMembers.conversationId, conversa.id), eq(schema.internalConversationMembers.userId, userId)));
}

/** Quem administra: dono do canal/grupo; canal PÚBLICO também pelo master da organização. */
function podeAdministrar(conversa: ConversaComAcesso, ehMaster: boolean): boolean {
  if (conversa.meuPapel === 'owner') return true;
  return ehMaster && conversa.kind === 'channel' && conversa.visibility === 'public';
}

function exigirAdministravel(conversa: ConversaComAcesso) {
  if (conversa.kind !== 'channel' && conversa.kind !== 'group') throw new DadoInvalido('Só canais e grupos têm participantes editáveis.');
}

export async function adicionarMembros(conversa: ConversaComAcesso, actorId: string, ids: string[]) {
  exigirAdministravel(conversa);
  if (conversa.archivedAt) throw new SemPermissao('Canal arquivado.');
  // Qualquer participante convida (como num grupo de trabalho); canal público: qualquer leitor.
  if (!conversa.souMembro && !(conversa.kind === 'channel' && conversa.visibility === 'public')) throw new AcessoNegado();
  const novos = (await filtrarAtivos(conversa.organizationId, ids)).filter((id) => id !== actorId);
  if (novos.length === 0) return [];
  if (conversa.kind === 'group') {
    const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.internalConversationMembers).where(eq(schema.internalConversationMembers.conversationId, conversa.id));
    if (total + novos.length > MAX_MEMBROS_POR_GRUPO) throw new DadoInvalido(`Grupo com no máximo ${MAX_MEMBROS_POR_GRUPO} pessoas.`);
  }
  const inseridos = await db.insert(schema.internalConversationMembers)
    .values(novos.map((id) => ({ conversationId: conversa.id, userId: id, organizationId: conversa.organizationId })))
    .onConflictDoNothing().returning({ userId: schema.internalConversationMembers.userId });
  return inseridos.map((i) => i.userId);
}

export async function removerMembro(conversa: ConversaComAcesso, actorId: string, alvoId: string, ehMaster: boolean) {
  exigirAdministravel(conversa);
  if (alvoId !== actorId && !podeAdministrar(conversa, ehMaster)) throw new SemPermissao('Só quem administra o canal remove outras pessoas.');
  await db.delete(schema.internalConversationMembers).where(and(eq(schema.internalConversationMembers.conversationId, conversa.id), eq(schema.internalConversationMembers.userId, alvoId)));
  // Saiu o último dono: o participante mais antigo assume, para o canal não ficar sem ninguém que administre.
  const [dono] = await db.select({ userId: schema.internalConversationMembers.userId }).from(schema.internalConversationMembers)
    .where(and(eq(schema.internalConversationMembers.conversationId, conversa.id), eq(schema.internalConversationMembers.role, 'owner'))).limit(1);
  if (!dono) {
    const [proximo] = await db.select({ userId: schema.internalConversationMembers.userId }).from(schema.internalConversationMembers)
      .where(eq(schema.internalConversationMembers.conversationId, conversa.id)).orderBy(asc(schema.internalConversationMembers.joinedAt)).limit(1);
    if (proximo) await db.update(schema.internalConversationMembers).set({ role: 'owner' }).where(and(eq(schema.internalConversationMembers.conversationId, conversa.id), eq(schema.internalConversationMembers.userId, proximo.userId)));
  }
}

export async function editarConversa(conversa: ConversaComAcesso, ehMaster: boolean, input: { name?: string | undefined; description?: string | null | undefined; title?: string | null | undefined }) {
  exigirAdministravel(conversa);
  if (conversa.kind === 'channel' && !podeAdministrar(conversa, ehMaster)) throw new SemPermissao('Só quem administra o canal muda nome e descrição.');
  if (conversa.kind === 'group' && !conversa.souMembro) throw new AcessoNegado();
  const set: Partial<Conversa> = { updatedAt: new Date() };
  if (conversa.kind === 'channel' && input.name !== undefined) set.title = nomeDeCanal(input.name);
  if (conversa.kind === 'group' && input.title !== undefined) set.title = input.title?.trim().slice(0, 80) || null;
  if (input.description !== undefined) set.description = input.description?.trim().slice(0, 500) || null;
  try {
    const [nova] = await db.update(schema.internalConversations).set(set).where(eq(schema.internalConversations.id, conversa.id)).returning();
    return nova!;
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505') throw new DadoInvalido('Já existe um canal com esse nome.');
    throw erro;
  }
}

export async function arquivarCanal(conversa: ConversaComAcesso, ehMaster: boolean, arquivar: boolean) {
  if (conversa.kind !== 'channel') throw new DadoInvalido('Só canais são arquivados.');
  if (!podeAdministrar(conversa, ehMaster)) throw new SemPermissao('Só quem administra o canal arquiva.');
  try {
    const [nova] = await db.update(schema.internalConversations).set({ archivedAt: arquivar ? new Date() : null, updatedAt: new Date() }).where(eq(schema.internalConversations.id, conversa.id)).returning();
    return nova!;
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505') throw new DadoInvalido('Já existe outro canal ativo com esse nome; renomeie antes de reativar.');
    throw erro;
  }
}

/** Participantes com papel, leitura (indicador "visto") e presença resolvida na rota. */
export async function participantes(conversa: Pick<Conversa, 'id'>) {
  return db.select({
    id: schema.users.id, name: schema.users.name, avatarUrl: schema.users.avatarUrl,
    role: schema.internalConversationMembers.role, lastReadAt: schema.internalConversationMembers.lastReadAt, joinedAt: schema.internalConversationMembers.joinedAt,
  }).from(schema.internalConversationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.internalConversationMembers.userId))
    .where(and(eq(schema.internalConversationMembers.conversationId, conversa.id), eq(schema.users.active, true), isNull(schema.users.deletedAt)))
    .orderBy(asc(schema.users.name));
}

/** Canais públicos da organização para "procurar canais", com quem já entrou. */
export async function canaisPublicos(organizationId: string, userId: string) {
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  return db.execute<{ id: string; title: string; description: string | null; archived_at: string | null; member_count: number; joined: boolean; last_message_at: string | null }>(sql`
    select c.id, c.title, c.description, c.archived_at, c.last_message_at,
      (select count(*)::int from internal_conversation_members cm where cm.conversation_id = c.id) as member_count,
      exists (select 1 from internal_conversation_members cm where cm.conversation_id = c.id and cm.user_id = ${userId}) as joined
    from internal_conversations c
    where c.organization_id = ${organizationId} and c.kind = 'channel' and c.visibility = 'public'
    order by c.archived_at nulls first, c.last_message_at desc nulls last
  `);
}

// ---------------------------------------------------------------------------
// Lista de conversas
// ---------------------------------------------------------------------------

/**
 * Quem já teve o #Geral e a participação nele garantidos NESTE processo. Só
 * pula as escritas idempotentes da preparação; a checagem de vínculo ativo
 * continua em toda chamada, dentro da própria consulta da lista.
 */
const preparados = new Set<string>();

async function prepararGeral(organizationId: string, userId: string) {
  const chave = `${organizationId}:${userId}`;
  if (preparados.has(chave)) return;
  if (!(await ehMembroAtivo(organizationId, userId))) throw new AcessoNegado();
  const geral = await garantirGeral(organizationId);
  await db.insert(schema.internalConversationMembers).values({ conversationId: geral.id, userId, organizationId }).onConflictDoNothing();
  if (preparados.size > 50_000) preparados.clear();
  preparados.add(chave);
}

export type LinhaDaLista = {
  id: string; kind: string; title: string | null; description: string | null; visibility: string | null; archived_at: Date | string | null;
  entity_type: string | null; entity_id: string | null; last_message_at: Date | string | null; muted_at: Date | string | null; role: string;
  partner_id: string | null; partner_name: string | null; partner_avatar: string | null; partner_active: boolean | null;
  member_names: string[] | null; member_count: number;
  last_content: string | null; last_sender_id: string | null; last_sender_name: string | null; last_deleted: boolean | null; last_has_attachment: boolean | null; last_kind: string | null;
  unread: number; mentions_unread: number;
};

/**
 * Conversas de uma pessoa: as que ela participa (o #Geral, canais em que
 * entrou, privadas, grupos e discussões abertas), com a última mensagem da
 * linha principal e as não lidas. Resposta em thread e aviso de sistema não
 * contam como não lida.
 */
export async function listarConversas(organizationId: string, userId: string): Promise<LinhaDaLista[]> {
  await prepararGeral(organizationId, userId);
  const linhas = await db.execute<LinhaDaLista>(sql`
    select c.id, c.kind, c.title, c.description, c.visibility, c.archived_at, c.entity_type, c.entity_id, c.last_message_at, me.muted_at, me.role,
      p.id as partner_id, p.name as partner_name, p.avatar_url as partner_avatar, (p.active and p.deleted_at is null) as partner_active,
      case when c.kind = 'group' then (
        select array_agg(u.name order by u.name) from internal_conversation_members o join users u on u.id = o.user_id
        where o.conversation_id = c.id and o.user_id <> ${userId} and u.active
      ) end as member_names,
      (select count(*)::int from internal_conversation_members o where o.conversation_id = c.id) as member_count,
      lm.content as last_content, lm.sender_id as last_sender_id, ls.name as last_sender_name, (lm.deleted_at is not null) as last_deleted, lm.kind as last_kind,
      exists (select 1 from internal_message_attachments a where a.message_id = lm.id) as last_has_attachment,
      (select count(*)::int from internal_messages m
        where m.conversation_id = c.id and m.deleted_at is null and m.sender_id <> ${userId} and m.thread_root_id is null and m.kind = 'user'
          and (me.last_read_at is null or m.created_at > me.last_read_at)) as unread,
      (select count(*)::int from internal_messages m
        where m.conversation_id = c.id and m.deleted_at is null and m.sender_id <> ${userId} and m.mentions @> array[${userId}]::uuid[]
          and (me.last_read_at is null or m.created_at > me.last_read_at)) as mentions_unread
    from internal_conversations c
    join internal_conversation_members me on me.conversation_id = c.id and me.user_id = ${userId}
    left join lateral (
      select u.* from internal_conversation_members o join users u on u.id = o.user_id
      where o.conversation_id = c.id and o.user_id <> ${userId} limit 1
    ) p on c.kind = 'direct'
    left join lateral (
      select m.* from internal_messages m where m.conversation_id = c.id and m.thread_root_id is null order by m.created_at desc, m.id desc limit 1
    ) lm on true
    left join users ls on ls.id = lm.sender_id
    where c.organization_id = ${organizationId} and c.archived_at is null
      -- vínculo ativo conferido aqui, a cada chamada: desativou, a lista zera na hora
      and ${ativoSql(organizationId, userId)}
    order by (c.kind = 'general') desc, c.last_message_at desc nulls last, c.created_at desc
  `);
  return linhas.filter((c) => c.kind !== 'direct' || c.partner_active);
}

export async function totalNaoLidas(organizationId: string, userId: string): Promise<number> {
  const conversas = await listarConversas(organizationId, userId);
  // Silenciada não conta, a não ser pela menção (que sempre chega).
  return conversas.reduce((total, c) => total + (c.muted_at ? Number(c.mentions_unread) : Number(c.unread)), 0);
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export interface MensagemCompleta {
  message: Mensagem;
  sender: { id: string; name: string; avatarUrl: string | null } | null;
  attachments: Anexo[];
  reactions: Array<{ emoji: string; userIds: string[] }>;
  replyTo: { id: string; senderName: string | null; content: string | null; deleted: boolean } | null;
  objects: ObjetoDaMensagem[];
  threadParticipants: Array<{ id: string; name: string | null; avatarUrl: string | null }>;
  saved: boolean;
}

export async function completar(mensagens: Mensagem[], viewerId?: string): Promise<MensagemCompleta[]> {
  if (mensagens.length === 0) return [];
  const ids = mensagens.map((m) => m.id);
  const replyIds = [...new Set(mensagens.map((m) => m.replyToId).filter((id): id is string => Boolean(id)))];
  const senderIds = [...new Set(mensagens.map((m) => m.senderId))];
  const raizes = mensagens.filter((m) => m.replyCount > 0).map((m) => m.id);
  const [anexos, reacoes, remetentes, respostas, objetos, participantesDasThreads, salvas] = await Promise.all([
    db.select().from(schema.internalMessageAttachments).where(inArray(schema.internalMessageAttachments.messageId, ids)).orderBy(asc(schema.internalMessageAttachments.createdAt)),
    db.select().from(schema.internalMessageReactions).where(inArray(schema.internalMessageReactions.messageId, ids)).orderBy(asc(schema.internalMessageReactions.createdAt)),
    db.select({ id: schema.users.id, name: schema.users.name, avatarUrl: schema.users.avatarUrl }).from(schema.users).where(inArray(schema.users.id, senderIds)),
    replyIds.length
      ? db.select({ id: schema.internalMessages.id, content: schema.internalMessages.content, deletedAt: schema.internalMessages.deletedAt, senderName: schema.users.name })
        .from(schema.internalMessages).leftJoin(schema.users, eq(schema.users.id, schema.internalMessages.senderId))
        .where(inArray(schema.internalMessages.id, replyIds))
      : Promise.resolve([]),
    db.select().from(schema.internalMessageObjects).where(inArray(schema.internalMessageObjects.messageId, ids)).orderBy(asc(schema.internalMessageObjects.createdAt)),
    raizes.length
      ? db.execute<{ root: string; id: string; name: string | null; avatar_url: string | null }>(sql`
          select distinct on (m.thread_root_id, u.id) m.thread_root_id as root, u.id, u.name, u.avatar_url
          from internal_messages m join users u on u.id = m.sender_id
          where m.thread_root_id in ${sql`(${sql.join(raizes.map((r) => sql`${r}`), sql`, `)})`} and m.deleted_at is null`)
      : Promise.resolve([] as Array<{ root: string; id: string; name: string | null; avatar_url: string | null }>),
    viewerId
      ? db.select({ messageId: schema.internalSavedMessages.messageId }).from(schema.internalSavedMessages)
        .where(and(eq(schema.internalSavedMessages.userId, viewerId), inArray(schema.internalSavedMessages.messageId, ids)))
      : Promise.resolve([] as Array<{ messageId: string }>),
  ]);
  const salvasSet = new Set(salvas.map((s) => s.messageId));
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
      objects: apagada ? [] : objetos.filter((o) => o.messageId === message.id),
      threadParticipants: participantesDasThreads.filter((p) => p.root === message.id).slice(0, 5).map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatar_url })),
      saved: salvasSet.has(message.id),
    };
  });
}

/**
 * Página de mensagens por cursor (created_at, id) — estável mesmo com
 * mensagens chegando no meio. `antes` = id da mensagem mais antiga já vista.
 * Linha principal (`threadRootId` ausente) ou as respostas de UMA thread.
 */
export async function paginaDeMensagens(conversa: Pick<Conversa, 'id'>, opcoes: { antes?: string | undefined; depois?: string | undefined; limite: number; threadRootId?: string | undefined; viewerId?: string | undefined }) {
  const condicoes = [eq(schema.internalMessages.conversationId, conversa.id)];
  condicoes.push(opcoes.threadRootId ? eq(schema.internalMessages.threadRootId, opcoes.threadRootId) : isNull(schema.internalMessages.threadRootId));
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
    return { messages: await completar(linhas, opcoes.viewerId), hasMore: linhas.length === opcoes.limite };
  }
  const linhas = await db.select().from(schema.internalMessages).where(and(...condicoes))
    .orderBy(desc(schema.internalMessages.createdAt), desc(schema.internalMessages.id)).limit(opcoes.limite + 1);
  const temMais = linhas.length > opcoes.limite;
  return { messages: await completar(linhas.slice(0, opcoes.limite).reverse(), opcoes.viewerId), hasMore: temMais };
}

/** Uma mensagem da conversa (para thread, objeto, ação). */
export async function mensagemDaConversa(conversa: Pick<Conversa, 'id'>, messageId: string): Promise<Mensagem> {
  if (!UUID.test(messageId)) throw new AcessoNegado('Mensagem não encontrada.');
  const [m] = await db.select().from(schema.internalMessages).where(and(eq(schema.internalMessages.id, messageId), eq(schema.internalMessages.conversationId, conversa.id))).limit(1);
  if (!m) throw new AcessoNegado('Mensagem não encontrada.');
  return m;
}

function limparTexto(texto: string | undefined | null): string | null {
  if (!texto) return null;
  // Sem caracteres de controle (exceto quebra de linha e tab). A tela mostra
  // como texto puro (nunca HTML), então isto é higiene, não a defesa de XSS.
  const limpo = texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (limpo.length > LIMITE_DE_TEXTO) throw new DadoInvalido(`Mensagem acima de ${LIMITE_DE_TEXTO} caracteres.`);
  return limpo || null;
}

export interface ObjetoParaGravar {
  objectType: string;
  objectId: string;
  provider: string | null;
  context: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  snapshotVersion: number;
}

/**
 * Envio idempotente: o mesmo `clientMessageId` da mesma pessoa na mesma
 * conversa devolve a mensagem já gravada (`criada: false`), nunca uma segunda.
 * `objetos` chegam JÁ VALIDADOS (permissão conferida pelo resolvedor do tipo).
 */
export async function enviarMensagem(conversa: Conversa, remetenteId: string, input: {
  content?: string | null | undefined;
  clientMessageId: string;
  replyToId?: string | null | undefined;
  threadRootId?: string | null | undefined;
  attachmentIds?: string[] | undefined;
  mentions?: string[] | undefined;
}, objetos: ObjetoParaGravar[] = []): Promise<{ criada: boolean; mensagem: MensagemCompleta; mencionados: string[]; autorRespondido: string | null; raiz: Mensagem | null; participantesDaThread: string[] }> {
  const content = limparTexto(input.content);
  const attachmentIds = [...new Set(input.attachmentIds ?? [])].slice(0, 10);
  if (!content && attachmentIds.length === 0 && objetos.length === 0) throw new DadoInvalido('Mensagem vazia.');

  let autorRespondido: string | null = null;
  if (input.replyToId) {
    const [original] = await db.select({ senderId: schema.internalMessages.senderId }).from(schema.internalMessages)
      .where(and(eq(schema.internalMessages.id, input.replyToId), eq(schema.internalMessages.conversationId, conversa.id)));
    if (!original) throw new DadoInvalido('A mensagem respondida não é desta conversa.');
    autorRespondido = original.senderId;
  }
  let raiz: Mensagem | null = null;
  if (input.threadRootId) {
    const [r] = await db.select().from(schema.internalMessages)
      .where(and(eq(schema.internalMessages.id, input.threadRootId), eq(schema.internalMessages.conversationId, conversa.id)));
    // Thread de thread não existe: a resposta vai para a thread da mensagem original.
    if (!r || r.deletedAt) throw new DadoInvalido('A mensagem da thread não existe mais nesta conversa.');
    raiz = r.threadRootId ? null : r;
    if (!raiz) throw new DadoInvalido('Responda na thread da mensagem original.');
  }
  // Menção só vale para quem pode ler a conversa — nunca notifica alguém de fora.
  const podemLer = new Set(conversa.kind === 'channel' && conversa.visibility === 'public'
    ? (await membrosAtivos(conversa.organizationId)).map((m) => m.id)
    : await destinatarios(conversa));
  const mencionados = [...new Set(input.mentions ?? [])].filter((id) => podemLer.has(id) && id !== remetenteId).slice(0, 50);

  const r = await db.transaction(async (tx) => {
    const [criada] = await tx.insert(schema.internalMessages).values({
      organizationId: conversa.organizationId,
      conversationId: conversa.id,
      senderId: remetenteId,
      content,
      replyToId: input.replyToId ?? null,
      threadRootId: raiz?.id ?? null,
      mentions: mencionados,
      clientMessageId: input.clientMessageId,
    }).onConflictDoNothing().returning();
    if (!criada) {
      const [existente] = await tx.select().from(schema.internalMessages).where(and(
        eq(schema.internalMessages.conversationId, conversa.id),
        eq(schema.internalMessages.senderId, remetenteId),
        eq(schema.internalMessages.clientMessageId, input.clientMessageId),
      ));
      return { criada: false as const, id: existente!.id };
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
    if (objetos.length) {
      await tx.insert(schema.internalMessageObjects).values(objetos.map((o) => ({
        organizationId: conversa.organizationId, messageId: criada.id, createdBy: remetenteId,
        objectType: o.objectType, objectId: o.objectId, provider: o.provider, context: o.context, snapshot: o.snapshot, snapshotVersion: o.snapshotVersion,
      })));
    }
    if (raiz) {
      await tx.update(schema.internalMessages).set({ replyCount: sql`${schema.internalMessages.replyCount} + 1`, lastReplyAt: criada.createdAt }).where(eq(schema.internalMessages.id, raiz.id));
    } else {
      await tx.update(schema.internalConversations).set({ lastMessageAt: criada.createdAt }).where(eq(schema.internalConversations.id, conversa.id));
    }
    // Quem envia leu até aqui (resposta de thread não mexe na leitura da linha principal).
    await tx.insert(schema.internalConversationMembers)
      .values({ conversationId: conversa.id, userId: remetenteId, organizationId: conversa.organizationId, lastReadAt: raiz ? null : criada.createdAt })
      .onConflictDoUpdate({ target: [schema.internalConversationMembers.conversationId, schema.internalConversationMembers.userId], set: raiz ? { conversationId: conversa.id } : { lastReadAt: criada.createdAt } });
    return { criada: true as const, id: criada.id };
  });

  const [linha] = await db.select().from(schema.internalMessages).where(eq(schema.internalMessages.id, r.id));
  const mensagem = (await completar([linha!], remetenteId))[0]!;
  if (!r.criada) return { criada: false, mensagem, mencionados: [], autorRespondido: null, raiz: null, participantesDaThread: [] };
  let participantesDaThread: string[] = [];
  if (raiz) {
    const quem = await db.selectDistinct({ id: schema.internalMessages.senderId }).from(schema.internalMessages)
      .where(and(eq(schema.internalMessages.threadRootId, raiz.id), isNull(schema.internalMessages.deletedAt)));
    participantesDaThread = [...new Set([raiz.senderId, ...quem.map((q) => q.id)])].filter((id) => id !== remetenteId);
  }
  return { criada: true, mensagem, mencionados, autorRespondido, raiz, participantesDaThread };
}

/** Linha que veio como JSON do Postgres (snake_case, datas em texto) → linha do Drizzle. */
function linhaDoJson<T extends Record<string, unknown>>(tabela: Parameters<typeof getTableColumns>[0], json: Record<string, unknown>): T {
  const saida: Record<string, unknown> = {};
  for (const [chave, coluna] of Object.entries(getTableColumns(tabela))) {
    const valor = json[coluna.name];
    saida[chave] = valor == null ? null : coluna.columnType === 'PgTimestamp' ? new Date(String(valor)) : valor;
  }
  return saida as T;
}

export interface EnvioRapido {
  conversa: Conversa;
  criada: true;
  mensagem: MensagemCompleta;
  mencionados: string[];
  autorRespondido: string | null;
  raiz: Mensagem | null;
}

/**
 * O ENVIO NUMA CONSULTA SÓ (Hub 2.1). Cada consulta com parâmetro custa ~250 ms
 * daqui até o banco; o envio fazia 15 a 28 (2,3 a 4,2 s, medido). Esta faz a
 * mesma coisa num comando: confere quem pode escrever (a MESMA regra de
 * `leituraSql`, mais "não arquivada"), filtra as menções para quem lê, grava a
 * mensagem e os itens compartilhados, move a conversa (ou a thread) e marca o
 * remetente como quem leu. Um comando só é atômico por definição.
 *
 * Devolve null quando NÃO gravou — sem acesso, arquivada, thread/resposta
 * inválida, `clientMessageId` repetido, discussão, ou com anexo. Aí quem chama
 * segue o caminho completo (`enviarMensagem`), que dá o erro certo ou devolve a
 * já gravada. Discussão fica de fora de propósito: o acesso a ela depende do
 * objeto (cliente/quinzena), que só `conversaAcessivel` confere.
 */
export async function enviarRapido(organizationId: string, conversationId: string, remetenteId: string, input: {
  content?: string | null | undefined;
  clientMessageId: string;
  replyToId?: string | null | undefined;
  threadRootId?: string | null | undefined;
  attachmentIds?: string[] | undefined;
  mentions?: string[] | undefined;
}, objetos: ObjetoParaGravar[] = []): Promise<EnvioRapido | null> {
  if (!UUID.test(conversationId)) return null;
  if (input.attachmentIds?.length) return null;
  if ((input.replyToId && !UUID.test(input.replyToId)) || (input.threadRootId && !UUID.test(input.threadRootId))) return null;
  const content = limparTexto(input.content);
  if (!content && objetos.length === 0) return null;
  const mencoes = [...new Set(input.mentions ?? [])].filter((id) => UUID.test(id) && id !== remetenteId).slice(0, 50);
  const raizId = input.threadRootId ?? null;
  const respostaId = input.replyToId ?? null;
  const lista = (ids: string[]) => ids.length ? sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]` : sql`array[]::uuid[]`;
  const objetosJson = JSON.stringify(objetos.map((o) => ({ object_type: o.objectType, object_id: o.objectId, provider: o.provider, context: o.context, snapshot: o.snapshot, snapshot_version: o.snapshotVersion })));

  const [linha] = await db.execute<{ conversa: Record<string, unknown>; nova: Record<string, unknown>; raiz: Record<string, unknown> | null; objetos: Array<Record<string, unknown>> | null; autor_respondido: string | null; resposta: { id: string; content: string | null; deleted: boolean; sender_name: string | null } | null; remetente: { id: string; name: string; avatar_url: string | null } }>(sql`
    with c as (
      select c.* from internal_conversations c
      where c.id = ${conversationId} and c.archived_at is null and c.kind <> 'discussion'
        and ${leituraSql('c', organizationId, remetenteId)}
    ),
    alvo_raiz as (
      select m.* from internal_messages m
      where m.id = ${raizId}::uuid and m.conversation_id = ${conversationId} and m.deleted_at is null and m.thread_root_id is null
    ),
    alvo_resposta as (
      select m.id, m.sender_id, m.content, (m.deleted_at is not null) as deleted, u.name as sender_name
      from internal_messages m left join users u on u.id = m.sender_id
      where m.id = ${respostaId}::uuid and m.conversation_id = ${conversationId}
    ),
    -- Menção só vale para quem pode ler a conversa: #Geral e canal público, qualquer membro ativo; o resto, participante.
    mencionados as (
      select coalesce(array_agg(x.id), array[]::uuid[]) as ids from unnest(${lista(mencoes)}) as x(id), c
      where (c.kind = 'general' or (c.kind = 'channel' and c.visibility = 'public'))
          and ${sql`exists (select 1 from organization_members om join users u on u.id = om.user_id where om.organization_id = ${organizationId} and om.user_id = x.id and u.active and u.deleted_at is null)`}
        or not (c.kind = 'general' or (c.kind = 'channel' and c.visibility = 'public'))
          and exists (select 1 from internal_conversation_members cm where cm.conversation_id = c.id and cm.user_id = x.id)
    ),
    nova as (
      insert into internal_messages (organization_id, conversation_id, sender_id, content, reply_to_id, thread_root_id, mentions, client_message_id)
      select c.organization_id, c.id, ${remetenteId}::uuid, ${content}::text, ${respostaId}::uuid, ${raizId}::uuid, (select ids from mencionados), ${input.clientMessageId}::text
      from c
      where (${raizId}::uuid is null or exists (select 1 from alvo_raiz))
        and (${respostaId}::uuid is null or exists (select 1 from alvo_resposta))
      on conflict do nothing
      returning *
    ),
    objs as (
      insert into internal_message_objects (organization_id, message_id, created_by, object_type, object_id, provider, context, snapshot, snapshot_version)
      select nova.organization_id, nova.id, ${remetenteId}::uuid, o.object_type, o.object_id, o.provider, coalesce(o.context, '{}'::jsonb), o.snapshot, o.snapshot_version
      from nova, jsonb_to_recordset(${objetosJson}::jsonb) as o(object_type text, object_id text, provider text, context jsonb, snapshot jsonb, snapshot_version int)
      returning *
    ),
    conv as (
      update internal_conversations set last_message_at = nova.created_at from nova
      where internal_conversations.id = nova.conversation_id and nova.thread_root_id is null
      returning 1
    ),
    raiz as (
      update internal_messages set reply_count = internal_messages.reply_count + 1, last_reply_at = nova.created_at from nova
      where internal_messages.id = nova.thread_root_id
      returning internal_messages.*
    ),
    -- Quem envia leu até aqui (resposta de thread não mexe na leitura da linha principal); canal público: entra ao escrever.
    membro as (
      insert into internal_conversation_members (conversation_id, user_id, organization_id, last_read_at)
      select nova.conversation_id, ${remetenteId}::uuid, nova.organization_id, case when nova.thread_root_id is null then nova.created_at end from nova
      on conflict (conversation_id, user_id) do update set last_read_at = coalesce(excluded.last_read_at, internal_conversation_members.last_read_at)
      returning 1
    )
    select row_to_json(c) as conversa, row_to_json(nova) as nova,
      (select row_to_json(raiz) from raiz) as raiz,
      (select json_agg(row_to_json(objs)) from objs) as objetos,
      (select sender_id from alvo_resposta) as autor_respondido,
      (select json_build_object('id', id, 'content', left(content, 200), 'deleted', deleted, 'sender_name', sender_name) from alvo_resposta) as resposta,
      (select json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url) from users u where u.id = ${remetenteId}::uuid) as remetente
    from c, nova
  `);
  if (!linha) return null;
  const mensagem = linhaDoJson<Mensagem>(schema.internalMessages, linha.nova);
  const raiz = linha.raiz ? linhaDoJson<Mensagem>(schema.internalMessages, linha.raiz) : null;
  const objs = (linha.objetos ?? []).map((o) => linhaDoJson<ObjetoDaMensagem>(schema.internalMessageObjects, o));
  return {
    conversa: linhaDoJson<Conversa>(schema.internalConversations, linha.conversa),
    criada: true,
    mencionados: mensagem.mentions ?? [],
    autorRespondido: linha.autor_respondido,
    raiz,
    mensagem: {
      message: mensagem,
      sender: { id: linha.remetente.id, name: linha.remetente.name, avatarUrl: linha.remetente.avatar_url },
      attachments: [],
      reactions: [],
      replyTo: linha.resposta ? { id: linha.resposta.id, senderName: linha.resposta.sender_name, content: linha.resposta.deleted ? null : linha.resposta.content, deleted: linha.resposta.deleted } : null,
      objects: objs,
      threadParticipants: [],
      saved: false,
    },
  };
}

/** Quem já participa de uma thread (para avisar da resposta nova), menos `exceto`. */
export async function participantesDaThread(raiz: Mensagem, exceto: string): Promise<string[]> {
  const quem = await db.selectDistinct({ id: schema.internalMessages.senderId }).from(schema.internalMessages)
    .where(and(eq(schema.internalMessages.threadRootId, raiz.id), isNull(schema.internalMessages.deletedAt)));
  return [...new Set([raiz.senderId, ...quem.map((q) => q.id)])].filter((id) => id !== exceto);
}

async function mensagemPropria(conversa: Pick<Conversa, 'id'>, userId: string, messageId: string): Promise<Mensagem> {
  const mensagem = await mensagemDaConversa(conversa, messageId);
  if (mensagem.deletedAt) throw new AcessoNegado('Mensagem não encontrada.');
  if (mensagem.senderId !== userId || mensagem.kind !== 'user') throw new AcessoNegado('Só quem enviou pode alterar a mensagem.');
  return mensagem;
}

export async function editarMensagem(conversa: Pick<Conversa, 'id'>, userId: string, messageId: string, novoTexto: string) {
  const mensagem = await mensagemPropria(conversa, userId, messageId);
  const content = limparTexto(novoTexto);
  if (!content) throw new DadoInvalido('Texto vazio. Para tirar a mensagem, exclua.');
  const [editada] = await db.update(schema.internalMessages).set({ content, editedAt: new Date() }).where(eq(schema.internalMessages.id, mensagem.id)).returning();
  return (await completar([editada!], userId))[0]!;
}

export async function excluirMensagem(conversa: Pick<Conversa, 'id'>, userId: string, messageId: string) {
  const mensagem = await mensagemPropria(conversa, userId, messageId);
  const [apagada] = await db.update(schema.internalMessages).set({ deletedAt: new Date(), pinnedAt: null, pinnedBy: null }).where(eq(schema.internalMessages.id, mensagem.id)).returning();
  if (mensagem.threadRootId) {
    await db.update(schema.internalMessages).set({ replyCount: sql`greatest(${schema.internalMessages.replyCount} - 1, 0)` }).where(eq(schema.internalMessages.id, mensagem.threadRootId));
  }
  const anexos = await db.select({ storageKey: schema.internalMessageAttachments.storageKey }).from(schema.internalMessageAttachments)
    .where(eq(schema.internalMessageAttachments.messageId, mensagem.id));
  return { mensagem: (await completar([apagada!], userId))[0]!, storageKeys: anexos.map((a) => a.storageKey) };
}

export async function alternarReacao(conversa: Pick<Conversa, 'id'>, userId: string, messageId: string, emoji: string) {
  const mensagem = await mensagemDaConversa(conversa, messageId);
  if (mensagem.deletedAt) throw new AcessoNegado('Mensagem não encontrada.');
  const removidas = await db.delete(schema.internalMessageReactions).where(and(
    eq(schema.internalMessageReactions.messageId, messageId),
    eq(schema.internalMessageReactions.userId, userId),
    eq(schema.internalMessageReactions.emoji, emoji),
  )).returning();
  if (removidas.length === 0) await db.insert(schema.internalMessageReactions).values({ messageId, userId, emoji }).onConflictDoNothing();
  const [linha] = await db.select().from(schema.internalMessages).where(eq(schema.internalMessages.id, messageId));
  return { mensagem: (await completar([linha!], userId))[0]!, adicionou: removidas.length === 0 };
}

export async function fixarMensagem(conversa: Pick<Conversa, 'id'>, userId: string, messageId: string, fixar: boolean) {
  const mensagem = await mensagemDaConversa(conversa, messageId);
  if (mensagem.deletedAt) throw new AcessoNegado('Mensagem não encontrada.');
  if (mensagem.threadRootId) throw new DadoInvalido('Fixe a mensagem original da thread.');
  if (fixar) {
    const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.internalMessages)
      .where(and(eq(schema.internalMessages.conversationId, conversa.id), sql`${schema.internalMessages.pinnedAt} is not null`));
    if (total >= 50) throw new DadoInvalido('Esta conversa já tem 50 mensagens fixadas.');
  }
  const [linha] = await db.update(schema.internalMessages).set(fixar ? { pinnedAt: new Date(), pinnedBy: userId } : { pinnedAt: null, pinnedBy: null }).where(eq(schema.internalMessages.id, messageId)).returning();
  return (await completar([linha!], userId))[0]!;
}

export async function fixadas(conversa: Pick<Conversa, 'id'>, viewerId: string) {
  const linhas = await db.select().from(schema.internalMessages)
    .where(and(eq(schema.internalMessages.conversationId, conversa.id), sql`${schema.internalMessages.pinnedAt} is not null`, isNull(schema.internalMessages.deletedAt)))
    .orderBy(desc(schema.internalMessages.pinnedAt)).limit(50);
  return completar(linhas, viewerId);
}

export async function salvarMensagem(conversa: Pick<Conversa, 'id' | 'organizationId'>, userId: string, messageId: string, salvar: boolean) {
  const mensagem = await mensagemDaConversa(conversa, messageId);
  if (salvar) {
    if (mensagem.deletedAt) throw new AcessoNegado('Mensagem não encontrada.');
    await db.insert(schema.internalSavedMessages).values({ userId, messageId, organizationId: conversa.organizationId }).onConflictDoNothing();
  } else {
    await db.delete(schema.internalSavedMessages).where(and(eq(schema.internalSavedMessages.userId, userId), eq(schema.internalSavedMessages.messageId, messageId)));
  }
}

/** Salvos da pessoa — só os que ela AINDA pode ler (perdeu acesso à conversa, some da lista). */
export async function listarSalvas(organizationId: string, userId: string, limite = 100) {
  await prepararGeral(organizationId, userId);
  const linhas = await db.execute<{ id: string }>(sql`
    select m.id from internal_saved_messages s
    join internal_messages m on m.id = s.message_id and m.deleted_at is null
    join internal_conversations c on c.id = m.conversation_id
    where s.user_id = ${userId} and s.organization_id = ${organizationId} and ${leituraSql('c', organizationId, userId)}
    order by s.created_at desc limit ${limite}`);
  return mensagensPorIds(linhas.map((l) => l.id), userId);
}

/** Onde a pessoa foi mencionada, nas conversas que ela pode ler. */
export async function listarMencoes(organizationId: string, userId: string, limite = 100) {
  await prepararGeral(organizationId, userId);
  const linhas = await db.execute<{ id: string }>(sql`
    select m.id from internal_messages m
    join internal_conversations c on c.id = m.conversation_id
    where m.organization_id = ${organizationId} and m.mentions @> array[${userId}]::uuid[] and m.deleted_at is null
      and ${leituraSql('c', organizationId, userId)}
    order by m.created_at desc limit ${limite}`);
  return mensagensPorIds(linhas.map((l) => l.id), userId);
}

async function mensagensPorIds(ids: string[], viewerId: string) {
  if (ids.length === 0) return [];
  const linhas = await db.select().from(schema.internalMessages).where(inArray(schema.internalMessages.id, ids));
  const ordem = new Map(ids.map((id, i) => [id, i]));
  return completar(linhas.sort((a, b) => ordem.get(a.id)! - ordem.get(b.id)!), viewerId);
}

/** Títulos das conversas para rotular resultados (busca, salvos, menções, arquivos). */
export async function rotulosDasConversas(organizationId: string, userId: string, ids: string[]) {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map<string, { kind: string; title: string }>();
  const linhas = await db.execute<{ id: string; kind: string; title: string | null; partner: string | null }>(sql`
    select c.id, c.kind, c.title,
      (select u.name from internal_conversation_members o join users u on u.id = o.user_id where o.conversation_id = c.id and o.user_id <> ${userId} limit 1) as partner
    from internal_conversations c where c.organization_id = ${organizationId} and c.id in ${sql`(${sql.join(unicos.map((i) => sql`${i}`), sql`, `)})`}`);
  return new Map(linhas.map((l) => [l.id, { kind: l.kind, title: l.kind === 'general' ? 'Geral' : l.kind === 'direct' ? (l.partner ?? 'Conversa privada') : (l.title ?? l.partner ?? 'Grupo') }]));
}

export async function marcarComoLida(conversa: Pick<Conversa, 'id' | 'organizationId'>, userId: string): Promise<Date> {
  const agora = new Date();
  await db.insert(schema.internalConversationMembers)
    .values({ conversationId: conversa.id, userId, organizationId: conversa.organizationId, lastReadAt: agora })
    .onConflictDoUpdate({ target: [schema.internalConversationMembers.conversationId, schema.internalConversationMembers.userId], set: { lastReadAt: agora } });
  return agora;
}

export async function silenciar(conversa: Pick<Conversa, 'id' | 'organizationId'>, userId: string, silenciada: boolean) {
  await db.insert(schema.internalConversationMembers)
    .values({ conversationId: conversa.id, userId, organizationId: conversa.organizationId, mutedAt: silenciada ? new Date() : null })
    .onConflictDoUpdate({ target: [schema.internalConversationMembers.conversationId, schema.internalConversationMembers.userId], set: { mutedAt: silenciada ? new Date() : null } });
}

/** Estado de quem recebe: para não notificar quem está olhando a conversa, quem silenciou ou está em "não perturbe". */
export async function estadoDosMembros(conversa: Pick<Conversa, 'id' | 'organizationId'>, userIds: string[]) {
  const vazio = new Map<string, { lastReadAt: Date | null; mutedAt: Date | null; dndUntil: Date | null; notifyReactions: boolean; notifyChannelMessages: boolean }>();
  if (userIds.length === 0) return vazio;
  const linhas = await db.execute<{ user_id: string; last_read_at: string | null; muted_at: string | null; dnd_until: string | null; notify_reactions: boolean | null; notify_channel_messages: boolean | null }>(sql`
    select u.id as user_id, cm.last_read_at, cm.muted_at, p.dnd_until, p.notify_reactions, p.notify_channel_messages
    from users u
    left join internal_conversation_members cm on cm.conversation_id = ${conversa.id} and cm.user_id = u.id
    left join internal_chat_preferences p on p.user_id = u.id and p.organization_id = ${conversa.organizationId}
    where u.id in ${sql`(${sql.join(userIds.map((i) => sql`${i}`), sql`, `)})`}`);
  for (const l of linhas) {
    vazio.set(l.user_id, {
      lastReadAt: l.last_read_at ? new Date(l.last_read_at) : null,
      mutedAt: l.muted_at ? new Date(l.muted_at) : null,
      dndUntil: l.dnd_until ? new Date(l.dnd_until) : null,
      notifyReactions: l.notify_reactions ?? true,
      notifyChannelMessages: l.notify_channel_messages ?? false,
    });
  }
  return vazio;
}

export async function preferencias(organizationId: string, userId: string) {
  const [p] = await db.select().from(schema.internalChatPreferences).where(and(eq(schema.internalChatPreferences.userId, userId), eq(schema.internalChatPreferences.organizationId, organizationId))).limit(1);
  return { dndUntil: p?.dndUntil ?? null, notifyReactions: p?.notifyReactions ?? true, notifyChannelMessages: p?.notifyChannelMessages ?? false };
}

export async function salvarPreferencias(organizationId: string, userId: string, input: { dndUntil?: Date | null | undefined; notifyReactions?: boolean | undefined; notifyChannelMessages?: boolean | undefined }) {
  const atual = await preferencias(organizationId, userId);
  const nova = {
    dndUntil: input.dndUntil === undefined ? atual.dndUntil : input.dndUntil,
    notifyReactions: input.notifyReactions ?? atual.notifyReactions,
    notifyChannelMessages: input.notifyChannelMessages ?? atual.notifyChannelMessages,
  };
  await db.insert(schema.internalChatPreferences).values({ userId, organizationId, ...nova, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.internalChatPreferences.userId, schema.internalChatPreferences.organizationId], set: { ...nova, updatedAt: new Date() } });
  return nova;
}

// ---------------------------------------------------------------------------
// Busca e arquivos
// ---------------------------------------------------------------------------

export interface FiltrosDeBusca {
  q?: string | undefined;
  senderId?: string | undefined;
  conversationId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  attachmentKind?: string | undefined;
  objectType?: string | undefined;
  before?: string | undefined;
  limite: number;
}

function escaparLike(q: string) {
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/**
 * Busca em todas as conversas que a pessoa pode ler (nunca nas privadas dos
 * outros): a regra de leitura vai DENTRO da consulta, não num filtro depois.
 */
export async function buscar(organizationId: string, userId: string, filtros: FiltrosDeBusca) {
  const q = filtros.q?.trim() ?? '';
  const temFiltro = Boolean(filtros.senderId || filtros.conversationId || filtros.from || filtros.to || filtros.attachmentKind || filtros.objectType);
  if (q.length < 2 && !temFiltro) return { results: [] as MensagemCompleta[], nextCursor: null as string | null };
  await prepararGeral(organizationId, userId);
  const partes: SQL[] = [
    sql`m.organization_id = ${organizationId}`,
    sql`m.deleted_at is null`,
    sql`m.kind = 'user'`,
    leituraSql('c', organizationId, userId),
  ];
  if (q.length >= 2) partes.push(sql`m.content ilike ${escaparLike(q)}`);
  if (filtros.senderId && UUID.test(filtros.senderId)) partes.push(sql`m.sender_id = ${filtros.senderId}`);
  if (filtros.conversationId && UUID.test(filtros.conversationId)) partes.push(sql`m.conversation_id = ${filtros.conversationId}`);
  if (filtros.from) partes.push(sql`m.created_at >= ${filtros.from.toISOString()}::timestamptz`);
  if (filtros.to) partes.push(sql`m.created_at < ${filtros.to.toISOString()}::timestamptz`);
  if (filtros.attachmentKind) partes.push(sql`exists (select 1 from internal_message_attachments a where a.message_id = m.id and a.kind = ${filtros.attachmentKind})`);
  if (filtros.objectType) partes.push(sql`exists (select 1 from internal_message_objects o where o.message_id = m.id and o.object_type = ${filtros.objectType})`);
  if (filtros.before && UUID.test(filtros.before)) partes.push(sql`(m.created_at, m.id) < (select x.created_at, x.id from internal_messages x where x.id = ${filtros.before})`);
  const linhas = await db.execute<{ id: string }>(sql`
    select m.id from internal_messages m join internal_conversations c on c.id = m.conversation_id
    where ${sql.join(partes, sql` and `)}
    order by m.created_at desc, m.id desc limit ${filtros.limite + 1}`);
  const ids = linhas.slice(0, filtros.limite).map((l) => l.id);
  return { results: await mensagensPorIds(ids, userId), nextCursor: linhas.length > filtros.limite ? ids[ids.length - 1]! : null };
}

/** Arquivos compartilhados numa conversa, com quem enviou e a mensagem de origem. */
export async function arquivosDaConversa(conversa: Pick<Conversa, 'id'>, filtro: { kind?: string | undefined; q?: string | undefined; limite: number }) {
  const condicoes = [
    eq(schema.internalMessageAttachments.conversationId, conversa.id),
    sql`${schema.internalMessageAttachments.messageId} is not null`,
    isNull(schema.internalMessages.deletedAt),
  ];
  if (filtro.kind) condicoes.push(eq(schema.internalMessageAttachments.kind, filtro.kind));
  if (filtro.q) condicoes.push(sql`${schema.internalMessageAttachments.filename} ilike ${escaparLike(filtro.q)}`);
  return db.select({ attachment: schema.internalMessageAttachments, senderName: schema.users.name, messageCreatedAt: schema.internalMessages.createdAt, threadRootId: schema.internalMessages.threadRootId })
    .from(schema.internalMessageAttachments)
    .innerJoin(schema.internalMessages, eq(schema.internalMessages.id, schema.internalMessageAttachments.messageId))
    .leftJoin(schema.users, eq(schema.users.id, schema.internalMessageAttachments.uploaderId))
    .where(and(...condicoes))
    .orderBy(desc(schema.internalMessageAttachments.createdAt))
    .limit(filtro.limite);
}

/** Biblioteca: arquivos de TODAS as conversas que a pessoa lê. */
export async function arquivosAcessiveis(organizationId: string, userId: string, filtro: { kind?: string | undefined; q?: string | undefined; senderId?: string | undefined; ordem: 'recentes' | 'nome' | 'tamanho'; limite: number; offset: number }) {
  await prepararGeral(organizationId, userId);
  const partes: SQL[] = [sql`a.organization_id = ${organizationId}`, sql`a.message_id is not null`, sql`m.deleted_at is null`, leituraSql('c', organizationId, userId)];
  if (filtro.kind) partes.push(sql`a.kind = ${filtro.kind}`);
  if (filtro.q) partes.push(sql`a.filename ilike ${escaparLike(filtro.q)}`);
  if (filtro.senderId && UUID.test(filtro.senderId)) partes.push(sql`a.uploader_id = ${filtro.senderId}`);
  const ordem = filtro.ordem === 'nome' ? sql`lower(a.filename) asc` : filtro.ordem === 'tamanho' ? sql`a.size_bytes desc` : sql`a.created_at desc`;
  const linhas = await db.execute<{ id: string; sender_name: string | null }>(sql`
    select a.id, u.name as sender_name from internal_message_attachments a
    join internal_messages m on m.id = a.message_id
    join internal_conversations c on c.id = a.conversation_id
    left join users u on u.id = a.uploader_id
    where ${sql.join(partes, sql` and `)}
    order by ${ordem}, a.id limit ${filtro.limite + 1} offset ${filtro.offset}`);
  const ids = linhas.slice(0, filtro.limite).map((l) => l.id);
  if (ids.length === 0) return { files: [], hasMore: false };
  const anexos = await db.select({ attachment: schema.internalMessageAttachments, threadRootId: schema.internalMessages.threadRootId })
    .from(schema.internalMessageAttachments)
    .innerJoin(schema.internalMessages, eq(schema.internalMessages.id, schema.internalMessageAttachments.messageId))
    .where(inArray(schema.internalMessageAttachments.id, ids));
  const porId = new Map(anexos.map((a) => [a.attachment.id, a]));
  const nomes = new Map(linhas.map((l) => [l.id, l.sender_name]));
  return { files: ids.map((id) => ({ ...porId.get(id)!, senderName: nomes.get(id) ?? null })), hasMore: linhas.length > filtro.limite };
}

/**
 * Anexo + a conversa dele, conferindo que a pessoa pode ler essa conversa
 * (download autorizado). Uma consulta só para os casos comuns: cada miniatura
 * de imagem passa por aqui.
 */
export async function anexoAcessivel(organizationId: string, userId: string, attachmentId: string): Promise<Anexo> {
  if (!UUID.test(attachmentId)) throw new AcessoNegado('Arquivo não encontrado.');
  const [linha] = await db.select({
    anexo: schema.internalMessageAttachments,
    conversa: schema.internalConversations,
    mensagemApagada: sql<boolean>`(${schema.internalMessages.deletedAt} is not null)`,
    ativo: sql<boolean>`${ativoSql(organizationId, userId)}`,
    participa: sql<boolean>`exists (select 1 from internal_conversation_members cm
      where cm.conversation_id = ${schema.internalMessageAttachments.conversationId} and cm.user_id = ${userId})`,
  }).from(schema.internalMessageAttachments)
    .innerJoin(schema.internalConversations, and(
      eq(schema.internalConversations.id, schema.internalMessageAttachments.conversationId),
      eq(schema.internalConversations.organizationId, organizationId),
    ))
    .leftJoin(schema.internalMessages, eq(schema.internalMessages.id, schema.internalMessageAttachments.messageId))
    .where(and(eq(schema.internalMessageAttachments.id, attachmentId), eq(schema.internalMessageAttachments.organizationId, organizationId)))
    .limit(1);
  if (!linha || !linha.ativo) throw new AcessoNegado('Arquivo não encontrado.');
  const c = linha.conversa;
  const aberto = c.kind === 'general' || (c.kind === 'channel' && c.visibility === 'public');
  if (c.kind === 'discussion') {
    if (!(await podeVerEntidade(organizationId, userId, c.entityType, c.entityId))) throw new AcessoNegado('Arquivo não encontrado.');
  } else if (!aberto && !linha.participa) {
    throw new AcessoNegado('Arquivo não encontrado.');
  }
  const anexo = linha.anexo;
  // Anexo solto (ainda não enviado) só para quem subiu; mensagem apagada leva o arquivo junto.
  if (!anexo.messageId && anexo.uploaderId !== userId) throw new AcessoNegado('Arquivo não encontrado.');
  if (anexo.messageId && linha.mensagemApagada) throw new AcessoNegado('Arquivo não encontrado.');
  return anexo;
}

export async function espacoUsado(organizationId: string): Promise<number> {
  const [linha] = await db.select({ total: sql<string>`coalesce(sum(${schema.internalMessageAttachments.sizeBytes}), 0)` })
    .from(schema.internalMessageAttachments).where(eq(schema.internalMessageAttachments.organizationId, organizationId));
  return Number(linha?.total ?? 0);
}

export async function registrarAnexo(input: {
  conversa: Pick<Conversa, 'id' | 'organizationId'>; uploaderId: string; storageKey: string; filename: string; mimetype: string; kind: string; sizeBytes: number; width: number | null; height: number | null;
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

/** Objeto compartilhado com a conversa de origem (para "ver atual" com a permissão de quem lê). */
export async function objetoDaMensagem(organizationId: string, objectId: string) {
  if (!UUID.test(objectId)) throw new AcessoNegado('Objeto não encontrado.');
  const [linha] = await db.select({ objeto: schema.internalMessageObjects, conversationId: schema.internalMessages.conversationId, deletedAt: schema.internalMessages.deletedAt })
    .from(schema.internalMessageObjects)
    .innerJoin(schema.internalMessages, eq(schema.internalMessages.id, schema.internalMessageObjects.messageId))
    .where(and(eq(schema.internalMessageObjects.id, objectId), eq(schema.internalMessageObjects.organizationId, organizationId))).limit(1);
  if (!linha || linha.deletedAt) throw new AcessoNegado('Objeto não encontrado.');
  return linha;
}

export { ne };
