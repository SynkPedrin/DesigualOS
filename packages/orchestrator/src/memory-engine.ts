import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'memory-engine' });

/**
 * memory-engine.ts — escrita, deduplicação, supersessão e recuperação de memória
 * operacional.
 *
 * O QUE ISTO CONSERTA (estado anterior, medido em 10/09/2026):
 *  - `recordLearning` gravava em `memories` sem proveniência, sem dedup e sem noção de
 *    "isso ainda é verdade". 112 linhas ativas, nenhuma com origem rastreável.
 *  - toda mensagem podia virar memória, então "beleza, obrigado" tinha o mesmo peso que
 *    "a 3Net não quer linguagem técnica nos Reels".
 *  - fato atualizado NÃO invalidava o anterior: "responsável é o João" e "responsável
 *    mudou pra Maria" ficavam as duas ativas, e a recuperação pegava uma das duas por
 *    ordem de `updated_at`, o que na prática é aleatório pro usuário.
 *
 * O QUE ESTE MÓDULO NÃO FAZ (e por quê):
 *  - não detecta contradição SEMÂNTICA entre dois textos livres. Isso exigiria uma chamada
 *    de LLM por escrita, e a agência está sem crédito de LLM pago hoje. A supersessão aqui
 *    é DETERMINÍSTICA: quem escreve declara o `subject` (ex: `cliente:3net:responsavel`), e
 *    fato novo no mesmo subject aposenta o anterior. É menos esperto e muito mais
 *    previsível — e não inventa conflito onde não há.
 *  - não gera embedding. Não existe pgvector nem geração de embedding neste repo (a busca
 *    vetorial de verdade vive fora, no bento-qa). A recuperação aqui é por escopo + kind +
 *    subject + ordenação por importância, não por similaridade.
 */

export type MemorySourceType =
  | 'chat_message'
  | 'clickup_comment'
  | 'clickup_task'
  | 'whatsapp'
  | 'vault'
  | 'manual'
  | 'agent'
  | 'system';

