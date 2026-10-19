import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  chaveDedupeDeMemoria, confiancaInicial, importanciaDeMemoria, promocaoParaTipo,
  statusInicial, type Importancia, type McpEventType, type McpPrincipal,
} from '@desigual-os/mcp-domain';
import { autorDoRegistro, autoriaNoMetadata } from './autoria.js';

/**
 * promocao-de-conhecimento.ts — o evento rico vira memória, automaticamente.
 *
 * O buraco que isto fecha: `operational_events` acumulava CLIENT_DECISION,
 * CLIENT_FEEDBACK, PROCESS_LEARNING... e NADA disso chegava a `memories`, que é
 * a tabela que o Bento e o Claude do funcionário leem para responder "o que
 * sabemos sobre este cliente". O evento ficava visível um dia no resumo; o
 * conhecimento, perdido. A partir daqui, registrar o acontecimento e gravar o
 * conhecimento são um gesto só.
 *
 * POR QUE ESCRITA DIRETA e não `rememberFact` (a escrita canônica do pipeline):
 * o architecture.test.ts deste app proíbe que qualquer fonte do control plane
 * importe o pacote do orchestrator — o MCP não pode herdar o pipeline serial
 * do Bento. O que se faz aqui é então o MESMO contrato, mantido à mão e
 * travado por teste:
 *
 *  - mesma chave de deduplicação (`chaveDedupeDeMemoria` espelha
 *    `computeDedupeKey` byte a byte, com vetor fixo no teste do mcp-domain) —
 *    memória gravada aqui deduplica contra memória gravada pelo pipeline;
 *  - mesma disciplina de relevância: menos de 25 caracteres não é fato
 *    (MIN_CONTENT_CHARS do memory-engine);
 *  - mesma humildade de origem: nasce `OBSERVED` com `confiancaInicial('claude')`,
 *    o piso da tabela — quem promove a política é humano com papel (§11);
 *  - SEM embedding: o hook de vetor mora no orchestrator e exigiria a
 *    dependência proibida. A memória promovida fica pendente de vetor, exatamente
 *    como as de `save_client_feedback`/`save_learning` — o backfill cobre.
 *
 * E duas garantias estruturais:
 *
 *  - o link de VOLTA: `metadata.event_id` + `metadata.source_refs` apontam para
 *    o operational_event de origem — memória sem procedência é boato;
 *  - NUNCA lança: promoção é efeito colateral do registro do evento, que já
 *    aconteceu. Falha vira `logger.warn`, e o evento continua gravado.
 *
 * PONTO DE INTEGRAÇÃO JEV (futuro — skill TypeSafe; sem TYPESAFE_API_KEY
 * configurada, NADA aqui chama o serviço hoje): a decisão "este evento é digno
 * de virar conhecimento?" é determinística por default (mapa fixo de tipos +
 * piso de 25 chars) e assim permanece. Quando a chave existir, a pergunta que o
 * Jev responderia neste módulo é: "este summary carrega um fato operacional
 * durável sobre cliente/processo, ou é ruído transitório?" — julgamento tipado
 * em `promoverEventoParaMemoria`, antes do insert.
 */

export interface EventoPromovivel {
  id: string;
  type: McpEventType;
  summary: string;
  clientId: string | null;
  taskId?: string | null;
  importance?: Importancia;
}

export type ResultadoDePromocao =
  | { promovido: true; memoryId: string; reconfirmado: boolean }
  | { promovido: false; motivo: string };

/** Mesmo piso do memory-engine (MIN_CONTENT_CHARS): abaixo disto não é fato. */
const MIN_CARACTERES_DE_FATO = 25;

export async function promoverEventoParaMemoria(
  evento: EventoPromovivel,
  principal: McpPrincipal,
  logger: { warn: (obj: object, msg: string) => void },
): Promise<ResultadoDePromocao> {
  const promocao = promocaoParaTipo(evento.type);
  if (!promocao) return { promovido: false, motivo: 'tipo operacional — fica só no evento' };

  try {
    const content = evento.summary.trim();
    if (content.length < MIN_CARACTERES_DE_FATO) {
      return { promovido: false, motivo: `curto demais (${content.length} < ${MIN_CARACTERES_DE_FATO} chars)` };
    }

    const dedupeKey = chaveDedupeDeMemoria({ kind: promocao.kind, content, clientId: evento.clientId });

    // DEDUP — o mesmo fato registrado de novo reconfirma, não duplica. É o
    // passo 1 do pipeline canônico, com a mesma chave.
    const [existente] = await db
      .select({ id: schema.memories.id })
      .from(schema.memories)
      .where(eq(schema.memories.dedupeKey, dedupeKey));
    if (existente) {
      const agora = new Date();
      await db
        .update(schema.memories)
        .set({ lastVerifiedAt: agora, updatedAt: agora })
        .where(eq(schema.memories.id, existente.id));
      return { promovido: true, memoryId: existente.id, reconfirmado: true };
    }

    const [escrita] = await db
      .insert(schema.memories)
      .values({
        kind: promocao.kind,
        content,
        organizationId: principal.organizationId,
        clientId: evento.clientId,
        userId: principal.userId,
        sourceType: 'claude',
        confidence: String(confiancaInicial('claude')),
        importance: importanciaDeMemoria(evento.importance ?? 'NORMAL'),
        status: 'active',
        lastVerifiedAt: new Date(),
        dedupeKey,
        metadata: {
          mcp_status: statusInicial('claude'),
          /**
           * QUEM AGE, não quem autorizou. Antes: `principal.name` — o dono do
           * login. Com credencial de conta compartilhada, o conhecimento da
           * Equipe Atendimento saía atribuído ao master, e autoria ERRADA é
           * pior que ausente (vira avaliação de desempenho sobre dado
           * inventado). Ver ./autoria.ts.
           */
          recorded_by: autorDoRegistro(principal),
          employee_id: principal.employeeId,
          session_id: principal.sessionId,
          ...autoriaNoMetadata(principal),
          // O link de volta: de onde esta memória nasceu.
          event_id: evento.id,
          event_type: evento.type,
          source_refs: [`operational_events:${evento.id}`],
        },
      })
      // Corrida entre duas chamadas com o mesmo conteúdo: o índice único de
      // dedupe_key decide, e a perdedora não estoura a tool que já cumpriu.
      .onConflictDoNothing({ target: schema.memories.dedupeKey })
      .returning({ id: schema.memories.id });

    if (!escrita) return { promovido: false, motivo: 'conflito de dedupe resolvido pelo banco' };
    return { promovido: true, memoryId: escrita.id, reconfirmado: false };
  } catch (error) {
    logger.warn(
      { err: error, eventId: evento.id, type: evento.type },
      '[mcp] promoção do evento para memória falhou (o evento continua registrado)',
    );
    return { promovido: false, motivo: `erro: ${(error as Error).message}` };
  }
}
