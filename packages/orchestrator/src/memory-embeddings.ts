import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { EMBEDDING_MODEL, embedBatch, embedText } from '@desigual-os/openai-provider';
import { createLogger } from '@desigual-os/logging';
import type { RecalledMemory } from './memory-engine';

const logger = createLogger({ service: 'memory-embeddings' });

/**
 * memory-embeddings.ts — busca SEMÂNTICA de memória operacional.
 *
 * O que isto adiciona ao memory-engine: o recall de lá é por escopo + kind +
 * ordenação por importância — "tom de voz da 3Net" não acha "a 3Net não quer
 * linguagem técnica nos Reels" se o turno não pedir o kind certo. Aqui a
 * consulta vira vetor (text-embedding-3-small, 512 dims) e o ranqueamento é
 * por similaridade de cosseno.
 *
 * POR QUE jsonb + COSSENO EM JS, e não pgvector: o recall SEMPRE filtra por
 * environment + escopo + status='active' antes de rankear (isolamento duro,
 * inegociável), então o universo rankeado é de dezenas de candidatos, não
 * milhares — SEMANTIC_CANDIDATE_LIMIT abaixo é o teto defensivo. E o pgvector
 * exigiria migration manual fora do fluxo `db:generate` (extensão + tipo
 * vector(512) + índice HNSW não saem do diff do drizzle-kit).
 *
 * CRITÉRIO DE MIGRAÇÃO PRO PGVECTOR (quando qualquer um valer, migrar):
 *  1. algum escopo (environment + cliente/agente/usuário) passar de 500
 *     memórias ativas COM embedding — o cosseno em JS deixa de ser trivial;
 *  2. p95 do recall semântico passar de 500ms medido no worker;
 *  3. busca vetorial sobre knowledge_chunks entrar em produção (a tabela
 *     `embeddings` já documenta o mesmo candidato a ADR) — aí a extensão
 *     se paga uma vez só para os dois usos.
 *
 * CONTRATO IGUAL AO DO memory-engine: NADA aqui lança. Falha da API de
 * embedding = a memória grava sem vetor e a AUSÊNCIA da linha em
 * `memory_embeddings` é o estado "pendente" — `backfillMemoryEmbeddings`
 * cobre. O turno do usuário nunca pode cair por causa de vetor.
 */

export const SEMANTIC_MIN_SIMILARITY = 0.35;
export const SEMANTIC_TOP_K = 5;
/** Teto de candidatos trazidos do banco antes do cosseno em JS. */
export const SEMANTIC_CANDIDATE_LIMIT = 200;

export interface SemanticRecallQuery {
  /** Texto da consulta (a mensagem do turno). Vazio => sem recall. */
  text: string;
  /**
   * OBRIGATÓRIO, ao contrário do recallMemories — o default 'production'
   * silencioso de lá já vazou ambiente USER_PRIVATE antes (ver o comentário
   * da fronteira de tenant em schema/knowledge.ts). Aqui o tipo não deixa
   * esquecer.
   */
  environment: string;
  /**
   * A EMPRESA DO TURNO — a fronteira que faltava aqui.
   *
   * MEDIDO EM 01/10/2026: 47 memórias ativas não têm empresa, nem cliente, nem
   * usuário (43 menções respondidas no ClickUp, 3 checklists, 1 asset do
   * Studio). Sem este filtro, o recall por similaridade alcançava TODAS elas
   * para qualquer pessoa no mesmo ambiente — inclusive para o Bento de uma
   * empresa white-label, que não deveria enxergar nada da Desigual.
   *
   * Hoje o risco é teórico, porque só a Desigual tem conhecimento acumulado.
   * No dia em que a segunda empresa começar a usar, deixa de ser.
   *
   * MEMÓRIA SEM DONO FICA INVISÍVEL, e essa é a falha segura: servir um
   * registro órfão a um tenant é pior que não servi-lo. As 47 precisam de
   * backfill de `organization_id` — carimbar dono aqui, por dedução, seria
   * exatamente o que `organizacao-da-escrita.ts` proíbe.
   */
  organizationId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  kinds?: string[];
  limit?: number;
  minSimilarity?: number;
  /**
   * Vetor da consulta já computado pelo chamador. O turno dispara
   * `embedText(message)` em paralelo com os demais gathers pra não somar
   * latência; sem isto, o vetor é embutido aqui (uma chamada à OpenAI).
   */
  queryVector?: number[] | null;
}

export type SemanticRecalledMemory = RecalledMemory & { similarity: number };

/**
 * Cosseno entre dois vetores. `null` (não exceção, não NaN) quando os vetores
 * não são comparáveis: dims diferentes — vetor de outro modelo/dimensão nunca
 * entra no ranking em vez de pontuar errado — ou vetor zero.
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SemanticCandidate {
  memory: RecalledMemory;
  vector: number[];
}

/**
 * Núcleo PURO do recall (sem banco, sem OpenAI): cosseno -> corte por
 * threshold -> ordenação -> top-k. Extraído pra ser testado com vetores
 * sintéticos, e pra o pipeline de banco ser uma casca fina sobre isto.
 */
