import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateVideoH3 } from './video-h3';

afterEach(() => vi.unstubAllGlobals());
const params = { baseUrl: 'http://comfy.test', image: Buffer.from('frame'), prompt: 'slow motion', width: 768, height: 1344, seconds: 3 };
const history = { status: { completed: true, status_str: 'success' }, outputs: { save: { videos: [{ filename: 'take.mp4', subfolder: 'video', type: 'output' }] } } };

describe('H3 durable submission', () => {
  it('persists the id and seed before polling and downloading', async () => {
    const events: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.endsWith('/upload/image')) return Response.json({ name: 'frame.png' });
      if (path.endsWith('/prompt')) { events.push('submit'); return Response.json({ prompt_id: 'p1' }); }
      if (path.includes('/history/')) { events.push('history'); return Response.json({ p1: history }); }
      if (path.includes('/view?')) return new Response(new Uint8Array([1, 2]));
      throw new Error(path);
    }));
    const onSubmitted = vi.fn(async () => { events.push('persist'); });
    await generateVideoH3({ ...params, seed: 42, onSubmitted });
    expect(onSubmitted).toHaveBeenCalledWith({ promptId: 'p1', seed: 42 });
    expect(events).toEqual(['submit', 'persist', 'history']);
  });
  it('resumes completed video without reuploading the frame or generating again', async () => {
    const fetch = vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.includes('/history/saved')) return Response.json({ saved: history });
      if (path.includes('/view?')) return new Response(new Uint8Array([1, 2]));
      throw new Error(`Unexpected generation: ${path}`);
    });
    vi.stubGlobal('fetch', fetch);
    expect(await generateVideoH3({ ...params, resumePromptId: 'saved' })).toEqual(Buffer.from([1, 2]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never globally interrupts another job on local timeout', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(generateVideoH3({ ...params, resumePromptId: 'saved', timeoutMs: 0 })).rejects.toThrow('retome pelo prompt_id');
    expect(fetch).not.toHaveBeenCalled();
  });
});
