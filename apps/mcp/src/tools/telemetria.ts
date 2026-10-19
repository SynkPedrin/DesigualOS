import { db, schema } from '@desigual-os/database';
import type { McpPrincipal } from '@desigual-os/mcp-domain';
import { autoriaNoPayload } from './autoria.js';

/**
 * telemetria.ts — TODA chamada de tool vira um evento `MCP_TOOL_CALLED`.
 *
 * Até 30/09/2026 o MCP só deixava rastro de ESCRITA (`audit_logs`, via
 * audit.ts), por uma decisão de época: "auditar toda leitura seria vigilância".
 * A decisão do produto agora é o contrário — a agência precisa enxergar o uso
 * inteiro da superfície (quem lê o quê, quanto leva, o que falha) para operar e
 * cobrar por ela. A leitura continua fora do `audit_logs`: quem conta o uso é
 * esta camada, em `operational_events`.
 *
 * DUAS CAMADAS QUE COEXISTEM, e nenhuma substitui a outra:
 *
 *  - TELEMETRIA (aqui): "a tool X foi chamada, por quem, quanto levou, com
 *    qual resultado". Nasce de TODA chamada, inclusive negada por scope.
 *  - EVENTO DE NEGÓCIO (log_operational_event, registrarEventoDeTask...): "o
 *    que mudou na operação". Nasce só do que a própria tool decide registrar.
 *
 * Por isso uma tool que grava evento de negócio TAMBÉM gera MCP_TOOL_CALLED —
 * não é duplicação, são perguntas diferentes.
 *
 * Três regras inegociáveis:
 *
 *  1. `processedAt` PREENCHIDO: telemetria é registro de uso, não acontecimento
 *     a interpretar — não pode entrar na fila de sinais proativos do worker nem
 *     ser promovida a memória (knowledge-promotion.ts garante a segunda metade).
 *  2. NUNCA bloqueia nem derruba a tool: quem chama usa `void`, e toda falha
 *     vira `logger.warn`. Telemetria que derruba operação é pior que ausência.
 *  3. O ator é o principal REAL (user/employee/organização da sessão), nunca
 *     derivado de argumento — argumento é dado declarado, principal é fato.
 */

export type ResultadoDeTool = 'ok' | 'negada' | 'erro';

export interface ChamadaDeTool {
  principal: McpPrincipal;
  tool: string;
  acesso: 'READ' | 'WRITE';
  /** O tipo de recurso que a tool declara tocar (vai para entity_type). */
  recurso: string;
  requestId: string;
  duracaoMs: number;
  resultado: ResultadoDeTool;
  /** Argumentos brutos da chamada — só IDs são extraídos, nunca o conteúdo. */
  args?: Record<string, unknown>;
  /** Mensagem curta do erro, quando resultado = 'erro'. */
  erro?: string;
}

/** Extrai os IDs que o evento carrega como coluna. Nada mais sai dos args. */
function idsDosArgs(args: Record<string, unknown> | undefined): {
  clientId: string | null;
  taskId: string | null;
  entityId: string | null;
} {
  if (!args || typeof args !== 'object') return { clientId: null, taskId: null, entityId: null };
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const clientId = texto(args.client_id) ?? texto(args.clientId);
  const taskId = texto(args.task_id) ?? texto(args.taskId);
  const entityId = taskId ?? texto(args.id);
  return { clientId, taskId, entityId };
}

/**
 * Grava o MCP_TOOL_CALLED. Assíncrona e NUNCA lança — mas quem chama deve usar
 * `void` mesmo assim: a tool não espera a telemetria para responder.
 */
export async function registrarTelemetriaDeTool(
  chamada: ChamadaDeTool,
  logger: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    const { clientId, taskId, entityId } = idsDosArgs(chamada.args);
    await db.insert(schema.operationalEvents).values({
      source: 'mcp',
      type: 'MCP_TOOL_CALLED',
      // request_id é único por chamada: a chave de idempotência é a própria chamada.
      externalId: `mcp:tool:${chamada.requestId}`,
      organizationId: chamada.principal.organizationId,
      userId: chamada.principal.userId,
      employeeId: chamada.principal.employeeId,
      clientId,
      taskId,
      entityType: chamada.recurso,
      entityId,
      actor: chamada.principal.name,
      summary: `${chamada.tool} (${chamada.acesso}) → ${chamada.resultado} em ${chamada.duracaoMs}ms`,
      importance: 'LOW',
      visibility: 'TEAM',
      payload: {
        tool: chamada.tool,
        acesso: chamada.acesso,
        resultado: chamada.resultado,
        request_id: chamada.requestId,
        session_id: chamada.principal.sessionId,
        duracao_ms: chamada.duracaoMs,
        client_id: clientId,
        // Quem AGE (credencial de conexão), quando existe — ver ./autoria.ts.
        // A coluna `actor` continua o dono do login: telemetria responde "uso
        // da superfície", e o ator operacional vai no payload, mesmo contrato
        // das tools de escrita.
        ...autoriaNoPayload(chamada.principal),
        ...(chamada.erro ? { erro: chamada.erro.slice(0, 300) } : {}),
      },
      occurredAt: new Date(),
      // Telemetria não é sinal proativo — mesmo motivo de registrarEventoDeTask.
      processedAt: new Date(),
    });
  } catch (error) {
    logger.warn(
      { err: error, tool: chamada.tool, request_id: chamada.requestId },
      '[mcp] telemetria da tool não gravada (a chamada em si seguiu normal)',
    );
  }
}
