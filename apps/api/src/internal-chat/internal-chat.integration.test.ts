import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * Comunicação interna contra PostgreSQL real (TENANT_TEST_DATABASE_URL, banco
 * local descartável). Só o login é simulado (cabeçalho x-test-user); tenant,
 * módulo, regras de acesso, SQL, idempotência, disco dos anexos e notificações
 * são os de verdade. O WebSocket é substituído por um espião que registra
 * PARA QUEM cada evento iria — é isso que o servidor de WS usa para filtrar.
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);
const eventos = vi.hoisted(() => [] as Array<{ type: string; payload: Record<string, unknown> }>);

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Comunicação interna: testes só em PostgreSQL local isolado');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 4 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('@desigual-os/orchestrator', async () => {
  const original = await vi.importActual<Record<string, unknown>>('@desigual-os/orchestrator');
  return {
    ...original,
    publishWsEvent: async (event: { type: string; payload: Record<string, unknown> }) => { eventos.push(event); },
    getRedisConnection: () => ({ set: async () => 'OK', mget: async (...keys: string[]) => keys.map(() => null) }),
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }) => {
    request.authUser = { id: request.headers['x-test-user'], name: 'Teste', roles: [], permissions: [] };
  },
  requirePermission: () => async () => {},
}));

vi.mock('../lib/auditoria', () => ({ auditarAcao: async () => undefined }));

