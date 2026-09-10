import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfyUIPromptLostError, generateImageViaComfyUI, type ComfyUIConfig } from './comfyui-client';

const config: ComfyUIConfig = {
  baseUrl: 'http://comfy.test',
  unetName: 'flux2.safetensors',
  clipName: 'mistral.safetensors',
  vaeName: 'flux2-vae.safetensors',
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const completedHistoryEntry = {
  status: { completed: true, status_str: 'success' },
  outputs: { save: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
};

/**
 * Achado real 09/09/2026: um worker morrendo entre o ComfyUI terminar a
 * imagem e o upload pro Supabase deixava a imagem órfã (GPU gasta, nada
 * salvo). Estes testes cobrem o contrato de resume que resolve isso: salvar
 * o prompt_id ANTES do polling (onSubmitted), reconhecer um prompt já
 * concluído sem re-submeter, e distinguir "ainda na fila" de "perdido de
 * verdade" (ComfyUI reiniciado).
 */
describe('generateImageViaComfyUI resume', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls onSubmitted with the prompt id before polling starts', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = url.toString();
      if (href.endsWith('/prompt')) return jsonResponse({ prompt_id: 'new-prompt-1' });
      if (href.includes('/history/new-prompt-1')) return jsonResponse({ 'new-prompt-1': completedHistoryEntry });
      if (href.includes('/view')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
      throw new Error(`unexpected fetch: ${href}`);
    });

    const onSubmitted = vi.fn();
    const result = await generateImageViaComfyUI(config, {
      prompt: 'a product photo',
      width: 1024,
      height: 1024,
      qualityProfile: 'standard',
      seed: 777,
      onSubmitted,
    });

    expect(onSubmitted).toHaveBeenCalledWith({ promptId: 'new-prompt-1', seed: 777, workflowId: 't2i_flux2_native_v2' });
    expect(result.bytes.byteLength).toBe(4);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/prompt'), expect.anything());
  });

  it('resumes a completed prompt without re-submitting to /prompt', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = url.toString();
      if (href.endsWith('/prompt')) throw new Error('should not re-submit a resumed prompt');
      if (href.includes('/history/saved-prompt-9')) return jsonResponse({ 'saved-prompt-9': completedHistoryEntry });
      if (href.includes('/view')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
      throw new Error(`unexpected fetch: ${href}`);
    });

    const result = await generateImageViaComfyUI(config, {
      prompt: 'a product photo',
      width: 1024,
      height: 1024,
      qualityProfile: 'standard',
      seed: 777,
      resume: { promptId: 'saved-prompt-9' },
    });

    expect(result.bytes.byteLength).toBe(4);
  });

  it('keeps polling a resumed prompt that is still queued on the server', async () => {
    let historyCalls = 0;
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = url.toString();
      if (href.endsWith('/prompt')) throw new Error('should not re-submit a resumed prompt');
      if (href.includes('/history/pending-prompt')) {
        historyCalls += 1;
        // Primeira leitura (findPromptState): ainda não tem entrada no /history.
        // Segunda leitura (pollHistory): já completou.
        return jsonResponse(historyCalls === 1 ? {} : { 'pending-prompt': completedHistoryEntry });
      }
      if (href.endsWith('/queue')) return jsonResponse({ queue_running: [[0, 'pending-prompt']], queue_pending: [] });
      if (href.includes('/view')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
      throw new Error(`unexpected fetch: ${href}`);
    });

    const result = await generateImageViaComfyUI(config, {
      prompt: 'a product photo',
      width: 1024,
      height: 1024,
      qualityProfile: 'standard',
      seed: 777,
      resume: { promptId: 'pending-prompt' },
    });

    expect(result.bytes.byteLength).toBe(4);
  });

  it('throws ComfyUIPromptLostError when the server no longer knows the resumed prompt', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = url.toString();
      if (href.includes('/history/gone-prompt')) return jsonResponse({});
      if (href.endsWith('/queue')) return jsonResponse({ queue_running: [], queue_pending: [] });
      throw new Error(`unexpected fetch: ${href}`);
    });

    await expect(
      generateImageViaComfyUI(config, {
        prompt: 'a product photo',
        width: 1024,
        height: 1024,
        qualityProfile: 'standard',
        seed: 777,
        resume: { promptId: 'gone-prompt' },
      }),
    ).rejects.toBeInstanceOf(ComfyUIPromptLostError);
  });
});
