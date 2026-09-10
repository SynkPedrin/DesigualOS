import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import sharp from 'sharp';
import { generateImageViaComfyUI, resolveFluxModelNames } from '../src/comfyui-client';
import { generateVideoSequence } from '../src/video-sequence';

// Local validation only: no synthetic clients or jobs inserted into production.
const output = resolve(process.argv[3] ?? '../../artifacts/tennis-video-validation-2026-09-09');
const mode = process.argv[2] ?? 'keyframes';
const baseUrl = process.env.COMFYUI_URL ?? 'http://100.107.198.50:8188';
await mkdir(output, { recursive: true });
const statePath = resolve(output, 'validation-state.json');
let state: Record<string, any> = {};
try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const save = async () => writeFile(statePath, JSON.stringify(state, null, 2));
const server = createServer(async (request, response) => {
  const name = new URL(request.url ?? '/', 'http://localhost').pathname.slice(1);
  if (name !== basename(name) || !/^[a-z0-9-]+\.(png|mp4)$/.test(name)) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(resolve(output, name));
    response.writeHead(200, { 'content-type': name.endsWith('.png') ? 'image/png' : 'video/mp4' });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
const url = (name: string) => `http://127.0.0.1:${port}/${name}`;
// Refresh only validation-local URLs after restarting the file server.
const restoreUrls = (value: any): any => typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(value)
  ? url(new URL(value).pathname.slice(1)) : Array.isArray(value) ? value.map(restoreUrls)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreUrls(item)])) : value;
state = restoreUrls(state);

const concepts = [
  { id: 'tennis-portrait', reference: 'tennis-portrait.png',
    prompt: 'Create a NEW fictional adult male tennis athlete, clearly a DIFFERENT person from the reference: dark brown skin, close-shaved hair, broad jaw, short neat beard, athletic build. Waist-up editorial portrait with calm focused expression and a black racket resting at his hip. Plain unbranded forest-green technical polo, no cap. CHANGE the environment completely to a terracotta-colored indoor clay tennis court with warm ivory plaster arches, distant net softly out of focus and tall side windows. Warm late-afternoon directional light from camera left, subtle cooler fill, honest skin pores and tiny beads of sweat, individual beard hairs, sharply resolved polo knit, physically plausible contact shadows, soft highlight rolloff. Restrained premium sports photography, 85mm lens, realistic depth of field. Match only the reference photographic craft, NOT the original face, blue colors or background. All garments and equipment are blank: no letters, symbols, logos or signage; exact branding is composited later. Vertical 9:16, space above shoulder for brand signature.' },
  { id: 'tennis-ready', reference: 'tennis-ready.png',
    prompt: 'Create a NEW fictional adult female tennis athlete, clearly a DIFFERENT person from the reference: fair skin with visible freckles, auburn hair in a practical braid, hazel eyes, athletic build. Three-quarter upper-body ready stance with a dark graphite racket naturally held in both hands, correct five fingers on each hand, focused composed face looking just off camera. Plain unbranded burgundy performance tank and ivory skirt, no headband. CHANGE the environment to an outdoor terracotta clay tennis court beside an olive grove and low cream-stone clubhouse. Morning sunlight from upper left, rich defined contact shadows, accurate racket string mesh, tiny loose strands of hair, subtle skin sheen, detailed cloth weave, natural skin texture, believable anatomy. Premium photographic commercial, natural colors, no plastic smoothing, no over-sharpened edges. Keep only the reference editorial quality, not its person, blue stage or clothing. All clothing, racket and environment are blank without any text or logo; original brand signature is added in postproduction. Vertical 9:16 with readable negative space.' },
];

