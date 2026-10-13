import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montarPrincipal, type AtorDoPrincipal } from '@desigual-os/mcp-domain';

/**
 * telemetria.test.ts — toda chamada de tool vira MCP_TOOL_CALLED (Entrega 1).
 *
 * O padrão de mock é o do kit.test.ts (servidor falso + auditoria mockada),
 * com o banco trocado por um capturador de inserts — telemetria é INSERT em
 * operational_events, e é isso que se prova aqui: shape do evento, ator real,
 * processedAt preenchido e a garantia de que falha da telemetria não encosta
 * na resposta da tool.
 */

const h = vi.hoisted(() => ({
  inseridos: [] as Array<Record<string, unknown>>,
  falharInsert: false,
}));

vi.mock('@desigual-os/database', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (h.falharInsert) return Promise.reject(new Error('banco indisponível'));
        h.inseridos.push(values);
        return Promise.resolve();
      },
    }),
  },
  schema: { operationalEvents: { __table: 'operational_events' } },
}));

vi.mock('../audit.js', () => ({ registrarAuditoria: vi.fn(async () => undefined) }));

import { registrarTool, type ContextoDaTool } from './kit';

function servidorFalso() {
  const registradas = new Map<string, { config: Record<string, unknown>; handler: (args: unknown) => Promise<unknown> }>();
  return {
    registradas,
    registerTool: (nome: string, config: Record<string, unknown>, handler: (args: unknown) => Promise<unknown>) => {
      registradas.set(nome, { config, handler });
    },
  };
}

function loggerFalso() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function contexto(logger: ReturnType<typeof loggerFalso>, role: string, scopes: string[], ator: AtorDoPrincipal | null = null): ContextoDaTool {
  return {
    principal: montarPrincipal(
      { userId: 'u1', organizationId: 'org1', employeeId: 'e1', email: 'a@b.com', name: 'Alguém', role },
      scopes,
      'sessao-1',
      { organizationIds: ['org1'], ehProvider: false },
      ator,
    ),
    providers: {} as never,
    logger: logger as never,
    requestId: 'req-1',
  };
}

function texto(resultado: unknown): string {
  return (resultado as { content: Array<{ text: string }> }).content[0]!.text;
}

async function telemetriaGravada(n = 1): Promise<void> {
  // A telemetria é fire-and-forget de propósito (`void` no kit) — o teste
  // espera o efeito em vez de mudar o contrato para agradar o teste.
  await vi.waitFor(() => expect(h.inseridos.length).toBeGreaterThanOrEqual(n));
}

beforeEach(() => {
  h.inseridos.length = 0;
  h.falharInsert = false;
});

