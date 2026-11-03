import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiDeChat, CanalCU, MensagemCU, MembroCU } from './importar-clickup';
import type { ApiDeEscrita } from './espelho-clickup';

/**
 * Comunicação → chat do ClickUp (e a volta, sem duplicar) contra PostgreSQL REAL e isolado. O ClickUp é simulado
 * nos dois sentidos; o token "decifrado" é o próprio texto. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

vi.mock('../lib/token-crypto', () => ({ decryptToken: (s: string) => s, encryptToken: (s: string) => s }));

describe.skipIf(!enabled)('Comunicação → chat do ClickUp × PostgreSQL real', () => {
  const org = randomUUID();
  const [alicia, matheus, jamile] = [randomUUID(), randomUUID(), randomUUID()];
  let I: typeof import('./importar-clickup');
  let E: typeof import('./espelho-clickup');
  let svc: typeof import('./service');
  let dbm: typeof import('@desigual-os/database');
  const t0 = Date.parse('2026-11-01T12:00:00Z');
  const time = [
    { id: 1, email: `alicia-${org}@x.invalid`, username: 'Alicia' },
    { id: 2, email: `matheus-${org}@x.invalid`, username: 'Matheus' },
    { id: 4, email: `jamile-${org}@x.invalid`, username: 'Jamile' },
  ].map((m) => ({ ...m, profilePicture: null, initials: null, color: null }));

  // O "ClickUp": o que a importação lê e o que o espelho escreve caem no mesmo lugar, como no de verdade.
  const ck = {
    canais: [] as CanalCU[],
    membros: new Map<string, MembroCU[]>(),
    mensagens: new Map<string, MensagemCU[]>(),
    respostas: new Map<string, MensagemCU[]>(),
    escritas: [] as Array<{ acao: string; token: string; alvo: string; conteudo?: string }>,
    seq: 0,
    relogio: t0,
  };
  const novoId = () => `cu-${++ck.seq}`;
  const userIdDoToken = (token: string) => (token === 'token-alicia' ? 1 : token === 'token-matheus' ? 2 : 99);
  const leitura: ApiDeChat = {
    canais: async () => ck.canais,
    membros: async (_t, _w, id) => ck.membros.get(id) ?? [],
    // Como a API real: o que é mais novo que o marco e, sempre, a primeira página inteira (aqui, as 50 mais recentes).
    mensagens: async (_t, _w, id, desde) => [...(ck.mensagens.get(id) ?? [])].sort((a, b) => Number(b.date) - Number(a.date)).filter((m, i) => i < 50 || Number(m.date) > desde),
    respostas: async (_t, _w, id) => ck.respostas.get(id) ?? [],
  };
  const escrita: ApiDeEscrita = {
    async publicar(token, _w, canalId, conteudo) {
      const id = novoId();
      ck.escritas.push({ acao: 'publicar', token, alvo: canalId, conteudo });
      ck.mensagens.set(canalId, [...(ck.mensagens.get(canalId) ?? []), { id, user_id: userIdDoToken(token), date: (ck.relogio += 60_000), content: conteudo }]);
      return id;
    },
    async responder(token, _w, raizId, conteudo) {
      const id = novoId();
      ck.escritas.push({ acao: 'responder', token, alvo: raizId, conteudo });
      ck.respostas.set(raizId, [...(ck.respostas.get(raizId) ?? []), { id, user_id: userIdDoToken(token), date: (ck.relogio += 60_000), content: conteudo }]);
      for (const lista of ck.mensagens.values()) for (const m of lista) if (m.id === raizId) m.replies_count = (m.replies_count ?? 0) + 1;
      return id;
    },
    async editar(token, _w, id, conteudo) { ck.escritas.push({ acao: 'editar', token, alvo: id, conteudo }); },
    async apagar(token, _w, id) { ck.escritas.push({ acao: 'apagar', token, alvo: id }); },
    async conversaDireta(token, _w, userIds) {
      ck.escritas.push({ acao: 'conversaDireta', token, alvo: userIds.join(',') });
      const id = `dm-novo-${userIds.join('-')}`;
      if (!ck.canais.some((c) => c.id === id)) {
        ck.canais.push({ id, type: 'DM' });
        ck.membros.set(id, [{ id: userIdDoToken(token) }, ...userIds.map((u) => ({ id: u }))]);
        // Conversa que já existia no ClickUp entre os dois: tem histórico lá.
        ck.mensagens.set(id, [{ id: novoId(), user_id: 2, date: t0 - 86_400_000, content: 'conversa antiga no ClickUp' }]);
      }
      return { id, tipo: 'DM' };
    },
  };
  const chegadas: Array<{ conversa: string; ids: string[] }> = [];
  const importar = () => I.importarChatDoClickUp(org, { api: leitura, membrosDoTime: time, workspace: 'WS', aoChegar: async (conversa, ids) => { chegadas.push({ conversa, ids }); } });

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
  /** Escreve aqui, como a rota faz: grava e publica lá (a rota não espera; aqui espera para conferir). */
  async function escrever(conversa: import('./service').Conversa, autor: string, content: string, threadRootId?: string) {
    const r = await svc.enviarMensagem(conversa, autor, { content, clientMessageId: randomUUID(), threadRootId: threadRootId ?? null });
    await E.espelharMensagem(conversa, r.mensagem);
    return r.mensagem;
  }

  beforeAll(async () => {
    process.env.CLICKUP_TEAM_ID = 'WS';
    process.env.CLICKUP_API_KEY = 'chave-da-agencia';
    dbm = await import('@desigual-os/database');
    I = await import('./importar-clickup');
    E = await import('./espelho-clickup');
    svc = await import('./service');
    E.usarClickUpDeTeste(escrita, time);
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: 'QA espelho CU', slug: `qa-espelho-${org}` });
    await db.insert(schema.users).values([
      { id: alicia, name: 'Alicia', email: `alicia-${org}@x.invalid` },
      { id: matheus, name: 'Matheus', email: `matheus-${org}@x.invalid` },
      { id: jamile, name: 'Jamile', email: `jamile-${org}@x.invalid` },
    ]);
    await db.insert(schema.organizationMembers).values([alicia, matheus, jamile].map((userId) => ({ organizationId: org, userId, role: 'collaborator' })));
    // Alicia e Matheus conectaram o ClickUp; a Jamile não.
    await db.insert(schema.integrationConnections).values([
      { userId: alicia, provider: 'clickup', accessTokenEncrypted: 'token-alicia', externalWorkspaceId: 'WS', externalWorkspaceName: 'Agência', status: 'connected' },
      { userId: matheus, provider: 'clickup', accessTokenEncrypted: 'token-matheus', externalWorkspaceId: 'WS', externalWorkspaceName: 'Agência', status: 'connected' },
    ]);
    ck.canais = [{ id: 'ch-envu', type: 'CHANNEL', name: 'Envu', visibility: 'PUBLIC' }];
    ck.membros.set('ch-envu', [{ id: 1 }, { id: 2 }, { id: 4 }]);
    ck.mensagens.set('ch-envu', [{ id: 'h1', user_id: 2, date: t0, content: 'pauta da Envu', replies_count: 0 }]);
    const r = await importar(); // primeira carga: histórico
    expect(r.falhas).toEqual([]);
  });

  afterAll(async () => {
    E.usarClickUpDeTeste(null);
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(inArray(schema.users.id, [alicia, matheus, jamile]));
  });

  beforeEach(async () => {
    ck.escritas.length = 0;
    chegadas.length = 0;
    (await import('../clickup/escrita-daily')).esquecerTokensDaEscrita();
  });

  it('a primeira carga do histórico não avisa ninguém', () => {
    expect(chegadas).toEqual([]);
  });

  it('mensagem escrita aqui num canal ligado sai no ClickUp EM NOME de quem escreveu, e não volta em dobro', async () => {
    const canal = (await conversaDoCanal('ch-envu'))!;
    await escrever(canal, alicia, 'arte aprovada pelo cliente');
    expect(ck.escritas).toEqual([{ acao: 'publicar', token: 'token-alicia', alvo: 'ch-envu', conteudo: 'arte aprovada pelo cliente' }]);
    const r = await importar();
    expect(r.mensagens).toBe(0);
    expect((await mensagensDe(canal.id)).filter((m) => m.content === 'arte aprovada pelo cliente')).toHaveLength(1);
    expect(chegadas).toEqual([]);
  });

  it('resposta em thread aqui vai para a thread da mensagem certa lá', async () => {
    const canal = (await conversaDoCanal('ch-envu'))!;
    const raiz = (await mensagensDe(canal.id)).find((m) => m.content === 'pauta da Envu')!;
    await escrever(canal, matheus, 'eu pego essa', raiz.id);
    expect(ck.escritas).toEqual([{ acao: 'responder', token: 'token-matheus', alvo: 'h1', conteudo: 'eu pego essa' }]);
    // A thread de uma mensagem ANTIGA mudou lá: a importação lê, mas a resposta é a daqui, então não duplica.
    const r = await importar();
    expect(r.respostas).toBe(0);
    expect((await mensagensDe(canal.id)).filter((m) => m.threadRootId === raiz.id).map((m) => m.content)).toEqual(['eu pego essa']);
  });

  it('quem não conectou o ClickUp: no canal sai pela conta da agência com o nome na frente', async () => {
    const canal = (await conversaDoCanal('ch-envu'))!;
    await escrever(canal, jamile, 'subi os layouts');
    expect(ck.escritas).toEqual([{ acao: 'publicar', token: 'chave-da-agencia', alvo: 'ch-envu', conteudo: '**Jamile**: subi os layouts' }]);
    await importar();
    expect((await mensagensDe(canal.id)).filter((m) => (m.content ?? '').includes('subi os layouts'))).toHaveLength(1);
  });

  it('mensagem que chega do ClickUp depois da primeira carga avisa (para o som e o sino), inclusive resposta em thread antiga', async () => {
    const canal = (await conversaDoCanal('ch-envu'))!;
    ck.mensagens.get('ch-envu')!.push({ id: 'n1', user_id: 2, date: (ck.relogio += 60_000), content: 'cliente pediu ajuste' });
    ck.respostas.set('h1', [...(ck.respostas.get('h1') ?? []), { id: 'n1r', user_id: 1, date: (ck.relogio += 60_000), content: 'respondi lá no ClickUp' }]);
    ck.mensagens.get('ch-envu')!.find((m) => m.id === 'h1')!.replies_count = 2;
    const r = await importar();
    expect({ mensagens: r.mensagens, respostas: r.respostas, falhas: r.falhas }).toEqual({ mensagens: 1, respostas: 1, falhas: [] });
    expect(chegadas).toHaveLength(1);
    expect(chegadas[0]!.conversa).toBe(canal.id);
    const novas = (await mensagensDe(canal.id)).filter((m) => chegadas[0]!.ids.includes(m.id)).map((m) => m.content).sort();
    expect(novas).toEqual(['cliente pediu ajuste', 'respondi lá no ClickUp']);
    // Passada seguinte sem nada novo: nada chega, nada avisa.
    chegadas.length = 0;
    const r2 = await importar();
    expect(r2.mensagens + r2.respostas).toBe(0);
    expect(chegadas).toEqual([]);
  });

  it('conversa direta que nasceu aqui ganha a conversa no ClickUp; o histórico de lá entra sem avisar', async () => {
    const privada = await svc.abrirPrivada(org, alicia, matheus);
    await escrever(privada, alicia, 'oi Matheus, pelo DesigualOS');
    expect(ck.escritas.map((e) => [e.acao, e.token, e.alvo])).toEqual([['conversaDireta', 'token-alicia', '2'], ['publicar', 'token-alicia', 'dm-novo-2']]);
    const r = await importar();
    expect(r.falhas).toEqual([]);
    expect((await conversaDoCanal('dm-novo-2'))!.id).toBe(privada.id);
    const ms = await mensagensDe(privada.id);
    expect(ms.map((m) => m.content)).toEqual(['conversa antiga no ClickUp', 'oi Matheus, pelo DesigualOS']);
    expect(chegadas).toEqual([]);
    // A segunda mensagem já usa a conversa ligada: não abre outra.
    ck.escritas.length = 0;
    await escrever(privada, matheus, 'recebi');
    expect(ck.escritas.map((e) => [e.acao, e.token, e.alvo])).toEqual([['publicar', 'token-matheus', 'dm-novo-2']]);
  });

  it('conversa direta de quem não conectou o ClickUp fica só aqui (a agência não entra na conversa dos outros)', async () => {
    const privada = await svc.abrirPrivada(org, jamile, alicia);
    await escrever(privada, jamile, 'só aqui');
    expect(ck.escritas).toEqual([]);
  });

  it('#Geral = canal do workspace no ClickUp: o "Agência Desigual" importado antes vai para o #Geral, sem apagar nada, e o que se escreve no #Geral sai lá', async () => {
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const geral = await svc.garantirGeral(org);
    // Como estava em produção até hoje: o canal do workspace tinha virado um canal à parte, com histórico e leitura.
    const [antigo] = await db.insert(schema.internalConversations).values({ organizationId: org, kind: 'channel', title: 'Agência Desigual', visibility: 'public' }).returning();
    await db.insert(schema.workExternalMappings).values({ organizationId: org, provider: 'clickup', externalType: 'chat_channel', externalId: '7-WS-8', entityType: 'internal_conversation', entityId: antigo!.id, meta: { ultimaMs: t0 + 10, tipo: 'CHANNEL' } });
    await db.insert(schema.internalMessages).values({ organizationId: org, conversationId: antigo!.id, senderId: matheus, kind: 'clickup', content: 'bom dia, equipe', clientMessageId: 'clickup:g-antiga', createdAt: new Date(t0 + 10) });
    const lido = new Date(t0 + 20);
    await db.insert(schema.internalConversationMembers).values({ conversationId: antigo!.id, userId: alicia, organizationId: org, lastReadAt: lido });
    ck.canais.push({ id: '7-WS-8', type: 'CHANNEL', name: 'Agência Desigual', visibility: 'PUBLIC' });
    ck.membros.set('7-WS-8', [{ id: 1 }, { id: 2 }, { id: 4 }]);
    ck.mensagens.set('7-WS-8', [{ id: 'g-antiga', user_id: 2, date: t0 + 10, content: 'bom dia, equipe' }]);

    const r = await importar();
    expect(r.falhas).toEqual([]);
    expect((await conversaDoCanal('7-WS-8'))!.id).toBe(geral.id);
    expect((await mensagensDe(geral.id)).map((m) => m.content)).toEqual(['bom dia, equipe']);
    const [arquivado] = await db.select().from(schema.internalConversations).where(eq(schema.internalConversations.id, antigo!.id));
    expect(arquivado!.archivedAt).not.toBeNull();
    const [leitura] = await db.select().from(schema.internalConversationMembers).where(and(eq(schema.internalConversationMembers.conversationId, geral.id), eq(schema.internalConversationMembers.userId, alicia)));
    expect(leitura!.lastReadAt!.getTime()).toBeGreaterThanOrEqual(lido.getTime());
    expect(chegadas).toEqual([]);

    ck.escritas.length = 0;
    await escrever(geral, alicia, 'reunião às 14h');
    expect(ck.escritas).toEqual([{ acao: 'publicar', token: 'token-alicia', alvo: '7-WS-8', conteudo: 'reunião às 14h' }]);
    ck.mensagens.get('7-WS-8')!.push({ id: 'g-nova', user_id: 2, date: (ck.relogio += 60_000), content: 'combinado' });
    await importar();
    // (o relógio do ClickUp simulado é de 01/11; a mensagem escrita aqui leva a hora de agora: compara o conjunto)
    expect((await mensagensDe(geral.id)).map((m) => m.content).sort()).toEqual(['bom dia, equipe', 'combinado', 'reunião às 14h']);
    expect(chegadas.map((c) => c.conversa)).toEqual([geral.id]);
  });

  it('edição e exclusão daqui chegam lá, pela mesma pessoa', async () => {
    const canal = (await conversaDoCanal('ch-envu'))!;
    const m = await escrever(canal, alicia, 'texto com erro');
    const idLa = ck.escritas[0]!;
    expect(idLa.acao).toBe('publicar');
    ck.escritas.length = 0;
    await E.espelharAlteracao(canal, alicia, m.message.id, 'texto corrigido');
    await E.espelharAlteracao(canal, alicia, m.message.id, null);
    expect(ck.escritas.map((e) => [e.acao, e.token, e.conteudo])).toEqual([['editar', 'token-alicia', 'texto corrigido'], ['apagar', 'token-alicia', undefined]]);
  });
});
