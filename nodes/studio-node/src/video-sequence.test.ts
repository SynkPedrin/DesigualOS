import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateVideoSequence, type VideoSequenceParams } from './video-sequence';
import type { ResolvedReferenceAsset } from './reference-plan';

const mocks = vi.hoisted(() => ({ video: vi.fn(), master: vi.fn(), fetch: vi.fn(), assemble: vi.fn(), check: vi.fn() }));
vi.mock('./comfyui-client', () => ({ fetchWithRetry: mocks.fetch }));
vi.mock('./video-h3', () => ({
  generateVideoH3: mocks.video, generateVideoH3Master: mocks.master, H3_UNET_NAME: 'h3',
  snapLengthFrames: (seconds: number) => Math.ceil(seconds * 24 / 17) * 17 + 5,
  snapToH3Grid: (value: number) => Math.max(32, Math.floor(value / 32) * 32),
}));
vi.mock('./video-assembly', () => ({ assembleVideoTakes: mocks.assemble, checkVideoAssembler: mocks.check }));

beforeEach(() => vi.clearAllMocks());

async function setup() {
  const image = await sharp({ create: { width: 96, height: 160, channels: 3, background: '#123456' } }).png().toBuffer();
  mocks.fetch.mockImplementation(async () => new Response(new Uint8Array(image)));
  mocks.assemble.mockResolvedValue(Buffer.from('assembled'));
  const events: string[] = [];
  let saved: unknown;
  mocks.video.mockImplementation(async (params) => {
    events.push('video');
    await params.onSubmitted({ promptId: `p${events.length}`, seed: 42 });
    return Buffer.from('video');
  });
  const params: VideoSequenceParams = {
    jobId: 'test-job', type: 'reels', prompt: 'tennis editorial',
    metadata: { video_plan: { duration: 6, scenes: [{ image_prompt: 'portrait' }, { image_prompt: 'racket detail' }], generation_prompts: ['breathing', 'gentle movement'] } },
    stateMetadata: {}, width: 1080, height: 1920, baseUrl: 'http://comfy.test', spec: {}, references: [],
    withDirectives: (prompt) => prompt,
    generateFrame: vi.fn(async () => { events.push('frame'); return { bytes: image, model: 'flux2' }; }),
    persist: vi.fn(async (input) => ({ storageUrl: `https://storage.test/${input.filename}`, assetId: input.filename })),
    saveState: vi.fn(async (state) => { saved = structuredClone(state); }),
    progress: vi.fn(async () => {}),
  };
  return { params, events, getState: () => saved };
}

describe('video sequence orchestration', () => {
  it('generates all FLUX keyframes first, then clips, and saves a separate carousel and final movie', async () => {
    const { params, events, getState } = await setup();
    const result = await generateVideoSequence(params);
    expect(events).toEqual(['frame', 'frame', 'video', 'video']);
    expect(params.generateFrame).toHaveBeenNthCalledWith(2, 'take-frame-1', expect.stringContaining('racket detail'), expect.any(Number), expect.any(Number), expect.arrayContaining([expect.objectContaining({ role: 'subject' })]));
    expect(params.persist).toHaveBeenCalledWith(expect.objectContaining({ type: 'carousel', metadata: expect.objectContaining({ sequence_role: 'keyframe' }) }));
    expect(result.filename).toBe('test-job.mp4');
    expect(getState()).toMatchObject({ submissions: { 'draft-0': { seed: 42 } } });
    expect(mocks.assemble).toHaveBeenCalledWith([expect.objectContaining({ seconds: 3 }), expect.objectContaining({ seconds: 3 })], []);
  });
  it('reuses saved keyframes and clips on worker retry with no GPU calls', async () => {
    const { params, getState } = await setup();
    await generateVideoSequence(params);
    vi.mocked(params.generateFrame).mockClear();
    mocks.video.mockClear();
    await generateVideoSequence({ ...params, stateMetadata: { video_sequence: getState() } });
    expect(params.generateFrame).not.toHaveBeenCalled();
    expect(mocks.video).not.toHaveBeenCalled();
  });
  it('does not animate a logo or style reference as the entire scene', async () => {
    const { params } = await setup();
    const style: ResolvedReferenceAsset = { url: 'https://storage.test/style.png', filename: 'style.png', contentType: 'image/png', role: 'style', fidelity: 'interpretive', placement: 'reference_only' };
    await generateVideoSequence({ ...params, metadata: {}, references: [style] });
    expect(params.generateFrame).toHaveBeenCalledTimes(1);
  });
  it('keeps Master gated on explicit approval', async () => {
    const { params } = await setup();
    await expect(generateVideoSequence({ ...params, metadata: { ...params.metadata, video_stage: 'master' } })).rejects.toThrow('aprovação');
    expect(params.generateFrame).not.toHaveBeenCalled();
    expect(mocks.master).not.toHaveBeenCalled();
  });
});
