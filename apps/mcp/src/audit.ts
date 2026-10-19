import { db, schema } from '@desigual-os/database';
import type { McpPrincipal } from '@desigual-os/mcp-domain';

/**
 * audit.ts — toda escrita deixa rastro (§12).
 *
 * A tabela `audit_logs` já existia com 2.417 linhas, mas fina: `user_id`,
 * `action`, `result` e um jsonb. Dava para responder "quem alterou"; não dava
 * para responder "o que era antes" nem para correlacionar uma requisição sem
 * varrer jsonb. A migração 0044 acrescentou as colunas; este módulo é quem as
 * preenche.
 *
 * NUNCA LANÇA. Falha de auditoria não pode derrubar a operação — mas também não
 * pode sumir: o erro vai para o log estruturado com o `request_id`, e aí a
 * ausência da linha é investigável.
 */

export interface RegistroDeAuditoria {
  principal: McpPrincipal;
  tool: string;
  resourceType: string;
  resourceId?: string | null;
  clientId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  requestId: string;
  result: 'success' | 'denied' | 'error' | 'blocked_duplicate';
  detalhe?: Record<string, unknown>;
}

export async function registrarAuditoria(
  registro: RegistroDeAuditoria,
  logger: { error: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      userId: registro.principal.userId,
      organizationId: registro.principal.organizationId,
      employeeId: registro.principal.employeeId,
      sessionId: registro.principal.sessionId,
      action: `mcp.${registro.tool}`,
      tool: registro.tool,
      resourceType: registro.resourceType,
      resourceId: registro.resourceId ?? null,
      clientId: registro.clientId ?? null,
      oldValue: registro.oldValue ?? null,
      newValue: registro.newValue ?? null,
      requestId: registro.requestId,
      /**
       * `source: 'mcp'` é o que responde à pergunta do §12 — "foi Bento, Claude
       * ou humano?". O worker grava 'worker', o webhook grava 'webhook', a web
       * grava 'web'. Aqui é sempre o Claude de um funcionário.
       */
      source: 'mcp',
      result: registro.result,
      metadata: {
        role: registro.principal.role,
        scopes: registro.principal.scopes,
        ...(registro.detalhe ?? {}),
      },
    });
  } catch (error) {
    logger.error(
      { err: error, tool: registro.tool, request_id: registro.requestId, user_id: registro.principal.userId },
      '[auditoria] não consegui gravar a linha de auditoria — a operação seguiu',
    );
  }
}