describe.skipIf(!enabled)('Comunicação interna (Postgres real)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const ana = randomUUID();
  const bia = randomUUID();
  const caio = randomUUID();
  const novata = randomUUID();
  const deOutraOrg = randomUUID();
  const app = Fastify();
  let connection: Sql;
  let pasta: string;

  const como = (user: string) => ({ 'x-test-user': user });
  const get = (user: string, url: string) => app.inject({ method: 'GET', url, headers: como(user) });
  const post = (user: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: como(user), payload: payload as never });

  function upload(user: string, conversationId: string, filename: string, mimetype: string, bytes: Buffer) {
    const boundary = '----teste' + randomUUID();
    const corpo = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({ method: 'POST', url: `/internal-chat/conversations/${conversationId}/attachments`, headers: { ...como(user), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: corpo });
  }

  const arquivos = {
    png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x01, 0x40, 0, 0, 0, 0xf0]), Buffer.alloc(64)]),
    pdf: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'),
    pptx: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]),
    mp4: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(300, 2)]),
    mov: Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(300, 3)]),
  };

  let geral = '';
  let privadaAnaBia = '';

  beforeAll(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'chat-anexos-'));
    process.env.INTERNAL_CHAT_FILES_DIR = pasta;
    process.env.INTERNAL_CHAT_MAX_IMAGE_MB = '1';
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;
    await connection`insert into organizations(id, name, slug) values (${orgA}, 'Chat QA A', ${orgA}), (${orgB}, 'Chat QA B', ${orgB})`;
    await connection`insert into users(id, name, email, active) values
      (${ana}, 'Ana', ${ana + '@chat-qa.invalid'}, true),
      (${bia}, 'Bia', ${bia + '@chat-qa.invalid'}, true),
      (${caio}, 'Caio', ${caio + '@chat-qa.invalid'}, true),
      (${novata}, 'Novata', ${novata + '@chat-qa.invalid'}, true),
      (${deOutraOrg}, 'Outra Org', ${deOutraOrg + '@chat-qa.invalid'}, true)`;
    await connection`insert into organization_members(organization_id, user_id, role) values
      (${orgA}, ${ana}, 'member'), (${orgA}, ${bia}, 'member'), (${orgA}, ${caio}, 'member'), (${orgB}, ${deOutraOrg}, 'member')`;
    await app.register(multipart);
    const { registerInternalChatRoutes } = await import('./routes');
    await app.register(registerInternalChatRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection`delete from organizations where id in (${orgA}, ${orgB})`;
    await connection`delete from users where id in (${ana}, ${bia}, ${caio}, ${novata}, ${deOutraOrg})`;
    await rm(pasta, { recursive: true, force: true });
  });

  beforeEach(() => { eventos.length = 0; });

  it('#Geral é criado uma vez só por organização, mesmo com acessos simultâneos', async () => {
    const respostas = await Promise.all([get(ana, '/internal-chat/conversations'), get(bia, '/internal-chat/conversations'), get(caio, '/internal-chat/conversations')]);
    for (const r of respostas) expect(r.statusCode).toBe(200);
    const total = (await connection`select count(*)::int as total from internal_conversations where organization_id = ${orgA} and kind = 'general'`)[0]!.total as number;
    expect(total).toBe(1);
    geral = respostas[0]!.json().conversations[0].id;
    expect(respostas[0]!.json().conversations[0]).toMatchObject({ kind: 'general', title: 'Geral' });
  });

  it('mensagem no #Geral persiste, chega ao vivo para todos da organização e conta como não lida', async () => {
    const r = await post(ana, `/internal-chat/conversations/${geral}/messages`, { content: 'Bom dia, equipe!\nReunião às 10h.', clientMessageId: 'cli-geral-0001' });
    expect(r.statusCode).toBe(201);
    const evento = eventos.find((e) => e.type === 'chat.event' && e.payload.event === 'message.created')!;
    expect(new Set(evento.payload.recipient_ids as string[])).toEqual(new Set([ana, bia, caio]));
    const pagina = (await get(bia, `/internal-chat/conversations/${geral}/messages`)).json();
    expect(pagina.messages.at(-1)).toMatchObject({ content: 'Bom dia, equipe!\nReunião às 10h.', sender_id: ana });
    const naoLidas = (await get(bia, '/internal-chat/unread')).json();
    expect(naoLidas.unread).toBe(1);
    expect((await get(ana, '/internal-chat/unread')).json().unread).toBe(0);
    await post(bia, `/internal-chat/conversations/${geral}/read`);
    expect((await get(bia, '/internal-chat/unread')).json().unread).toBe(0);
  });

  it('reenvio do mesmo clientMessageId (retry/reconexão) não duplica', async () => {
    const corpo = { content: 'enviando duas vezes', clientMessageId: 'cli-retry-0001' };
    const primeira = await post(ana, `/internal-chat/conversations/${geral}/messages`, corpo);
    const segunda = await post(ana, `/internal-chat/conversations/${geral}/messages`, corpo);
    expect(primeira.statusCode).toBe(201);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().id).toBe(primeira.json().id);
    const total = (await connection`select count(*)::int as total from internal_messages where client_message_id = 'cli-retry-0001'`)[0]!.total as number;
    expect(total).toBe(1);
  });

  it('colaborador novo entra e vê o histórico do #Geral; desativado perde acesso', async () => {
    await connection`insert into organization_members(organization_id, user_id, role) values (${orgA}, ${novata}, 'member')`;
    const pagina = await get(novata, `/internal-chat/conversations/${geral}/messages`);
    expect(pagina.statusCode).toBe(200);
    expect(pagina.json().messages.length).toBeGreaterThan(0);
    await connection`update users set active = false where id = ${novata}`;
    expect((await get(novata, `/internal-chat/conversations/${geral}/messages`)).statusCode).toBe(404);
    expect((await post(novata, `/internal-chat/conversations/${geral}/messages`, { content: 'oi', clientMessageId: 'cli-desativada' })).statusCode).toBe(404);
  });

  it('paginação por cursor traz as anteriores sem repetir nem pular', async () => {
    for (let i = 0; i < 7; i += 1) await post(caio, `/internal-chat/conversations/${geral}/messages`, { content: `seq ${i}`, clientMessageId: `cli-seq-${i}-000` });
    const primeira = (await get(ana, `/internal-chat/conversations/${geral}/messages?limit=4`)).json();
    expect(primeira.messages.map((m: { content: string }) => m.content)).toEqual(['seq 3', 'seq 4', 'seq 5', 'seq 6']);
    expect(primeira.has_more).toBe(true);
    const segunda = (await get(ana, `/internal-chat/conversations/${geral}/messages?limit=4&before=${primeira.messages[0].id}`)).json();
    expect(segunda.messages.map((m: { content: string }) => m.content)).toEqual(['enviando duas vezes', 'seq 0', 'seq 1', 'seq 2']);
    const depois = (await get(ana, `/internal-chat/conversations/${geral}/messages?after=${segunda.messages[1].id}`)).json();
    expect(depois.messages.map((m: { content: string }) => m.content)).toEqual(['seq 1', 'seq 2', 'seq 3', 'seq 4', 'seq 5', 'seq 6']);
  });

  it('conversa privada: abre uma vez só para o par, os dois conversam, terceiro não acessa', async () => {
    const a = await post(ana, '/internal-chat/conversations/direct', { userId: bia });
    const b = await post(bia, '/internal-chat/conversations/direct', { userId: ana });
    expect(a.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    privadaAnaBia = a.json().id;
    expect((await post(ana, '/internal-chat/conversations/direct', { userId: ana })).statusCode).toBe(400);
    expect((await post(ana, '/internal-chat/conversations/direct', { userId: deOutraOrg })).statusCode).toBe(400);

    const enviada = await post(ana, `/internal-chat/conversations/${privadaAnaBia}/messages`, { content: 'só entre nós', clientMessageId: 'cli-dm-00001' });
    expect(enviada.statusCode).toBe(201);
    const evento = eventos.find((e) => e.payload.event === 'message.created')!;
    expect(new Set(evento.payload.recipient_ids as string[])).toEqual(new Set([ana, bia]));
    expect((await get(bia, `/internal-chat/conversations/${privadaAnaBia}/messages`)).json().messages[0].content).toBe('só entre nós');

    // Cenário 6: Caio troca o id na URL — 404 em ler, enviar, reagir, digitar e listar arquivos.
    expect((await get(caio, `/internal-chat/conversations/${privadaAnaBia}/messages`)).statusCode).toBe(404);
    expect((await post(caio, `/internal-chat/conversations/${privadaAnaBia}/messages`, { content: 'invadindo', clientMessageId: 'cli-invasao-01' })).statusCode).toBe(404);
    expect((await post(caio, `/internal-chat/conversations/${privadaAnaBia}/messages/${enviada.json().id}/reactions`, { emoji: '👀' })).statusCode).toBe(404);
    expect((await post(caio, `/internal-chat/conversations/${privadaAnaBia}/typing`)).statusCode).toBe(404);
    expect((await get(caio, `/internal-chat/conversations/${privadaAnaBia}/attachments`)).statusCode).toBe(404);
    expect((await get(caio, '/internal-chat/conversations')).json().conversations.map((c: { id: string }) => c.id)).not.toContain(privadaAnaBia);
    // Busca do Caio não acha texto da privada alheia.
    expect((await get(caio, '/internal-chat/search?q=entre%20n')).json().results).toHaveLength(0);
    expect((await get(bia, '/internal-chat/search?q=entre%20n')).json().results).toHaveLength(1);
  });

  it('outra organização não enxerga nada desta', async () => {
    expect((await get(deOutraOrg, `/internal-chat/conversations/${geral}/messages`)).statusCode).toBe(404);
    const lista = (await get(deOutraOrg, '/internal-chat/conversations')).json().conversations;
    expect(lista.map((c: { id: string }) => c.id)).not.toContain(geral);
    expect(lista).toHaveLength(1);
  });

  it('responder, mencionar, editar, reagir e excluir — com notificação para privada, menção e resposta', async () => {
    const original = (await post(bia, `/internal-chat/conversations/${geral}/messages`, { content: 'alguém revisa o post?', clientMessageId: 'cli-orig-0001' })).json();
    // Ninguém está "olhando" a conversa agora (quem leu nos últimos 20 s não é notificado).
    await connection`update internal_conversation_members set last_read_at = null where user_id in (${ana}, ${bia})`;
    const resposta = await post(caio, `/internal-chat/conversations/${geral}/messages`, { content: '@Ana e eu revisamos', clientMessageId: 'cli-resp-0001', replyToId: original.id, mentions: [ana, deOutraOrg] });
    expect(resposta.json().reply_to).toMatchObject({ id: original.id, content: 'alguém revisa o post?' });
    expect(resposta.json().mentions).toEqual([ana]);
    await new Promise((r) => setTimeout(r, 300));
    const notas = await connection`select user_id, type from notifications where dedupe_key like ${`chat:${resposta.json().id}:%`} order by type`;
    expect(notas.map((n) => [n.user_id, n.type])).toEqual([[ana, 'chat.mention'], [bia, 'chat.reply']]);
    const dmNotas = await connection`select type from notifications where user_id = ${bia} and type = 'chat.direct'`;
    expect(dmNotas.length).toBeGreaterThan(0);

    const editada = await app.inject({ method: 'PATCH', url: `/internal-chat/conversations/${geral}/messages/${resposta.json().id}`, headers: como(caio), payload: { content: 'eu revisamos (editado)' } });
    expect(editada.json()).toMatchObject({ content: 'eu revisamos (editado)' });
    expect(editada.json().edited_at).not.toBeNull();
    expect((await app.inject({ method: 'PATCH', url: `/internal-chat/conversations/${geral}/messages/${resposta.json().id}`, headers: como(ana), payload: { content: 'não é minha' } })).statusCode).toBe(404);

    const reagida = await post(ana, `/internal-chat/conversations/${geral}/messages/${resposta.json().id}/reactions`, { emoji: '👍' });
    expect(reagida.json().reactions).toEqual([{ emoji: '👍', user_ids: [ana] }]);
    expect((await post(ana, `/internal-chat/conversations/${geral}/messages/${resposta.json().id}/reactions`, { emoji: '👍' })).json().reactions).toEqual([]);

    expect((await app.inject({ method: 'DELETE', url: `/internal-chat/conversations/${geral}/messages/${resposta.json().id}`, headers: como(bia) })).statusCode).toBe(404);
    const apagada = await app.inject({ method: 'DELETE', url: `/internal-chat/conversations/${geral}/messages/${resposta.json().id}`, headers: como(caio) });
    expect(apagada.json()).toMatchObject({ deleted: true, content: null });
  });

  it('anexos: PNG, PDF, PPTX, MP4 e MOV sobem, viram mensagem e baixam só para quem participa', async () => {
    const ids: Record<string, string> = {};
    for (const [ext, mime] of [['png', 'image/png'], ['pdf', 'application/pdf'], ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], ['mp4', 'video/mp4'], ['mov', 'video/quicktime']] as const) {
      const r = await upload(ana, privadaAnaBia, `arquivo.${ext}`, mime, arquivos[ext]);
      expect(r.statusCode, `${ext}: ${r.body}`).toBe(201);
      ids[ext] = r.json().id;
    }
    expect((await upload(ana, privadaAnaBia, 'foto.png', 'image/png', arquivos.png)).json()).toMatchObject({ kind: 'image', width: 320, height: 240 });
    const msg = await post(ana, `/internal-chat/conversations/${privadaAnaBia}/messages`, { content: 'material', clientMessageId: 'cli-anexos-01', attachmentIds: Object.values(ids) });
    expect(msg.statusCode).toBe(201);
    expect(msg.json().attachments.map((a: { kind: string }) => a.kind).sort()).toEqual(['document', 'document', 'image', 'video', 'video']);

    const pdf = await get(bia, `/internal-chat/attachments/${ids.pdf}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('inline');
    expect(pdf.rawPayload.equals(arquivos.pdf)).toBe(true);
    const pptx = await get(bia, `/internal-chat/attachments/${ids.pptx}`);
    expect(pptx.headers['content-disposition']).toContain('attachment');
    const parcial = await app.inject({ method: 'GET', url: `/internal-chat/attachments/${ids.mp4}`, headers: { ...como(bia), range: 'bytes=0-9' } });
    expect(parcial.statusCode).toBe(206);
    expect(parcial.rawPayload.length).toBe(10);

    expect((await get(caio, `/internal-chat/attachments/${ids.pdf}`)).statusCode).toBe(404);
    expect((await get(deOutraOrg, `/internal-chat/attachments/${ids.pdf}`)).statusCode).toBe(404);

    const arquivosDaConversa = (await get(bia, `/internal-chat/conversations/${privadaAnaBia}/attachments?kind=video`)).json().files;
    expect(arquivosDaConversa).toHaveLength(2);
    expect(arquivosDaConversa[0].sender_name).toBe('Ana');
  });

  it('recusa arquivo disfarçado, tipo proibido e arquivo acima do limite — e não deixa nada no disco', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
    const disfarcado = await upload(ana, privadaAnaBia, 'contrato.pdf', 'application/pdf', exe);
    expect(disfarcado.statusCode).toBe(415);
    expect(disfarcado.json().error).toContain('assinatura');
    expect((await upload(ana, privadaAnaBia, 'programa.exe', 'application/octet-stream', exe)).statusCode).toBe(415);
    const grande = Buffer.concat([arquivos.png, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await upload(ana, privadaAnaBia, 'enorme.png', 'image/png', grande)).statusCode).toBe(413);
    const { readdir } = await import('node:fs/promises');
    const sobras = (await readdir(join(pasta, orgA, privadaAnaBia))).filter((n) => n.endsWith('.parcial'));
    expect(sobras).toEqual([]);
  });

  it('anexo de outra pessoa ou de outra conversa não pode ser "roubado" para uma mensagem', async () => {
    const daBia = (await upload(bia, privadaAnaBia, 'da-bia.png', 'image/png', arquivos.png)).json().id;
    const tentativa = await post(ana, `/internal-chat/conversations/${privadaAnaBia}/messages`, { content: 'pegando', clientMessageId: 'cli-roubo-001', attachmentIds: [daBia] });
    expect(tentativa.statusCode).toBe(400);
    expect((await get(ana, `/internal-chat/attachments/${daBia}`)).statusCode).toBe(404);
  });
});