try {
  if (mode === 'keyframes') {
    // Recover the existing white signature as a graphic; never ask FLUX to spell it.
    const { data, info } = await sharp(resolve(output, 'tennis-endcard.png')).extract({ left: 80, top: 154, width: 418, height: 208 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) {
      const min = Math.min(data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!);
      const max = Math.max(data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!);
      rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = max - min < 35 ? Math.round(Math.min(1, Math.max(0, (min - 215) / 35)) * 255) : 0;
    }
    await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(resolve(output, 'top-tennis-original-signature.png'));
    const models = await resolveFluxModelNames(baseUrl, { unetHint: 'flux2', clipHint: 'flux2', vaeHint: 'flux2' });
    for (const concept of concepts) {
      const key = `${concept.id}-new`;
      if (state[key]?.done) { console.log(`reuse ${key}`); continue; }
      console.log(`generating ${key}`);
      const saved = state[key];
      const result = await generateImageViaComfyUI({ baseUrl, ...models }, {
        prompt: concept.prompt, width: 896, height: 1568, qualityProfile: 'master',
        referenceImages: [{ url: url(concept.reference), filename: concept.reference }],
        filenamePrefix: `desigual-tennis-validation-${key}`,
        ...(saved?.promptId ? { resume: { promptId: saved.promptId }, seed: saved.seed } : {}),
        onSubmitted: async (info) => { state[key] = info; await save(); console.log(`submitted ${key} ${info.promptId}`); },
      });
      await writeFile(resolve(output, `${key}.png`), result.bytes);
      state[key] = { ...state[key], done: true, generation: result.generation, prompt: concept.prompt };
      await save(); console.log(`saved ${key}`);
    }
  } else if (mode === 'videos' || mode === 'reassemble') {
    for (const concept of concepts) for (let variant = 1; variant <= 2; variant++) {
      const jobId = `${concept.id}-v${variant}`;
      if (state[jobId]?.done && mode !== 'reassemble') { console.log(`reuse ${jobId}`); continue; }
      if (mode === 'reassemble' && !state[jobId]?.sequence?.clips?.['draft-0']) throw new Error(`Take ainda não disponível para recompor: ${jobId}`);
      const inputName = `${concept.id}-new.png`;
      await readFile(resolve(output, inputName));
      const prompt = variant === 1
        ? 'Single locked-camera editorial tennis portrait. The athlete breathes naturally, subtly settles the shoulders and gives a tiny confident change of expression. Hands and racket remain steady. Background still. Retain the exact new character, forest-green or burgundy clothing, clay-court environment and sunlight of the input. No speech; very quiet natural court ambience.'
        : 'Single slow controlled camera push-in, only a very small forward dolly. The athlete slowly turns their gaze a few degrees toward the camera while keeping the racket stable. Natural breathing, detailed skin and fabric, stable morning or afternoon side lighting from the input. No sudden motion, no new elements, no letters generated, no speech; quiet natural tennis court ambience.';
      console.log(`generating ${jobId}`);
      const result = await generateVideoSequence({
        jobId, type: 'reels', prompt, duration: 5, width: 768, height: 1344, baseUrl,
        metadata: { video_text_overlays: [
          { text: 'Um outro ponto de vista', start_seconds: 0.25, end_seconds: 2.5 },
          { text: 'do esporte', start_seconds: 2.5, end_seconds: 3.6 },
          { text: 'da vida', start_seconds: 3.6, end_seconds: 5 },
        ] },
        stateMetadata: { video_sequence: state[jobId]?.sequence }, spec: {},
        references: [{ url: url(inputName), filename: inputName, contentType: 'image/png', role: 'scene', fidelity: 'high', placement: 'reference_only' }],
        logo: { sourceUrl: url('top-tennis-original-signature.png'), placement: 'canvas_top_left', widthRatio: 0.26, marginRatio: 0.045 },
        withDirectives: (text) => text,
        generateFrame: async () => { throw new Error('Validation uses the approved NEW keyframe; unexpected regeneration.'); },
        persist: async (input) => {
          await writeFile(resolve(output, input.filename), input.content);
          await writeFile(resolve(output, `${input.filename}.json`), JSON.stringify(input.metadata, null, 2));
          console.log(`saved ${input.filename}`);
          return { storageUrl: url(input.filename), assetId: input.filename };
        },
        saveState: async (sequence) => { state[jobId] = { ...state[jobId], sequence }; await save(); console.log(`checkpoint ${jobId}`); },
        progress: async (percent) => { console.log(`${jobId} ${percent}%`); },
      });
      state[jobId] = { ...state[jobId], done: true, result }; await save();
    }
  } else throw new Error('Use keyframes, videos or reassemble.');
} finally { server.close(); }