export function rankBySimilarity(
  candidates: SemanticCandidate[],
  queryVector: number[],
  // `| undefined` explícito por causa de exactOptionalPropertyTypes: quem
  // repassa query.minSimilarity (opcional) não pode cair em type error.
  opts?: { minSimilarity?: number | undefined; limit?: number | undefined },
): SemanticRecalledMemory[] {
  const min = opts?.minSimilarity ?? SEMANTIC_MIN_SIMILARITY;
  const limit = opts?.limit ?? SEMANTIC_TOP_K;
  return candidates
    .map((c) => ({ ...c.memory, similarity: cosineSimilarity(queryVector, c.vector) }))
    .filter((m): m is SemanticRecalledMemory => m.similarity !== null && m.similarity >= min)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Dedup por memory.id contra o que outro bloco do turno já entregou (dossiê,
 * preferências, episódios) — o mesmo fato duas vezes no prompt só gasta
 * orçamento e sugere ao modelo que houve dois registros. Pura, ordem
 * preservada.
 */
export function excludeMemoryIds<T extends { id: string }>(memories: T[], excludeIds: ReadonlySet<string>): T[] {
  if (excludeIds.size === 0) return memories;
  return memories.filter((m) => !excludeIds.has(m.id));
}

/**
 * Merge de recalls de escopos DIFERENTES (cliente e usuário são consultas
 * separadas — a convenção do repo, ver recallPreferences, é nunca dar AND
 * entre clientId e userId: fato de cliente tem userId nulo e sumiria).
 * Dedup por id ficando com a maior similaridade, reordena, top-k final.
 */
export function mergeSemanticResults(
  lists: SemanticRecalledMemory[][],
  limit: number = SEMANTIC_TOP_K,
): SemanticRecalledMemory[] {
  const porId = new Map<string, SemanticRecalledMemory>();
  for (const lista of lists) {
    for (const m of lista) {
      const anterior = porId.get(m.id);
      if (!anterior || m.similarity > anterior.similarity) porId.set(m.id, m);
    }
  }
  return [...porId.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

function hashDoConteudo(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Gera e grava (upsert) o vetor de UMA memória. Chamada fire-and-forget pelo
 * memory-engine depois de todo insert e de toda reconfirmação que sobrescreve
 * o content — o upsert atualiza `updatedAt`, que é o que permite auditar
 * "vetor mais velho que a memória". Nunca lança; devolve se gravou.
 */
export async function generateAndStoreMemoryEmbedding(memoryId: string, content: string): Promise<boolean> {
  try {
    const vector = await embedText(content);
    if (!vector) return false;
    const now = new Date();
    await db
      .insert(schema.memoryEmbeddings)
      .values({ memoryId, model: EMBEDDING_MODEL, vector, contentHash: hashDoConteudo(content) })
      .onConflictDoUpdate({
        target: schema.memoryEmbeddings.memoryId,
        set: { model: EMBEDDING_MODEL, vector, contentHash: hashDoConteudo(content), updatedAt: now },
      });
    return true;
  } catch (error) {
    logger.warn({ error, memoryId }, 'Falha ao gravar embedding de memória (ausência da linha = pendente; backfill cobre)');
    return false;
  }
}

/**
 * Preenche o vetor das memórias ativas que ainda não têm linha em
 * `memory_embeddings` (anteriores à feature, ou cuja geração falhou na
 * escrita). Um lote por chamada; o script CLI repete até zerar.
 */
export async function backfillMemoryEmbeddings(opts?: {
  batchSize?: number;
  environment?: string;
}): Promise<{ candidatas: number; gravadas: number }> {
  const conditions = [
    eq(schema.memories.status, 'active'),
    or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`)!,
    isNull(schema.memoryEmbeddings.memoryId),
  ];
  if (opts?.environment) conditions.push(eq(schema.memories.environment, opts.environment));

  const pendentes = await db
    .select({ id: schema.memories.id, content: schema.memories.content })
    .from(schema.memories)
    .leftJoin(schema.memoryEmbeddings, eq(schema.memoryEmbeddings.memoryId, schema.memories.id))
    .where(and(...conditions))
    .orderBy(desc(schema.memories.updatedAt))
    .limit(opts?.batchSize ?? 100);

  if (pendentes.length === 0) return { candidatas: 0, gravadas: 0 };

  const vectors = await embedBatch(pendentes.map((p) => p.content));
  if (!vectors) return { candidatas: pendentes.length, gravadas: 0 };

  let gravadas = 0;
  for (let i = 0; i < pendentes.length; i++) {
    const vector = vectors[i];
    if (!vector) continue;
    const p = pendentes[i]!;
    try {
      await db
        .insert(schema.memoryEmbeddings)
        .values({ memoryId: p.id, model: EMBEDDING_MODEL, vector, contentHash: hashDoConteudo(p.content) })
        .onConflictDoNothing();
      gravadas++;
    } catch (error) {
      logger.warn({ error, memoryId: p.id }, 'Backfill: falha ao gravar vetor (segue pendente)');
    }
  }
  return { candidatas: pendentes.length, gravadas };
}

/**
 * Recall semântico. NÃO estende `recallMemories` (8 callers com contrato
 * próprio): função nova, pipeline de 1 query + ranqueamento em JS:
 *
 *   memórias ativas/não expiradas do environment + escopo, COM vetor
 *   (innerJoin memory_embeddings), ordenadas por importância/recência,
 *   LIMIT 200  →  cosseno em JS  →  >= threshold  →  top-k.
 *
 * Memória sem vetor simplesmente não participa — degradação silenciosa e
 * correta enquanto o backfill não roda. Falha em qualquer ponto = [].
 */
export async function recallMemoriesSemantic(query: SemanticRecallQuery): Promise<SemanticRecalledMemory[]> {
  try {
    const text = query.text.trim();
    if (text.length === 0) return [];
    const queryVector = query.queryVector ?? (await embedText(text));
    if (!queryVector) return [];

    const conditions = [
      eq(schema.memories.status, 'active'),
      or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`)!,
      // ISOLAMENTO DURO, antes de qualquer filtro de propósito — mesma regra
      // do recallMemories, e aqui o parâmetro nem opcional é.
      eq(schema.memories.environment, query.environment),
    ];
    // A EMPRESA PRIMEIRO, antes de qualquer recorte de propósito — mesma ordem
    // do isolamento de ambiente logo acima, e pelo mesmo motivo: fronteira de
    // tenant não é filtro de relevância, é pré-condição.
    if (query.organizationId) conditions.push(eq(schema.memories.organizationId, query.organizationId));
    if (query.clientId) conditions.push(eq(schema.memories.clientId, query.clientId));
    if (query.agentId) conditions.push(eq(schema.memories.agentId, query.agentId));
    if (query.userId) conditions.push(eq(schema.memories.userId, query.userId));
    if (query.kinds?.length) conditions.push(inArray(schema.memories.kind, query.kinds));

    const rows = await db
      .select({
        id: schema.memories.id,
        kind: schema.memories.kind,
        content: schema.memories.content,
        clientId: schema.memories.clientId,
        sourceType: schema.memories.sourceType,
        sourceId: schema.memories.sourceId,
        confidence: schema.memories.confidence,
        importance: schema.memories.importance,
        metadata: schema.memories.metadata,
        updatedAt: schema.memories.updatedAt,
        vector: schema.memoryEmbeddings.vector,
      })
      .from(schema.memories)
      .innerJoin(schema.memoryEmbeddings, eq(schema.memoryEmbeddings.memoryId, schema.memories.id))
      .where(and(...conditions))
      // A ordenação decide QUEM ENTRA no corte de 200 candidatos quando há
      // excesso; o ranqueamento final é pela similaridade, não por isto.
      .orderBy(sql`COALESCE(${schema.memories.importance}, 0.5) DESC`, desc(schema.memories.updatedAt))
      .limit(SEMANTIC_CANDIDATE_LIMIT);

    return rankBySimilarity(
      rows.map((row) => ({
        memory: {
          id: row.id,
          kind: row.kind,
          content: row.content,
          clientId: row.clientId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          confidence: row.confidence === null ? null : Number(row.confidence),
          importance: row.importance === null ? null : Number(row.importance),
          subject: ((row.metadata as { subject?: string } | null)?.subject) ?? null,
          metadata: (row.metadata as Record<string, unknown> | null) ?? null,
          updatedAt: row.updatedAt,
        },
        vector: row.vector,
      })),
      queryVector,
      { minSimilarity: query.minSimilarity, limit: query.limit },
    );
  } catch (error) {
    logger.warn({ error }, 'Falha no recall semântico (turno segue sem o bloco)');
    return [];
  }
}

/**
 * Bloco pro prompt. Vazio quando não há memória — nada de seção fantasma.
 * `header` tem default pra não quebrar chamador existente; um recall de kind
 * diferente (ex: manual do produto, que é fato estável, não achado por
 * semelhança a confirmar) passa o próprio cabeçalho.
 */
export function formatSemanticMemoryBlock(
  memories: SemanticRecalledMemory[],
  header = 'MEMÓRIAS RELACIONADAS AO ASSUNTO DESTE TURNO (recuperadas por semelhança; confirme antes de tratar como fato vigente):',
): string {
  if (memories.length === 0) return '';
  return [header, ...memories.map((m) => `- ${m.content}`)].join('\n');
}