describe('telemetria — toda chamada vira MCP_TOOL_CALLED', () => {
  it('tool de LEITURA concluída grava evento com ator, org, duração e processedAt preenchido', async () => {
    const server = servidorFalso();
    const logger = loggerFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'CREATIVE', ['desigual.read']) }, {
      nome: 'get_client_context', descricao: 'd', entrada: {}, scope: 'desigual.read', acesso: 'READ', recurso: 'client',
      executar: async () => ({ ok: true }),
    });

    await server.registradas.get('get_client_context')!.handler({ client_id: 'cliente-9' });
    await telemetriaGravada();

    const evento = h.inseridos[0]!;
    expect(evento.source).toBe('mcp');
    expect(evento.type).toBe('MCP_TOOL_CALLED');
    // Actor REAL, do principal — nunca derivado de argumento.
    expect(evento.userId).toBe('u1');
    expect(evento.employeeId).toBe('e1');
    expect(evento.organizationId).toBe('org1');
    expect(evento.actor).toBe('Alguém');
    // client_id derivado dos args; entity é o recurso declarado pela tool.
    expect(evento.clientId).toBe('cliente-9');
    expect(evento.entityType).toBe('client');
    // Telemetria NÃO é sinal proativo: processada no nascedouro.
    expect(evento.processedAt).toBeInstanceOf(Date);
    expect(evento.occurredAt).toBeInstanceOf(Date);
    expect(evento.visibility).toBe('TEAM');

    const payload = evento.payload as Record<string, unknown>;
    expect(payload.tool).toBe('get_client_context');
    expect(payload.acesso).toBe('READ');
    expect(payload.resultado).toBe('ok');
    expect(payload.request_id).toBe('req-1');
    expect(payload.session_id).toBe('sessao-1');
    expect(typeof payload.duracao_ms).toBe('number');
    expect(payload.client_id).toBe('cliente-9');
  });

  it('tool de ESCRITA concluída também grava (telemetria e auditoria convivem)', async () => {
    const server = servidorFalso();
    const logger = loggerFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'MANAGER', ['tasks.write']) }, {
      nome: 'complete_task', descricao: 'd', entrada: {}, scope: 'tasks.write', acesso: 'WRITE', recurso: 'task',
      executar: async () => ({ status: 'COMPLETED' }),
    });

    await server.registradas.get('complete_task')!.handler({ task_id: 'task-7' });
    await telemetriaGravada();

    const payload = h.inseridos[0]!.payload as Record<string, unknown>;
    expect(payload.acesso).toBe('WRITE');
    expect(payload.resultado).toBe('ok');
    expect(h.inseridos[0]!.taskId).toBe('task-7');
    expect(h.inseridos[0]!.entityId).toBe('task-7');
  });

  it('chamada NEGADA por scope grava resultado negada — e o corpo nunca roda', async () => {
    const server = servidorFalso();
    const logger = loggerFalso();
    const executar = vi.fn(async () => ({ ok: true }));
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'CREATIVE', ['desigual.read']) }, {
      nome: 'get_traffic', descricao: 'd', entrada: {}, scope: 'traffic.read', acesso: 'READ', recurso: 'campaign', executar,
    });

    const resposta = await server.registradas.get('get_traffic')!.handler({});
    expect(texto(resposta)).toContain('SCOPE_MISSING');
    expect(executar).not.toHaveBeenCalled();
    await telemetriaGravada();

    expect((h.inseridos[0]!.payload as Record<string, unknown>).resultado).toBe('negada');
  });

  it('tool que FALHA grava resultado erro e a resposta continua sendo o envelope de erro', async () => {
    const server = servidorFalso();
    const logger = loggerFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'MANAGER', ['tasks.read']) }, {
      nome: 'list_tasks', descricao: 'd', entrada: {}, scope: 'tasks.read', acesso: 'READ', recurso: 'task',
      executar: async () => { throw new Error('ClickUp fora do ar'); },
    });

    const resposta = await server.registradas.get('list_tasks')!.handler({});
    expect(texto(resposta)).toContain('TOOL_FAILED');
    await telemetriaGravada();

    const payload = h.inseridos[0]!.payload as Record<string, unknown>;
    expect(payload.resultado).toBe('erro');
    expect(String(payload.erro)).toContain('ClickUp fora do ar');
  });

  it('FALHA DA TELEMETRIA não muda a resposta da tool — vira warn e nada mais', async () => {
    h.falharInsert = true;
    const server = servidorFalso();
    const logger = loggerFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'MANAGER', ['tasks.read']) }, {
      nome: 'list_tasks', descricao: 'd', entrada: {}, scope: 'tasks.read', acesso: 'READ', recurso: 'task',
      executar: async () => ({ tasks: 3 }),
    });

    const resposta = await server.registradas.get('list_tasks')!.handler({});
    expect(texto(resposta)).toContain('"tasks": 3');

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'list_tasks' }),
        expect.stringContaining('telemetria'),
      ),
    );
    expect(h.inseridos).toHaveLength(0);
  });

  it('credencial de conexão: o ator operacional vai no payload, e a coluna actor continua o dono do login', async () => {
    const ator: AtorDoPrincipal = {
      identityId: 'ident-atendimento', displayName: 'Equipe Atendimento', actorType: 'shared_account', personId: null,
    };
    const server = servidorFalso();
    const logger = loggerFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'MANAGER', ['tasks.write'], ator) }, {
      nome: 'complete_task', descricao: 'd', entrada: {}, scope: 'tasks.write', acesso: 'WRITE', recurso: 'task',
      executar: async () => ({ status: 'COMPLETED' }),
    });

    await server.registradas.get('complete_task')!.handler({ task_id: 'task-7' });
    await telemetriaGravada();

    const payload = h.inseridos[0]!.payload as Record<string, unknown>;
    expect(payload.actor_identity_id).toBe('ident-atendimento');
    expect(payload.actor).toBe('Equipe Atendimento');
    expect(payload.actor_type).toBe('shared_account');
    expect(payload.authorized_by_user_id).toBe('u1');
    // A coluna NÃO muda: telemetria responde "uso da superfície" pelo login.
    expect(h.inseridos[0]!.actor).toBe('Alguém');
  });

  it('sem ator, o payload NÃO ganha campos de identidade — legado intacto', async () => {
    const server = servidorFalso();
    const logger = loggerFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto(logger, 'MANAGER', ['tasks.write']) }, {
      nome: 'complete_task', descricao: 'd', entrada: {}, scope: 'tasks.write', acesso: 'WRITE', recurso: 'task',
      executar: async () => ({ status: 'COMPLETED' }),
    });

    await server.registradas.get('complete_task')!.handler({ task_id: 'task-7' });
    await telemetriaGravada();

    const payload = h.inseridos[0]!.payload as Record<string, unknown>;
    expect(payload.actor_identity_id).toBeUndefined();
    expect(payload.actor_type).toBeUndefined();
    expect(payload.authorized_by_user_id).toBeUndefined();
  });
});
