import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Operacao } from './db-falso';

/**
 * EQUIVALÊNCIA WEB × WHATSAPP — o que dá para provar sem o sistema no ar.
 *
 * Prova ESTRUTURAL: para o mesmo usuário e a mesma pergunta, os dois canais
 * entram na MESMA função (`submitChatTurn`), com o MESMO usuário autenticado
 * (mesmos papéis e permissões, logo o mesmo recorte de clientes e as mesmas
 * ferramentas), a MESMA mensagem e o MESMO agente. Tudo o que acontece depois
 * disso — roteamento, contexto operacional, ClickUp, worker, modelo, política
 * de confirmação, read-back — é código compartilhado, não duplicado.
 *
 * E a resposta entregue no WhatsApp é a mensagem que o worker gravou na
 * conversa — a mesma linha que a web mostra.
 *
 * O que ESTE teste NÃO prova: equivalência factual com o Brain rodando de
 * verdade (modelo, ClickUp, worker). Isso precisa da bateria ao vivo descrita
 * em docs/bento-whatsapp/HANDOFF.md, que não foi executada.
 */

const LINHA_DO_USUARIO = {
  id: 'u-jamille',
  authUserId: 'auth-jamille',
  email: 'jamille@desigual.test',
  name: 'Jamille Souza',
  avatarUrl: null,
  language: 'pt-BR',
  theme: 'system',
  dashboardWidgets: ['today'],
  clickupEmail: 'jamille@desigual.test',
  jobTitle: 'Atendimento',
  active: true,
  deletedAt: null,
};
const ACESSO = {
  roles: ['colaborador'],
  permissions: [
    { resource: 'chat', action: 'write' },
    { resource: 'clickup', action: 'read' },
  ],
};

const estado = vi.hoisted(() => ({
  respostas: new Map<string, unknown>(),
  chamadas: [] as Array<{ user: unknown; body: Record<string, unknown> }>,
}));

const mocks = vi.hoisted(() => ({
  submitChatTurn: vi.fn(),
  verifySupabaseToken: vi.fn(async () => ({ sub: 'auth-jamille', email: 'jamille@desigual.test' })),
  resolveOrProvisionUser: vi.fn(),
  loadUserAccess: vi.fn(),
}));

vi.mock('@desigual-os/database', async () => {
  process.env.DATABASE_URL ??= 'postgres://teste:teste@127.0.0.1:1/teste';
  const real = await vi.importActual<typeof import('@desigual-os/database')>('@desigual-os/database');
  const { dbFalso } = await import('./db-falso');
  return {
    ...real,
    db: dbFalso((op: Operacao, tabela: string) => {
      if (op !== 'select') return [];
      return estado.respostas.get(tabela) ?? [];
    }),
  };
});

vi.mock('@desigual-os/auth', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/auth')>('@desigual-os/auth');
  return {
    ...real,
    verifySupabaseToken: mocks.verifySupabaseToken,
    resolveOrProvisionUser: mocks.resolveOrProvisionUser,
    loadUserAccess: mocks.loadUserAccess,
  };
});

vi.mock('../chat/turn-service', async () => {
  const real = await vi.importActual<typeof import('../chat/turn-service')>('../chat/turn-service');
  return { ...real, submitChatTurn: mocks.submitChatTurn };
});

const { registerChatRoutes } = await import('../chat/routes');
const { brainPeloChat } = await import('./brain');
const { carregarUsuarioDoCanal } = await import('./usuario');

process.env.SUPABASE_URL ??= 'https://supabase.test';

afterEach(() => {
  vi.clearAllMocks();
  estado.respostas.clear();
  estado.chamadas.length = 0;
});

function programarTurno(conversationId: string) {
  mocks.submitChatTurn.mockImplementation(
    async (user: unknown, body: Record<string, unknown>, reply: { code(n: number): unknown }, _log: unknown, ganchos?: { onUserMessage?: (m: unknown) => void }) => {
      estado.chamadas.push({ user, body });
      ganchos?.onUserMessage?.({ id: 'msg-user', createdAt: new Date(Date.now() - 1_000), conversationId });
      reply.code(202);
      return { execution_id: 'EXE-2026-000001', status: 'queued', agent: 'bento', conversation_id: conversationId };
    },
  );
}

