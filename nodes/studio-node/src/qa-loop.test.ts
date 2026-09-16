import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runQualityLoop, QaLoopCancelledError, type QaAttemptOutput } from './qa-loop';
import type { CriticConfig } from './visual-critic';

const criticConfig: CriticConfig = { provider: 'ollama', ollamaUrl: 'http://critic.test', ollamaModel: 'test', timeoutMs: 1000 };

/** Resposta do Ollama com os scores pedidos, no formato que o adapter espera. */
function ollamaReply(scores: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      response: JSON.stringify({
        overall_score: 9, prompt_alignment: 9, composition: 9, lighting: 9, realism: 9,
        anatomy: 9, hands: 9, face: 9, text_integrity: 9, artifact_score: 9, commercial_quality: 9,
        problems: [], requires_regeneration: false, requires_local_edit: false, confidence: 0.9,
        ...scores,
      }),
    }),
  } as unknown as Response;
}

function baseParams(overrides: Partial<Parameters<typeof runQualityLoop>[0]> = {}) {
  return {
    briefing: 'tênis preto em superfície molhada',
    profile: 'standard' as const,
    maxAttempts: 3,
    identityCritical: false,
    productCritical: false,
    criticConfig,
    generate: vi.fn(async (attempt: number): Promise<QaAttemptOutput> => ({
      bytes: Buffer.from(`img-${attempt}`),
      generation: { seed: attempt },
    })),
    onStage: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('runQualityLoop', () => {
  it('para na primeira tentativa quando a peça já passa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ollamaReply({})));
    const params = baseParams();
    const result = await runQualityLoop(params as never);
    expect(result.attempts).toHaveLength(1);
    expect(result.finalDecision.action).toBe('approve');
    expect(params.generate).toHaveBeenCalledTimes(1);
  });

  it('corrige e melhora: tentativa 2 passa depois de uma reprovada', async () => {
    const replies = [ollamaReply({ overall_score: 5, composition: 3 }), ollamaReply({})];
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift()!));
    const params = baseParams();
    const result = await runQualityLoop(params as never);
    expect(result.attempts).toHaveLength(2);
    expect(result.finalDecision.action).toBe('approve');
    expect(result.chosen.attempt).toBe(2);
  });

  it('repassa a instrução de correção pra tentativa seguinte (e a primeira vem vazia)', async () => {
    const replies = [ollamaReply({ hands: 3, anatomy: 3 }), ollamaReply({})];
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift()!));
    const params = baseParams();
    await runQualityLoop(params as never);
    expect(params.generate).toHaveBeenNthCalledWith(1, 1, '');
    expect((params.generate as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]).toMatch(/hands/i);
  });

  it('respeita MAX_ATTEMPTS e devolve o MELHOR candidato, não o último', async () => {
    const replies = [
      ollamaReply({ overall_score: 8.1, composition: 3 }),
      ollamaReply({ overall_score: 8.8, composition: 3 }),
      ollamaReply({ overall_score: 8.4, composition: 3 }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift()!));
    const params = baseParams();
    const result = await runQualityLoop(params as never);
    expect(params.generate).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
    expect(result.chosen.attempt).toBe(2);
    expect(result.finalDecision.action).toBe('accept_best');
  });

  it('maxAttempts=1 gera uma vez só, mesmo reprovando', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ollamaReply({ overall_score: 2, composition: 1 })));
    const params = baseParams({ maxAttempts: 1 });
    const result = await runQualityLoop(params as never);
    expect(params.generate).toHaveBeenCalledTimes(1);
    expect(result.finalDecision.action).toBe('accept_best');
  });

  /** Seção 23: crítico fora do ar não pode falhar o job - a GPU já foi gasta. */
  it('entrega a peça quando o crítico está indisponível, e diz por quê', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const params = baseParams();
    const result = await runQualityLoop(params as never);
    expect(result.attempts).toHaveLength(1);
    expect(result.criticUnavailableReason).toMatch(/Ollama do crítico/);
    expect(result.chosen.critic.confidence).toBe(0);
  });

  it('nunca gera de novo quando o crítico caiu (não queima GPU às cegas)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const params = baseParams();
    await runQualityLoop(params as never);
    expect(params.generate).toHaveBeenCalledTimes(1);
  });

  it('cancela antes do próximo ciclo', async () => {
    const replies = [ollamaReply({ overall_score: 4, composition: 2 }), ollamaReply({})];
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift() ?? ollamaReply({})));
    let calls = 0;
    const params = baseParams({ isCancelled: vi.fn(async () => { calls += 1; return calls > 1; }) });
    await expect(runQualityLoop(params as never)).rejects.toBeInstanceOf(QaLoopCancelledError);
    expect(params.generate).toHaveBeenCalledTimes(1);
  });

  it('emite os estágios que o frontend já sabe pollar', async () => {
    const replies = [ollamaReply({ overall_score: 5, composition: 2 }), ollamaReply({})];
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift()!));
    const params = baseParams();
    await runQualityLoop(params as never);
    const stages = (params.onStage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(stages).toEqual(['generating', 'evaluating', 'refining', 'evaluating']);
  });
});
