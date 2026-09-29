import { describe, expect, it, vi } from 'vitest';
import { montarPrincipal } from '@desigual-os/mcp-domain';
import { registrarTool, type ContextoDaTool } from './kit';

vi.mock('../audit.js', () => ({ registrarAuditoria: vi.fn(async () => undefined) }));

/**
 * O kit é o molde de TODA tool: porta de scope antes, auditoria depois, erro
 * legível sempre. Um `if` esquecido aqui vira acesso indevido em 26 tools de
 * uma vez, então o que se testa é o molde, não cada tool.
 */
function servidorFalso() {
  const registradas = new Map<string, { config: Record<string, unknown>; handler: (args: unknown) => Promise<unknown> }>();
  return {
    registradas,
    registerTool: (nome: string, config: Record<string, unknown>, handler: (args: unknown) => Promise<unknown>) => {
      registradas.set(nome, { config, handler });
    },
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function contexto(role: string, scopes: string[]): ContextoDaTool {
  return {
    principal: montarPrincipal(
      { userId: 'u1', organizationId: 'org1', employeeId: 'e1', email: 'a@b.com', name: 'Alguém', role },
      scopes,
      's1',
    ),
    providers: {} as never,
    logger,
    requestId: 'req-1',
  };
}

function texto(resultado: unknown): string {
  return (resultado as { content: Array<{ text: string }> }).content[0]!.text;
}

describe('kit — o molde de toda tool', () => {
  it('sem sessão, nenhuma tool executa', async () => {
    const server = servidorFalso();
    const executar = vi.fn(async () => ({ ok: true }));
    registrarTool({ server: server as never, contextoDaChamada: () => null }, {
      nome: 't', descricao: 'd', entrada: {}, scope: 'desigual.read', acesso: 'READ', recurso: 'x', executar,
    });
    const r = await server.registradas.get('t')!.handler({});
    expect(texto(r)).toContain('UNAUTHENTICATED');
    expect(executar).not.toHaveBeenCalled();
  });

  it('SEM O SCOPE, o corpo da tool NUNCA roda', async () => {
    // É a garantia central: a recusa acontece antes, não depois de tocar o dado.
    const server = servidorFalso();
    const executar = vi.fn(async () => ({ ok: true }));
    registrarTool({ server: server as never, contextoDaChamada: () => contexto('CREATIVE', ['desigual.read']) }, {
      nome: 't', descricao: 'd', entrada: {}, scope: 'traffic.read', acesso: 'READ', recurso: 'x', executar,
    });
    const r = await server.registradas.get('t')!.handler({});
    expect(texto(r)).toContain('SCOPE_MISSING');
    expect(texto(r)).toContain('CREATIVE');
    expect(executar).not.toHaveBeenCalled();
  });

  it('com o scope, executa e devolve o resultado', async () => {
    const server = servidorFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto('MANAGER', ['tasks.read']) }, {
      nome: 't', descricao: 'd', entrada: {}, scope: 'tasks.read', acesso: 'READ', recurso: 'x',
      executar: async () => ({ tasks: 3 }),
    });
    expect(texto(await server.registradas.get('t')!.handler({}))).toContain('"tasks": 3');
  });

  it('erro da tool vira mensagem, e a stack NÃO vaza', async () => {
    const server = servidorFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto('MANAGER', ['tasks.write']) }, {
      nome: 't', descricao: 'd', entrada: {}, scope: 'tasks.write', acesso: 'WRITE', recurso: 'x',
      executar: async () => { throw new Error('o ClickUp recusou'); },
    });
    const saida = texto(await server.registradas.get('t')!.handler({}));
    expect(saida).toContain('TOOL_FAILED');
    expect(saida).toContain('o ClickUp recusou');
    expect(saida).not.toContain('at Object');
    expect(saida).not.toContain('.ts:');
  });

  it('a tool se declara leitura ou escrita para o cliente MCP', async () => {
    const server = servidorFalso();
    const deps = { server: server as never, contextoDaChamada: () => contexto('MANAGER', ['tasks.write']) };
    registrarTool(deps, { nome: 'ler', descricao: 'd', entrada: {}, scope: 'tasks.read', acesso: 'READ', recurso: 'x', executar: async () => ({}) });
    registrarTool(deps, { nome: 'delete_task', descricao: 'd', entrada: {}, scope: 'tasks.write', acesso: 'WRITE', recurso: 'x', executar: async () => ({}) });
    const anot = (n: string) => (server.registradas.get(n)!.config as { annotations: Record<string, boolean> }).annotations;
    expect(anot('ler').readOnlyHint).toBe(true);
    expect(anot('delete_task').readOnlyHint).toBe(false);
    // §15: destrutivo precisa ser visível ANTES de executar
    expect(anot('delete_task').destructiveHint).toBe(true);
    expect(anot('ler').destructiveHint).toBe(false);
  });

  it('a saída é sempre JSON no mesmo envelope', async () => {
    const server = servidorFalso();
    registrarTool({ server: server as never, contextoDaChamada: () => contexto('MANAGER', ['tasks.read']) }, {
      nome: 't', descricao: 'd', entrada: {}, scope: 'tasks.read', acesso: 'READ', recurso: 'x',
      executar: async () => ({ a: 1 }),
    });
    const r = (await server.registradas.get('t')!.handler({})) as { content: Array<{ type: string }> };
    expect(r.content[0]!.type).toBe('text');
    expect(() => JSON.parse(texto(r))).not.toThrow();
  });
});