describe('web e WhatsApp entram no MESMO turno', () => {
  it('mesmo usuário, mesmas permissões, mesma mensagem, mesmo agente, mesma conversa', async () => {
    mocks.resolveOrProvisionUser.mockResolvedValue(LINHA_DO_USUARIO);
    mocks.loadUserAccess.mockResolvedValue(ACESSO);
    estado.respostas.set('users', [LINHA_DO_USUARIO]);
    programarTurno('conv-1');

    const pergunta = 'Quais são minhas tarefas atrasadas?';

    // WEB: POST /chat com o requireAuth REAL (token simulado no Supabase).
    const app = Fastify();
    await app.register(registerChatRoutes);
    const web = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: 'Bearer token-da-jamille' },
      payload: { message: pergunta, agent_hint: 'BENTO', conversation_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(web.statusCode).toBe(202);
    await app.close();

    // WHATSAPP: usuário carregado do vínculo, turno pelo adaptador do Brain.
    const doCanal = await carregarUsuarioDoCanal('u-jamille');
    expect(doCanal.tipo).toBe('ok');
    estado.respostas.set('executions', [{ status: 'completed' }]);
    estado.respostas.set('messages', [{ content: 'Você tem 2 tarefas atrasadas: ...' }]);
    const resposta = await brainPeloChat(console as never).perguntar(
      {
        user: (doCanal as unknown as { user: never }).user,
        conversationId: '11111111-1111-4111-8111-111111111111',
        mensagem: pergunta,
      },
      { prazoMs: 5_000 },
    );

    expect(mocks.submitChatTurn).toHaveBeenCalledTimes(2);
    const [daWeb, doWhatsapp] = estado.chamadas;
    // O usuário que a web autentica por JWT e o que o WhatsApp carrega pelo
    // vínculo são o MESMO objeto, campo a campo — inclusive papéis e permissões.
    expect(doWhatsapp!.user).toEqual(daWeb!.user);
    expect(doWhatsapp!.body.message).toBe(daWeb!.body.message);
    expect(doWhatsapp!.body.agent_hint).toBe('BENTO');
    expect(daWeb!.body.agent_hint).toBe('BENTO');
    expect(doWhatsapp!.body.conversation_id).toBe(daWeb!.body.conversation_id);

    // A resposta entregue é a mensagem que o worker gravou na conversa.
    expect(resposta).toEqual({
      tipo: 'resposta',
      texto: 'Você tem 2 tarefas atrasadas: ...',
      conversationId: 'conv-1',
      executionId: 'EXE-2026-000001',
    });
  });

  it('conta desativada: a web recusa (403) e o canal também recusa — mesma regra', async () => {
    const inativo = { ...LINHA_DO_USUARIO, id: 'u-inativo', authUserId: 'auth-inativo', active: false };
    mocks.verifySupabaseToken.mockResolvedValueOnce({ sub: 'auth-inativo', email: inativo.email });
    mocks.resolveOrProvisionUser.mockResolvedValue(inativo);
    estado.respostas.set('users', [inativo]);

    const app = Fastify();
    await app.register(registerChatRoutes);
    const web = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: 'Bearer token-inativo' },
      payload: { message: 'oi' },
    });
    await app.close();
    expect(web.statusCode).toBe(403);
    expect(await carregarUsuarioDoCanal('u-inativo')).toEqual({ tipo: 'inativo' });
    expect(mocks.submitChatTurn).not.toHaveBeenCalled();
  });

  it('sem chat:write: a web recusa (403) e o canal também recusa — mesma regra', async () => {
    const semChat = { ...LINHA_DO_USUARIO, id: 'u-sem-chat', authUserId: 'auth-sem-chat' };
    mocks.verifySupabaseToken.mockResolvedValueOnce({ sub: 'auth-sem-chat', email: semChat.email });
    mocks.resolveOrProvisionUser.mockResolvedValue(semChat);
    mocks.loadUserAccess.mockResolvedValue({ roles: ['colaborador'], permissions: [{ resource: 'clickup', action: 'read' }] });
    estado.respostas.set('users', [semChat]);

    const app = Fastify();
    await app.register(registerChatRoutes);
    const web = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: 'Bearer token-sem-chat' },
      payload: { message: 'oi' },
    });
    await app.close();
    expect(web.statusCode).toBe(403);
    expect(await carregarUsuarioDoCanal('u-sem-chat')).toEqual({ tipo: 'sem_permissao' });
    expect(mocks.submitChatTurn).not.toHaveBeenCalled();
  });

  it('a rota web devolve exatamente o status e o corpo que o turno decidiu', async () => {
    mocks.verifySupabaseToken.mockResolvedValueOnce({ sub: 'auth-jamille-2', email: LINHA_DO_USUARIO.email });
    mocks.resolveOrProvisionUser.mockResolvedValue({ ...LINHA_DO_USUARIO, authUserId: 'auth-jamille-2' });
    mocks.loadUserAccess.mockResolvedValue(ACESSO);
    mocks.submitChatTurn.mockImplementation(async (_u: unknown, _b: unknown, reply: { code(n: number): unknown }) => {
      reply.code(409);
      return { error: 'Esta mensagem já está sendo processada. Aguarde a resposta antes de reenviar.' };
    });
    const app = Fastify();
    await app.register(registerChatRoutes);
    const web = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: 'Bearer token' },
      payload: { message: 'oi' },
    });
    await app.close();
    expect(web.statusCode).toBe(409);
    expect(web.json()).toEqual({ error: 'Esta mensagem já está sendo processada. Aguarde a resposta antes de reenviar.' });
  });
});

