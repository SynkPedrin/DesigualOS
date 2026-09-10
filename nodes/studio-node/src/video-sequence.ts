import sharp from 'sharp';
import type { CreativeSpec } from '@desigual-os/types';
import { fetchWithRetry } from './comfyui-client';
import { compileFlux2Prompt } from './prompt-quality';
import type { ResolvedReferenceAsset } from './reference-plan';
import { buildProductionTakes, resolveVideoCanvas } from './take-plan';
import { generateVideoH3, generateVideoH3Master, H3_UNET_NAME, snapLengthFrames } from './video-h3';
import { checkVideoAssembler, assembleVideoTakes } from './video-assembly';
import { renderVideoTypography } from './video-typography';
import type { BrandLogoComposition } from './brand-compositor';

interface SavedMedia { storageUrl: string; assetId: string; filename: string }
interface TakeState {
  frames: Record<string, SavedMedia>;
  clips: Record<string, SavedMedia>;
  submissions: Record<string, { promptId: string; seed: number }>;
}
interface PersistInput {
  type: string;
  model: string;
  filename: string;
  content: Buffer;
  contentType: string;
  metadata: Record<string, unknown>;
}

export interface VideoSequenceParams {
  jobId: string;
  type: string;
  prompt: string;
  duration?: number | null;
  metadata: Record<string, unknown>;
  stateMetadata: Record<string, unknown>;
  width: number;
  height: number;
  baseUrl: string;
  spec: CreativeSpec;
  references: ResolvedReferenceAsset[];
  logo?: BrandLogoComposition;
  withDirectives: (prompt: string) => string;
  generateFrame: (key: string, prompt: string, width: number, height: number, references: ResolvedReferenceAsset[]) => Promise<{ bytes: Buffer; model: string }>;
  persist: (input: PersistInput) => Promise<{ storageUrl: string; assetId: string }>;
  saveState: (state: TakeState) => Promise<void>;
  progress: (percent: number) => Promise<void>;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Não foi possível recuperar o take/frame salvo (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

/** All FLUX keyframes first, then all H3 clips: avoids swapping huge models per take. */
export async function generateVideoSequence(params: VideoSequenceParams): Promise<SavedMedia> {
  const takes = buildProductionTakes(params.prompt, params.metadata, params.duration);
  const canvas = resolveVideoCanvas(params.width, params.height, params.type === 'reels');
  // Fail before GPU work if the local editing dependency is missing.
  await checkVideoAssembler();
  const overlays = await renderVideoTypography({ ...canvas, seconds: takes.reduce((sum, take) => sum + take.seconds, 0), metadata: params.metadata, ...(params.logo ? { logo: params.logo } : {}) });
  const saved = params.stateMetadata.video_sequence as Partial<TakeState> | undefined;
  const state: TakeState = { frames: { ...saved?.frames }, clips: { ...saved?.clips }, submissions: { ...saved?.submissions } };
  const master = params.metadata.video_stage === 'master';
  if (master && params.metadata.draft_approved_for_master !== true) throw new Error('A versão Master precisa de aprovação explícita do rascunho.');
  const stage = master ? 'master' : 'draft';
  const model = master ? 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' : H3_UNET_NAME;
  const metadata = { source_job_id: params.jobId, quality_reference: 'editorial-takes-v1', visual_qa: 'pending_review' };
  const frameScenes = [...new Map(takes.map((take) => [take.sceneIndex, take])).values()];
  const existingScene = params.references.find((ref) => ref.role === 'scene');

  for (const [position, take] of frameScenes.entries()) {
    const key = String(take.sceneIndex);
    if (!state.frames[key]) {
      let bytes: Buffer;
      let frameModel: string;
      let finalPrompt = '';
      // A single supplied scene can be animated directly, never a logo/style swatch.
      const directScene = !params.metadata.video_plan && params.references.length === 1 && existingScene;
      if (directScene) {
        bytes = await sharp(await download(directScene.url)).rotate().png().toBuffer();
        frameModel = 'original-reference';
      } else {
        const references = [...params.references];
        const anchor = state.frames[String(frameScenes[0]!.sceneIndex)];
        if (anchor && references.length < 10) references.push({
          url: anchor.storageUrl, filename: anchor.filename, contentType: 'image/png',
          role: 'subject', fidelity: 'high', placement: 'reference_only',
          instruction: 'Continuity anchor for identity, wardrobe and color treatment only; obey the new shot framing, not the anchor composition.',
        });
        const frameSpec: CreativeSpec = { ...params.spec, operation: references.length ? 'edit' : 'generate', contentType: 'image' };
        finalPrompt = params.withDirectives(compileFlux2Prompt({ prompt: take.imagePrompt, spec: frameSpec, references }).prompt);
        // Same high-resolution still pipeline as images; H3 downscales only its input.
        const scale = Math.max(1, Math.sqrt(1_500_000 / (canvas.width * canvas.height)));
        const frame = await params.generateFrame(`take-frame-${key}`, finalPrompt,
          Math.round(canvas.width * scale / 16) * 16, Math.round(canvas.height * scale / 16) * 16, references);
        bytes = frame.bytes;
        frameModel = frame.model;
      }
      const filename = `${params.jobId}-keyframe-${key}.png`;
      const asset = await params.persist({ type: 'carousel', model: frameModel, filename, content: bytes, contentType: 'image/png',
        metadata: { ...metadata, job_id: `${params.jobId}-keyframes`, slide_index: position, slides_total: frameScenes.length,
          sequence_role: 'keyframe', scene_index: take.sceneIndex, final_prompt: finalPrompt,
          reference_urls: params.references.map((ref) => ref.url) } });
      state.frames[key] = { ...asset, filename };
      await params.saveState(state);
    }
    await params.progress(10 + Math.round((position + 1) / frameScenes.length * 30));
  }

  const clips: Array<{ bytes: Buffer; seconds: number }> = [];
  for (const take of takes) {
    const key = `${stage}-${take.index}`;
    const frame = state.frames[String(take.sceneIndex)]!;
    let bytes: Buffer;
    if (state.clips[key]) {
      bytes = await download(state.clips[key]!.storageUrl);
    } else {
      const submission = state.submissions[key];
      const generate = master ? generateVideoH3Master : generateVideoH3;
      // Explicit contain resize avoids silently cropping a real scene when animating it.
      const input = submission ? Buffer.alloc(0) : await sharp(await download(frame.storageUrl)).resize(canvas.width, canvas.height, { fit: 'contain', background: '#000000' }).png().toBuffer();
      // Installed H3 declares a trained range starting at 124 frames (~5s).
      // Short editorial cuts are trimmed at assembly, not sampled below that range.
      bytes = await generate({ baseUrl: params.baseUrl, image: input, prompt: take.motionPrompt, ...canvas, seconds: Math.max(5, take.seconds),
        filenamePrefix: `video/desigual-os-${params.jobId}-${key}`,
        ...(submission ? { resumePromptId: submission.promptId, seed: submission.seed } : {}),
        onSubmitted: async (info) => { state.submissions[key] = info; await params.saveState(state); },
      });
      const filename = `${params.jobId}-${key}.mp4`;
      const asset = await params.persist({ type: params.type, model, filename, content: bytes, contentType: 'video/mp4',
        metadata: { ...metadata, job_id: `${params.jobId}-takes`, sequence_role: 'take', slide_index: take.index, slides_total: takes.length,
          quality_stage: stage, seconds: snapLengthFrames(Math.max(5, take.seconds)) / 24, edit_seconds: take.seconds,
          fps: 24, resolution: `${canvas.width}x${canvas.height}`, hero_frame: frame.storageUrl,
          final_prompt: take.motionPrompt, seed: state.submissions[key]?.seed, comfy_prompt_id: state.submissions[key]?.promptId } });
      state.clips[key] = { ...asset, filename };
      await params.saveState(state);
    }
    clips.push({ bytes, seconds: take.seconds });
    await params.progress(40 + Math.round((take.index + 1) / takes.length * 50));
  }

  const content = await assembleVideoTakes(clips, overlays);
  const filename = `${params.jobId}.mp4`;
  const asset = await params.persist({ type: params.type, model, filename, content, contentType: 'video/mp4', metadata: {
    ...metadata, job_id: params.jobId, sequence_role: 'assembled', quality_stage: stage,
    slides_total: 1, slide_index: 0, takes_total: takes.length, seconds: takes.reduce((sum, take) => sum + take.seconds, 0),
    fps: 24, resolution: `${canvas.width}x${canvas.height}`, keyframes: Object.values(state.frames), takes: Object.values(state.clips),
    editing: 'hard cuts; native take audio; no interpolation', typography_status: overlays.length ? 'composited_after_generation' : 'not_requested',
    exact_logo_composited: Boolean(params.logo?.placement.startsWith('canvas_')), text_overlay_count: overlays.length,
  } });
  return { ...asset, filename };
}
