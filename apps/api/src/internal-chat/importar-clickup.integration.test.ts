import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiDeChat, CanalCU, MensagemCU, MembroCU } from './importar-clickup';

/**
 * Chat do ClickUp → Comunicação contra PostgreSQL REAL e isolado. O ClickUp é simulado (canais, membros,
 * mensagens, respostas); o token "decifrado" é o próprio texto. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

vi.mock('../lib/token-crypto', () => ({ decryptToken: (s: string) => s, encryptToken: (s: string) => s }));

describe.skipIf(!enabled)('chat do ClickUp → Comunicação × PostgreSQL real', () => {
  const org = randomUUID();
  const [alicia, matheus, jamile] = [randomUUID(), randomUUID(), randomUUID()];
  let M: typeof import('./importar-clickup');
  let dbm: typeof import('@desigual-os/database');
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  const time = [
    { id: 1, email: `alicia-${org}@x.invalid`, username: 'Alicia' },
    { id: 2, email: `matheus-${org}@x.invalid`, username: 'Matheus' },
    { id: 3, email: `gui-${org}@x.invalid`, username: 'Gui' }, // sem conta na plataforma
    { id: 4, email: `jamile-${org}@x.invalid`, username: 'Jamile' },
  ].map((m) => ({ ...m, profilePicture: null, initials: null, color: null }));
  const ck = {
    canais: [] as CanalCU[],
    membros: new Map<string, MembroCU[]>(),
    mensagens: new Map<string, MensagemCU[]>(),
    respostas: new Map<string, MensagemCU[]>(),
    leitores: [] as string[],
  };
  const api: ApiDeChat = {
    canais: async (token) => { ck.leitores.push(token); return ck.canais; },
    membros: async (_t, _w, id) => ck.membros.get(id) ?? [],
    mensagens: async (_t, _w, id, desde) => (ck.mensagens.get(id) ?? []).filter((m) => Number(m.date) > desde).sort((a, b) => Number(b.date) - Number(a.date)),
    respostas: async (_t, _w, id) => ck.respostas.get(id) ?? [],
  };
  const rodar = () => M.importarChatDoClickUp(org, { api, membrosDoTime: time });
  const msg = (id: string, user: number, min: number, content: string, replies = 0): MensagemCU => ({ id, user_id: user, date: t0 + min * 60_000, content, replies_count: replies });

  async function mensagensDe(conversationId: string) {
    const { db, schema } = dbm;
    const { eq, asc } = await import('drizzle-orm');
    return db.select().from(schema.internalMessages).where(eq(schema.internalMessages.conversationId, conversationId)).orderBy(asc(schema.internalMessages.createdAt));
  }
  async function conversaDoCanal(canalId: string) {
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const [v] = await db.select().from(schema.workExternalMappings).where(and(eq(schema.workExternalMappings.organizationId, org), eq(schema.workExternalMappings.externalType, 'chat_channel'), eq(schema.workExternalMappings.externalId, canalId)));
    if (!v) return null;
    const [c] = await db.select().from(schema.internalConversations).where(eq(schema.internalConversations.id, v.entityId));
    return c!;
  }

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    M = await import('./importar-clickup');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: 'QA chat CU', slug: `qa-chatcu-${org}` });
    await db.insert(schema.users).values([
      { id: alicia, name: 'Alicia', email: `alicia-${org}@x.invalid` },
      { id: matheus, name: 'Matheus', email: `outro-${org}@x.invalid`, clickupEmail: `matheus-${org}@x.invalid` }, // casa pelo e-mail do ClickUp
      { id: jamile, name: 'Jamile', email: `jamile-${org}@x.invalid` },
    ]);
    await db.insert(schema.organizationMembers).values([alicia, matheus, jamile].map((userId) => ({ organizationId: org, userId, role: 'collaborator' })));
    await db.insert(schema.integrationConnections).values({ userId: alicia, provider: 'clickup', accessTokenEncrypted: 'token-alicia', externalWorkspaceId: 'WS', externalWorkspaceName: 'Agência', status: 'connected' });
    // Já existe um canal "Criação" na Comunicação: o histórico do ClickUp tem que entrar nele, não criar outro.
    await db.insert(schema.internalConversations).values({ organizationId: org, kind: 'channel', title: 'Criação', visibility: 'public' });

    ck.canais = [
      { id: 'dm-am', type: 'DM' },
      { id: 'dm-ag', type: 'DM' },
      { id: 'ch-criacao', type: 'CHANNEL', name: 'criação', visibility: 'PUBLIC' },
    ];
    ck.membros.set('dm-am', [{ id: 1 }, { id: 2 }]);
    ck.membros.set('dm-ag', [{ id: 1 }, { id: 3 }]);
    ck.membros.set('ch-criacao', [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    ck.mensagens.set('dm-am', [msg('a1', 1, 1, 'oi Matheus'), msg('a2', 2, 2, 'oi Alicia', 2)]);
    ck.respostas.set('a2', [msg('a2r1', 1, 3, 'respondendo na thread'), msg('a2r2', 2, 4, 'fechado')]);
    ck.mensagens.set('dm-ag', [msg('g1', 3, 5, 'Alicia, a arte saiu?'), msg('g2', 1, 6, 'saiu sim')]);
    ck.mensagens.set('ch-criacao', [msg('c1', 4, 7, 'pauta da semana'), msg('c2', 3, 8, 'vou subir os layouts')]);
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(inArray(schema.users.id, [alicia, matheus, jamile]));
  });

  it('conversa direta entre duas pessoas com conta vira conversa privada, com thread e autoria certas', async () => {
    const r = await rodar();
    expect(r.falhas).toEqual([]);
    expect(ck.leitores).toEqual(['token-alicia']);
    const dm = (await conversaDoCanal('dm-am'))!;
    expect(dm.kind).toBe('direct');
    expect(dm.directKey).toBe([alicia, matheus].sort().join(':'));
    const ms = await mensagensDe(dm.id);
    expect(ms.filter((m) => !m.threadRootId).map((m) => [m.senderId, m.content, m.kind])).toEqual([[alicia, 'oi Matheus', 'clickup'], [matheus, 'oi Alicia', 'clickup']]);
    const raiz = ms.find((m) => m.content === 'oi Alicia')!;
    expect(raiz.replyCount).toBe(2);
    expect(ms.filter((m) => m.threadRootId === raiz.id).map((m) => m.content)).toEqual(['respondendo na thread', 'fechado']);
    expect(ms.find((m) => m.content === 'oi Matheus')!.createdAt.toISOString()).toBe(new Date(t0 + 60_000).toISOString());
  });

  it('conversa com quem não tem conta (Gui) vira grupo com o nome dele, e a fala dele vem identificada', async () => {
    const g = (await conversaDoCanal('dm-ag'))!;
    expect(g.kind).toBe('group');
    expect(g.title).toBe('Gui · ClickUp');
    const ms = await mensagensDe(g.id);
    expect(ms[0]).toMatchObject({ kind: 'clickup_externo', content: '**Gui**: Alicia, a arte saiu?' });
    expect(ms[1]).toMatchObject({ kind: 'clickup', senderId: alicia });
  });

  it('canal com o mesmo nome de um que já existe recebe o histórico nele, e todos os membros com conta entram', async () => {
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const canais = await db.select().from(schema.internalConversations).where(and(eq(schema.internalConversations.organizationId, org), eq(schema.internalConversations.kind, 'channel')));
    expect(canais).toHaveLength(1);
    const c = (await conversaDoCanal('ch-criacao'))!;
    expect(c.id).toBe(canais[0]!.id);
    const membros = await db.select().from(schema.internalConversationMembers).where(eq(schema.internalConversationMembers.conversationId, c.id));
    expect(membros.map((m) => m.userId).sort()).toEqual([alicia, matheus, jamile].sort());
  });

  it('privacidade: a conversa direta Alicia↔Matheus só tem os dois como membros (a Jamile não vê)', async () => {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const dm = (await conversaDoCanal('dm-am'))!;
    const membros = await db.select().from(schema.internalConversationMembers).where(eq(schema.internalConversationMembers.conversationId, dm.id));
    expect(membros.map((m) => m.userId).sort()).toEqual([alicia, matheus].sort());
  });

  it('histórico entra como lido e não gera notificação', async () => {
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    const dm = (await conversaDoCanal('dm-am'))!;
    const membros = await db.select().from(schema.internalConversationMembers).where(eq(schema.internalConversationMembers.conversationId, dm.id));
    expect(membros.every((m) => m.lastReadAt !== null)).toBe(true);
    expect(await db.select().from(schema.notifications).where(inArray(schema.notifications.userId, [alicia, matheus, jamile]))).toEqual([]);
  });

  it('token de outro workspace do ClickUp não é usado', async () => {
    ck.leitores.length = 0;
    const r = await M.importarChatDoClickUp(org, { api, membrosDoTime: time, workspace: 'OUTRO-WS' });
    expect(r.tokens).toBe(0);
    expect(ck.leitores).toEqual([]);
  });

  it('importado numa empresa que não é dona do workspace é desfeito; o escrito lá continua', async () => {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const outra = randomUUID();
    await db.insert(schema.organizations).values({ id: outra, name: 'QA outra', slug: `qa-outra-${outra}` });
    await db.insert(schema.organizationMembers).values({ organizationId: outra, userId: alicia, role: 'collaborator' });
    try {
      const r = await M.importarChatDoClickUp(outra, { api, membrosDoTime: time });
      expect(r.conversasCriadas).toBeGreaterThan(0);
      const naOutra = await db.select().from(schema.internalConversations).where(eq(schema.internalConversations.organizationId, outra));
      // Uma conversa da outra empresa ganha uma mensagem escrita lá: essa tem que sobreviver.
      const alvo = naOutra.find((c) => c.kind === 'group')!;
      await db.insert(schema.internalMessages).values({ organizationId: outra, conversationId: alvo.id, senderId: alicia, content: 'escrita aqui', clientMessageId: randomUUID() });

      await M.desfazerImportacaoFora([org]);
      const restam = await db.select().from(schema.internalConversations).where(eq(schema.internalConversations.organizationId, outra));
      expect(restam.map((c) => c.id)).toEqual([alvo.id]);
      expect((await mensagensDe(alvo.id)).map((m) => m.content)).toEqual(['escrita aqui']);
      // A empresa dona não foi tocada.
      expect(await conversaDoCanal('dm-am')).not.toBeNull();
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, outra));
    }
  });

  it('segunda passada traz só o novo e não duplica nada', async () => {
    const dm = (await conversaDoCanal('dm-am'))!;
    const antes = (await mensagensDe(dm.id)).length;
    ck.mensagens.get('dm-am')!.push(msg('a3', 2, 30, 'mensagem nova no ClickUp'));
    const r = await rodar();
    expect(r.mensagens).toBe(1);
    expect((await mensagensDe(dm.id)).length).toBe(antes + 1);
    const r2 = await rodar();
    expect(r2.mensagens + r2.respostas).toBe(0);
  });

  it('pessoa só do ClickUp (sem login) já cadastrada: a conversa nova é direta com ela, com autoria dela', async () => {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const { DOMINIO_DE_PESSOA_DO_CLICKUP } = await import('@desigual-os/auth');
    const gui = randomUUID();
    await db.insert(schema.users).values({ id: gui, name: 'Gui', email: `${gui}@${DOMINIO_DE_PESSOA_DO_CLICKUP}`, clickupEmail: `gui-${org}@x.invalid`, active: false });
    await db.insert(schema.organizationMembers).values({ organizationId: org, userId: gui, role: 'collaborator' });
    try {
      ck.canais.push({ id: 'dm-ag-novo', type: 'DM' });
      ck.membros.set('dm-ag-novo', [{ id: 1 }, { id: 3 }]);
      ck.mensagens.set('dm-ag-novo', [msg('n1', 3, 40, 'manda o briefing?')]);
      const r = await rodar();
      expect(r.falhas).toEqual([]);
      const c = (await conversaDoCanal('dm-ag-novo'))!;
      expect(c.kind).toBe('direct');
      const membros = await db.select().from(schema.internalConversationMembers).where(eq(schema.internalConversationMembers.conversationId, c.id));
      expect(membros.map((m) => m.userId).sort()).toEqual([alicia, gui].sort());
      expect((await mensagensDe(c.id)).find((m) => m.content === 'manda o briefing?')).toMatchObject({ kind: 'clickup', senderId: gui });
      // O que entrou antes de o Gui existir aqui é acertado: o grupo "Gui · ClickUp" virou a conversa direta com ele,
      // e a fala dele (guardada como "**Gui**: ...") passou a ser dele — na conversa e no canal.
      const antiga = (await conversaDoCanal('dm-ag'))!;
      expect(antiga).toMatchObject({ kind: 'direct', title: null });
      expect((await mensagensDe(antiga.id)).find((m) => m.content === 'Alicia, a arte saiu?')).toMatchObject({ kind: 'clickup', senderId: gui });
      const canal = (await conversaDoCanal('ch-criacao'))!;
      expect((await mensagensDe(canal.id)).find((m) => m.content === 'vou subir os layouts')).toMatchObject({ kind: 'clickup', senderId: gui });
      // Na lista da Alicia, a conversa com quem não tem login aparece (antes sumia por "parceiro inativo").
      const { listarConversas } = await import('./service');
      const lista = await listarConversas(org, alicia);
      expect(lista.find((l) => l.id === antiga.id)).toMatchObject({ partner_id: gui, partner_active: true });
      // Segunda passada: nada a acertar, nada muda.
      expect((await rodar()).falhas).toEqual([]);
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, gui));
    }
  });
});
