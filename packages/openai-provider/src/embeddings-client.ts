import OpenAI from 'openai';
import { createLogger } from '@desigual-os/logging';
import { resolveOpenAICredential } from './credential.js';

const logger = createLogger({ service: 'openai-embeddings' });

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Cliente de embeddings (Embeddings API, não Responses API).
 *
 * Mesmas regras do responses-client.ts: credencial via `resolveOpenAICredential`,
 * injeção de fake em teste por `__setEmbeddingsClientForTest` (regra do repo:
 * zero custo OpenAI em teste). A diferença de contrato é de PROPÓSITO: aqui
 * falha NUNCA lança — embedding é enriquecimento (memória grava sem vetor e o
 * backfill cobre depois), então `embedText`/`embedBatch` devolvem `null` e o
 * chamador degrada. Quem decide se isso é fatal é o chamador.
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
/**
 * 512 em vez das 1536 nativas: metas do recall são dezenas de candidatos por
 * escopo, e o vetor mora em jsonb — vetor menor = linha menor, cosseno em JS
 * mais barato, custo por token igual.
 */
export const EMBEDDING_DIMENSIONS = 512;

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const { apiKey } = resolveOpenAICredential();
  cachedClient = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
  return cachedClient;
}

/** Só para teste: injeta um client fake e evita qualquer chamada de rede real. */
export function __setEmbeddingsClientForTest(client: OpenAI | null): void {
  cachedClient = client;
}

/**
 * Uma requisição para o lote inteiro (a Embeddings API aceita array de input).
 * Devolve os vetores NA MESMA ORDEM do input (o campo `index` da resposta é
 * respeitado, não assumido). `null` em qualquer falha — credencial ausente,
 * rede, 4xx/5xx — com warn logado.
 */
export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const ordenado = [...response.data].sort((a, b) => a.index - b.index);
    if (ordenado.length !== texts.length || ordenado.some((d) => !Array.isArray(d.embedding))) {
      logger.warn({ esperado: texts.length, recebido: ordenado.length }, 'Resposta de embeddings incompleta');
      return null;
    }
    return ordenado.map((d) => d.embedding);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), textos: texts.length },
      'Falha ao gerar embeddings (memória segue sem vetor; backfill cobre)',
    );
    return null;
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  const vectors = await embedBatch([text]);
  return vectors?.[0] ?? null;
}
