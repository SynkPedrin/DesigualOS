/**
 * memory-embeddings.test.ts — núcleo PURO da busca semântica: cosseno,
 * ranqueamento com threshold + top-k, merge/dedup por memory.id. Sem banco,
 * sem OpenAI (regra do repo: zero custo em teste) — a camada de banco é
 * coberta pelo teste de integração apps/worker/.../semantic-recall-trace.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
vi.mock('@desigual-os/openai-provider', () => ({
  EMBEDDING_MODEL: 'text-embedding-3-small',
  embedText: vi.fn(),
  embedBatch: vi.fn(),
}));
vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

import {
  SEMANTIC_MIN_SIMILARITY,
  SEMANTIC_TOP_K,
  cosineSimilarity,
  excludeMemoryIds,
  mergeSemanticResults,
  rankBySimilarity,
  type SemanticCandidate,
  type SemanticRecalledMemory,
} from './memory-embeddings';
import type { RecalledMemory } from './memory-engine';

function memoriaFake(id: string): RecalledMemory {
  return {
    id,
    kind: 'client.rule',
    content: `conteudo de ${id}`,
    clientId: 'client-x',
    sourceType: 'chat_message',
    sourceId: null,
    confidence: 0.9,
    importance: 0.8,
    subject: null,
    metadata: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };
}

function candidato(id: string, vector: number[]): SemanticCandidate {
  return { memory: memoriaFake(id), vector };
}

describe('cosineSimilarity', () => {
  it('vetores ortogonais => 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('vetor idêntico => 1', () => {
    expect(cosineSimilarity([0.5, -0.25, 0.75], [0.5, -0.25, 0.75])).toBeCloseTo(1, 10);
  });

  it('opostos => -1 (e o threshold positivo os corta no ranking)', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });

  it('dimensões diferentes => null (vetor de outro modelo nunca pontua errado)', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
  });

  it('vetor zero => null (norma zero não divide)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
  });
});

describe('rankBySimilarity — threshold + top-k com vetores sintéticos', () => {
  // Consulta = e1. Similaridades conhecidas: e1=1, e1e2 normalizado=1/√2≈0.707,
  // quase-ortogonal abaixo do piso, ortogonal=0, oposto=-1.
  const Q = [1, 0];
  const PARECIDO = [0.9, 0.1]; // cos ≈ 0.994
  const MEDIANO = [1, 1]; // cos ≈ 0.707
  const FRACO = [1, 2.4]; // cos ≈ 0.384 — acima do piso 0.35 por pouco
  const ABAIXO = [1, 3]; // cos ≈ 0.316 — abaixo do piso
  const ORTOGONAL = [0, 1];

  it('ordena por similaridade, corta abaixo do threshold e no top-k', () => {
    const ranking = rankBySimilarity(
      [
        candidato('ortogonal', ORTOGONAL),
        candidato('mediano', MEDIANO),
        candidato('abaixo-do-piso', ABAIXO),
        candidato('perfeito', Q),
        candidato('parecido', PARECIDO),
        candidato('fraco', FRACO),
      ],
      Q,
    );
    expect(ranking.map((m) => m.id)).toEqual(['perfeito', 'parecido', 'mediano', 'fraco']);
    expect(ranking[0]!.similarity).toBeCloseTo(1, 10);
    // Abaixo do piso 0.35 e ortogonais ficam de fora.
    expect(ranking.some((m) => m.id === 'abaixo-do-piso')).toBe(false);
    expect(ranking.some((m) => m.id === 'ortogonal')).toBe(false);
  });

  it('respeita limit customizado (top-k)', () => {
    const ranking = rankBySimilarity([candidato('a', Q), candidato('b', PARECIDO), candidato('c', MEDIANO)], Q, { limit: 2 });
    expect(ranking.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('threshold customizado: minSimilarity alta deixa só o quase idêntico', () => {
    const ranking = rankBySimilarity([candidato('a', Q), candidato('b', PARECIDO), candidato('c', MEDIANO)], Q, {
      minSimilarity: 0.999,
    });
    expect(ranking.map((m) => m.id)).toEqual(['a']);
  });

  it('candidato com vetor de dimensão errada é descartado, não rankeado', () => {
    const ranking = rankBySimilarity([candidato('dims-erradas', [1, 0, 0, 0]), candidato('certo', Q)], Q);
    expect(ranking.map((m) => m.id)).toEqual(['certo']);
  });

  it('defaults exportados são os do módulo', () => {
    expect(SEMANTIC_MIN_SIMILARITY).toBe(0.35);
    expect(SEMANTIC_TOP_K).toBe(5);
  });
});

describe('mergeSemanticResults — merge/dedup por memory.id', () => {
  const sem = (id: string, similarity: number): SemanticRecalledMemory => ({ ...memoriaFake(id), similarity });

  it('dedup por id ficando com a MAIOR similaridade, reordena e aplica top-k', () => {
    const merged = mergeSemanticResults([
      [sem('a', 0.9), sem('b', 0.5)],
      [sem('b', 0.8), sem('c', 0.7)],
    ]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(merged.find((m) => m.id === 'b')!.similarity).toBe(0.8);
  });

  it('corta no limite depois de ordenar', () => {
    const merged = mergeSemanticResults([[sem('a', 0.9), sem('b', 0.8), sem('c', 0.7)]], 2);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('listas vazias => vazio', () => {
    expect(mergeSemanticResults([[], []])).toEqual([]);
  });
});

describe('excludeMemoryIds — dedup contra o que outro bloco já entregou', () => {
  it('remove os ids já presentes no contexto, preservando a ordem', () => {
    const lista = [memoriaFake('a'), memoriaFake('b'), memoriaFake('c')];
    expect(excludeMemoryIds(lista, new Set(['b'])).map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('conjunto vazio é no-op', () => {
    const lista = [memoriaFake('a')];
    expect(excludeMemoryIds(lista, new Set())).toBe(lista);
  });
});