describe('adaptador do Brain: estados que não são resposta', () => {
  const user = {
    id: 'u', email: 'e', name: 'n', avatarUrl: null, language: 'pt-BR', theme: 's', dashboardWidgets: [],
    clickupEmail: null, jobTitle: null, roles: ['colaborador' as const], permissions: [],
  };

  it('503 do turno (agente fora) vira indisponível', async () => {
    mocks.submitChatTurn.mockImplementation(async (_u: unknown, _b: unknown, reply: { code(n: number): unknown }) => {
      reply.code(503);
      return { error: 'nenhum node' };
    });
    const r = await brainPeloChat(console as never).perguntar({ user, conversationId: null, mensagem: 'oi' }, { prazoMs: 100 });
    expect(r).toEqual({ tipo: 'indisponivel', motivo: 'nenhum node' });
  });

  it('execução que termina em falha sem mensagem gravada vira "falhou", não resposta inventada', async () => {
    programarTurno('conv-2');
    estado.respostas.set('executions', [{ status: 'failed' }]);
    estado.respostas.set('messages', []);
    vi.useFakeTimers();
    try {
      const pendente = brainPeloChat(console as never).perguntar({ user, conversationId: null, mensagem: 'cria tarefa' }, { prazoMs: 60_000 });
      await vi.advanceTimersByTimeAsync(10_000);
      const r = await pendente;
      expect(r.tipo).toBe('falhou');
    } finally {
      vi.useRealTimers();
    }
  });

  it('o turno do WhatsApp sempre fixa o Bento como agente', async () => {
    programarTurno('conv-3');
    estado.respostas.set('executions', [{ status: 'completed' }]);
    estado.respostas.set('messages', [{ content: 'ok' }]);
    await brainPeloChat(console as never).perguntar({ user, conversationId: null, mensagem: 'Otto, faz uma legenda' }, { prazoMs: 5_000 });
    expect(estado.chamadas[0]!.body.agent_hint).toBe('BENTO');
  });
});
