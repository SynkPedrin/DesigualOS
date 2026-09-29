import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  exigirScope, McpAuthorizationError, type McpPrincipal, type McpScope, type ProviderSet,
} from '@desigual-os/mcp-domain';
import { registrarAuditoria } from '../audit.js';
import type { Logger } from '@desigual-os/logging';

/**
 * kit.ts — o molde de toda tool do MCP.
 *
 * Existe para que as três coisas que não podem ser esquecidas não dependam de
 * ninguém lembrar delas em cada tool nova:
 *
 *  1. **A porta de scope** roda antes do corpo, sempre.
 *  2. **A auditoria de escrita** roda depois, sempre, inclusive quando o corpo
 *     falha ou é negado — negação é informação de segurança, não silêncio.
 *  3. **O erro sai legível**, com código estável, em vez de vazar stack.
 *
 * Toda tool é declarada por `definirTool`. Uma tool que precise fugir deste
 * molde é sinal de que o molde está errado, não de que a exceção é justificada.
 */

export interface ContextoDaTool {
  principal: McpPrincipal;
  providers: ProviderSet;
  logger: Logger;
  requestId: string;
}

export type TipoDeAcesso = 'READ' | 'WRITE';

export interface DefinicaoDeTool<TInput extends z.ZodRawShape> {
  nome: string;
  descricao: string;
  entrada: TInput;
  scope: McpScope;
  acesso: TipoDeAcesso;
  /** O tipo de recurso que a tool toca. Vai para a auditoria. */
  recurso: string;
  executar: (args: z.objectOutputType<TInput, z.ZodTypeAny>, ctx: ContextoDaTool) => Promise<unknown>;
}

/**
 * O que o Claude recebe de volta. Sempre JSON, sempre com o mesmo envelope —
 * um formato só é o que permite ao modelo tratar erro de tool como dado em vez
 * de como prosa a interpretar.
 */
function envelope(conteudo: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(conteudo, null, 2) }] };
}

function envelopeDeErro(codigo: string, mensagem: string, detalhe?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: codigo, message: mensagem, ...(detalhe ? { detail: detalhe } : {}) }, null, 2) }],
    isError: true,
  };
}

export interface RegistrarToolDeps {
  server: McpServer;
  /** Resolve o principal da chamada. Lança/retorna null quando não autenticado. */
  contextoDaChamada: () => ContextoDaTool | null;
}

/**
 * Registra uma tool no servidor MCP com todas as portas no lugar.
 *
 * `contextoDaChamada` é uma função, não um valor, porque o principal muda a cada
 * requisição e as tools são registradas uma vez no boot.
 */
export function registrarTool<TInput extends z.ZodRawShape>(
  deps: RegistrarToolDeps,
  def: DefinicaoDeTool<TInput>,
): void {
  /**
   * O `as never` na assinatura do callback é a ÚNICA concessão de tipagem deste
   * arquivo, e ela mora aqui de propósito: o SDK infere os argumentos com
   * `ShapeOutput<Args>`, um tipo interno dele; nós inferimos com
   * `z.objectOutputType`. Os dois descrevem a mesma coisa e o TypeScript não
   * consegue provar isso através da fronteira genérica.
   *
   * Converter num ponto só, explicitamente, é melhor do que afrouxar o tipo de
   * `executar` — que é o que os autores de tool escrevem todo dia e onde o tipo
   * realmente protege.
   */
  deps.server.registerTool(
    def.nome,
    {
      description: def.descricao,
      inputSchema: def.entrada,
      annotations: {
        title: def.nome,
        readOnlyHint: def.acesso === 'READ',
        // §15: destrutivo precisa ser visível ANTES de executar. O cliente MCP
        // usa esta dica para pedir confirmação em vez de agir direto.
        destructiveHint: def.acesso === 'WRITE' && /delete|remove|archive/.test(def.nome),
      },
    },
    (async (args: z.objectOutputType<TInput, z.ZodTypeAny>): Promise<CallToolResult> => {
      const ctx = deps.contextoDaChamada();
      if (!ctx) {
        return envelopeDeErro('UNAUTHENTICATED', 'Sessão não autenticada. Reconecte o Desigual OS.');
      }
      const inicio = Date.now();
      const requestId = ctx.requestId || randomUUID();

      try {
        exigirScope(ctx.principal, def.scope);
      } catch (erro) {
        const e = erro as McpAuthorizationError;
        ctx.logger.warn(
          { tool: def.nome, request_id: requestId, user_id: ctx.principal.userId, role: ctx.principal.role, code: e.code },
          '[mcp] acesso negado',
        );
        // Negação de escrita é auditada: quem tentou e não pôde é informação.
        if (def.acesso === 'WRITE') {
          await registrarAuditoria(
            { principal: ctx.principal, tool: def.nome, resourceType: def.recurso, requestId, result: 'denied', detalhe: { code: e.code } },
            ctx.logger,
          );
        }
        return envelopeDeErro(e.code, e.message, e.detalhe);
      }

      try {
        const resultado = await def.executar(args, { ...ctx, requestId });
        ctx.logger.info(
          { tool: def.nome, request_id: requestId, user_id: ctx.principal.userId, duracao_ms: Date.now() - inicio, acesso: def.acesso },
          '[mcp] tool concluída',
        );
        return envelope(resultado);
      } catch (erro) {
        if (erro instanceof McpAuthorizationError) {
          return envelopeDeErro(erro.code, erro.message, erro.detalhe);
        }
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        ctx.logger.error(
          { err: erro, tool: def.nome, request_id: requestId, user_id: ctx.principal.userId, duracao_ms: Date.now() - inicio },
          '[mcp] tool falhou',
        );
        if (def.acesso === 'WRITE') {
          await registrarAuditoria(
            { principal: ctx.principal, tool: def.nome, resourceType: def.recurso, requestId, result: 'error', detalhe: { message: mensagem } },
            ctx.logger,
          );
        }
        /**
         * A mensagem do erro vai, a stack não. O Claude precisa saber o que deu
         * errado para decidir o próximo passo; expor caminho de arquivo e
         * consulta SQL numa superfície pública não ajuda ninguém.
         */
        return envelopeDeErro('TOOL_FAILED', mensagem);
      }
    }) as never,
  );
}