export interface RememberInput {
  kind: string;
  content: string;
  /**
   * Identidade do FATO, não do texto. Dois textos diferentes sobre a mesma coisa
   * (`cliente:3net:tom-de-voz`) se substituem; textos sobre coisas diferentes convivem.
   * Sem subject, o fato é tratado como aditivo (nunca aposenta ninguém).
   */
  subject?: string | null;
  clientId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  sourceType: MemorySourceType;
  sourceId?: string | null;
  /** 0..1. Default por origem (ver DEFAULT_CONFIDENCE). */
  confidence?: number;
  /** 0..1. Default 0.5. */
  importance?: number;
  /** Fato temporário (ex: "cliente de férias até dia 20"). */
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export type RememberOutcome =
  /** Gravado como fato novo. */
  | { status: 'written'; memoryId: string }
  /** Já existia idêntico: só reconfirmado (lastVerifiedAt/confiança). */
  | { status: 'reconfirmed'; memoryId: string }
  /** Substituiu um fato anterior do mesmo subject. */
  | { status: 'superseded'; memoryId: string; supersededId: string }
  /** Descartado de propósito, com motivo. */
  | { status: 'skipped'; reason: string };

/**
 * Confiança padrão por origem. Evidência humana direta vale mais que inferência de
 * agente — é a diferença entre "o cliente escreveu isso" e "o modelo concluiu isso".
 */
const DEFAULT_CONFIDENCE: Record<MemorySourceType, number> = {
  manual: 0.95,
  clickup_comment: 0.9,
  chat_message: 0.85,
  whatsapp: 0.85,
  clickup_task: 0.8,
  vault: 0.8,
  system: 0.7,
  agent: 0.5,
};

const MIN_CONTENT_CHARS = 25;

/**
 * Frases que NÃO devem virar memória permanente. Não é lista de censura: é o filtro de
 * relevância do pipeline (§13). Confirmação social, agradecimento e resposta de uma
 * palavra não carregam fato operacional nenhum.
 */
const TRIVIAL_PATTERNS: RegExp[] = [
  /^(ok|okay|beleza|blz|valeu|vlw|obrigad[oa]|obg|tks|thanks|isso|isso ai|perfeito|show|top|legal|bom dia|boa tarde|boa noite|oi|ola|opa|e ai|entendi|certo|combinado|fechado|pode ser|sim|nao|não|uhum|ta bom|tá bom)[!.…\s]*$/i,
  /^(kd|cade|cadê|\?+)\s*$/i,
];

function normalizeForHash(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chave de dedup: mesmo CONTEÚDO, mesmo escopo => mesma chave.
 *
 * Deliberadamente NÃO inclui `subject`. Errei isso na primeira versão (incluí o subject) e
 * o teste de integração contra o banco real pegou: com o subject na chave, um fato NOVO
 * sobre o mesmo assunto colidia com o antigo, o pipeline tratava como "reconfirmação",
 * sobrescrevia o texto e a supersessão nunca rodava — o histórico do fato anterior era
 * perdido e a confiança subia como se duas fontes concordassem, quando na verdade elas
 * discordavam. A divisão correta é: dedup olha CONTEÚDO idêntico; supersessão olha mesmo
 * SUBJECT com conteúdo diferente.
 */
export function computeDedupeKey(input: {
  kind: string;
  content: string;
  clientId?: string | null;
  agentId?: string | null;
}): string {
  const base = [
    input.kind,
    input.clientId ?? 'no-client',
    input.agentId ?? 'no-agent',
    normalizeForHash(input.content),
  ].join('|');
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}

/** Vale guardar? Retorna o motivo do descarte, ou null se passou. */
export function relevanceRejection(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 'conteudo vazio';
  if (TRIVIAL_PATTERNS.some((p) => p.test(trimmed))) return 'confirmacao social, sem fato operacional';
  if (trimmed.length < MIN_CONTENT_CHARS) return `curto demais (${trimmed.length} < ${MIN_CONTENT_CHARS} chars)`;
  return null;
}

function clamp01(value: number | undefined, fallback: number): string {
  const n = value ?? fallback;
  return Math.max(0, Math.min(1, n)).toFixed(3);
}

/**
 * Pipeline de escrita: relevância -> dedup -> supersessão -> gravação.
 * NUNCA lança: memória é efeito colateral, não pode derrubar o turno do usuário.
 */
export async function rememberFact(input: RememberInput): Promise<RememberOutcome> {
  try {
    const rejection = relevanceRejection(input.content);
    if (rejection) return { status: 'skipped', reason: rejection };

    const dedupeKey = computeDedupeKey(input);
    const content = input.content.trim();
    const now = new Date();

    // 1. DEDUP — fato idêntico já registrado: reconfirma em vez de duplicar.
    const [existing] = await db
      .select({ id: schema.memories.id, confidence: schema.memories.confidence, sourceId: schema.memories.sourceId })
      .from(schema.memories)
      .where(eq(schema.memories.dedupeKey, dedupeKey));

    if (existing) {
      // Reconfirmação aumenta a confiança, com teto — duas fontes dizendo o mesmo é
      // evidência melhor que uma, mas nunca vira certeza absoluta. Só reforça quando a
      // fonte é OUTRA: a mesma pessoa repetindo a mesma frase não é evidência nova.
      const anterior = Number(existing.confidence ?? DEFAULT_CONFIDENCE[input.sourceType]);
      const fonteNova = (existing.sourceId ?? null) !== (input.sourceId ?? null);
      const reforcada = fonteNova ? Math.min(0.99, anterior + 0.02) : anterior;
      await db
        .update(schema.memories)
        .set({
          content,
          lastVerifiedAt: now,
          confidence: reforcada.toFixed(3),
          status: 'active',
          updatedAt: now,
        })
        .where(eq(schema.memories.id, existing.id));
      return { status: 'reconfirmed', memoryId: existing.id };
    }

    // 2. SUPERSESSÃO — fato novo sobre o MESMO subject aposenta o anterior.
    let supersededId: string | null = null;
    if (input.subject) {
      const anteriores = await db
        .select({ id: schema.memories.id })
        .from(schema.memories)
        .where(
          and(
            eq(schema.memories.kind, input.kind),
            eq(schema.memories.status, 'active'),
            sql`${schema.memories.metadata}->>'subject' = ${input.subject}`,
            input.clientId
              ? eq(schema.memories.clientId, input.clientId)
              : isNull(schema.memories.clientId),
          ),
        )
        .orderBy(desc(schema.memories.updatedAt));
      if (anteriores.length > 0) supersededId = anteriores[0]!.id;
    }

    const [written] = await db
      .insert(schema.memories)
      .values({
        kind: input.kind,
        content,
        clientId: input.clientId ?? null,
        agentId: input.agentId ?? null,
        userId: input.userId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        confidence: clamp01(input.confidence, DEFAULT_CONFIDENCE[input.sourceType]),
        importance: clamp01(input.importance, 0.5),
        status: 'active',
        lastVerifiedAt: now,
        expiresAt: input.expiresAt ?? null,
        dedupeKey,
        metadata: { ...(input.metadata ?? {}), ...(input.subject ? { subject: input.subject } : {}) },
      })
      .returning({ id: schema.memories.id });

    if (!written) return { status: 'skipped', reason: 'insert nao retornou linha' };

    if (supersededId) {
      await db
        .update(schema.memories)
        .set({ status: 'superseded', supersededBy: written.id, supersededAt: now, updatedAt: now })
        .where(eq(schema.memories.id, supersededId));
      logger.info(
        { memoryId: written.id, supersededId, subject: input.subject, kind: input.kind },
        'Fato atualizado: memoria anterior aposentada',
      );
      return { status: 'superseded', memoryId: written.id, supersededId };
    }

    return { status: 'written', memoryId: written.id };
  } catch (error) {
    logger.error({ error, kind: input.kind }, 'Falha ao gravar memoria (turno segue normalmente)');
    return { status: 'skipped', reason: `erro: ${(error as Error).message}` };
  }
}

export interface RecalledMemory {
  id: string;
  kind: string;
  content: string;
  clientId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  confidence: number | null;
  importance: number | null;
  subject: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface RecallQuery {
  clientId?: string | null;
  agentId?: string | null;
  /** Escopo M2 (user memory, seção 19/48 da spec V2): preferências e fatos
   * de um usuário nunca vazam pra outro. */
  userId?: string | null;
  kinds?: string[];
  limit?: number;
  /** Piso de importância — corta ruído em consulta de contexto apertada. */
  minImportance?: number;
}

/**
 * Recuperação: SÓ fato ativo e não expirado.
 *
 * Ordenação por importância e depois recência (não por similaridade — ver nota no topo).
 * O filtro de `status`/`expiresAt` é o que garante que fato aposentado nunca mais volta
 * pro prompt, que era o problema original de memória velha ganhando de dado novo.
 */
export async function recallMemories(query: RecallQuery): Promise<RecalledMemory[]> {
  // `now()` do Postgres em vez de bindar um Date: o driver (postgres.js) não aceita objeto
  // Date como parâmetro dentro de um template sql`` cru nesta posição, e isso estourava em
  // runtime (achado no teste de integração, não em typecheck).
  const conditions = [
    eq(schema.memories.status, 'active'),
    or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`)!,
  ];
  if (query.clientId) conditions.push(eq(schema.memories.clientId, query.clientId));
  if (query.agentId) conditions.push(eq(schema.memories.agentId, query.agentId));
  if (query.userId) conditions.push(eq(schema.memories.userId, query.userId));
  if (query.kinds?.length) {
    conditions.push(sql`${schema.memories.kind} = ANY(${sql.raw(`ARRAY['${query.kinds.map((k) => k.replace(/'/g, "''")).join("','")}']`)})`);
  }
  if (query.minImportance !== undefined) {
    conditions.push(sql`COALESCE(${schema.memories.importance}, 0.5) >= ${query.minImportance}`);
  }

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
    })
    .from(schema.memories)
    .where(and(...conditions))
    .orderBy(sql`COALESCE(${schema.memories.importance}, 0.5) DESC`, desc(schema.memories.updatedAt))
    .limit(query.limit ?? 10);

  return rows.map((row) => ({
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
  }));
}

/**
 * Manutenção: marca como `expired` o que passou de `expires_at`. Roda no scheduler.
 * Não apaga: fato expirado continua auditável, só sai da recuperação.
 */
export async function expireStaleMemories(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(schema.memories)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(schema.memories.status, 'active'), sql`${schema.memories.expiresAt} <= now()`))
    .returning({ id: schema.memories.id });
  if (rows.length > 0) logger.info({ count: rows.length }, 'Memorias expiradas');
  return rows.length;
}
