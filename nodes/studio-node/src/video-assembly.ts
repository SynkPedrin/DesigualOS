import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import type { VideoOverlay } from './video-typography';

const exec = promisify(execFile);
const binary = (): string => {
  const path = process.env.STUDIO_FFMPEG_PATH || ffmpegStatic;
  if (!path) throw new Error('FFmpeg indisponível. Configure STUDIO_FFMPEG_PATH no Studio.');
  return path;
};

export async function checkVideoAssembler(): Promise<void> {
  await exec(binary(), ['-version'], { timeout: 10_000, maxBuffer: 1024 * 1024 });
}

/** Hard cuts, exact edit duration, one encode; no frame interpolation or fake upscaling. */
export function assemblyArguments(paths: string[], durations: number[], output: string, overlays: Array<{ path: string; startSeconds: number; endSeconds: number }> = []): string[] {
  if (!paths.length || paths.length !== durations.length || durations.some((n) => !Number.isFinite(n) || n <= 0 || n > 5)) {
    throw new Error('Lista de takes/durações inválida para montagem.');
  }
  const filters = paths.flatMap((_, index) => [
    `[${index}:v]trim=duration=${durations[index]},setpts=PTS-STARTPTS,fps=24,setsar=1,format=yuv420p[v${index}]`,
    `[${index}:a]apad,atrim=duration=${durations[index]},asetpts=PTS-STARTPTS,aresample=48000[a${index}]`,
  ]);
  filters.push(`${paths.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${paths.length}:v=1:a=1[v][a]`);
  let videoOutput = 'v';
  for (const [index, overlay] of overlays.entries()) {
    if (![overlay.startSeconds, overlay.endSeconds].every(Number.isFinite) || overlay.startSeconds < 0 || overlay.endSeconds <= overlay.startSeconds) throw new Error('Intervalo de overlay inválido.');
    const next = `vo${index}`;
    filters.push(`[${videoOutput}][${paths.length + index}:v]overlay=0:0:shortest=1:enable='between(t,${overlay.startSeconds},${overlay.endSeconds})'[${next}]`);
    videoOutput = next;
  }
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...paths.flatMap((path) => ['-i', path]), ...overlays.flatMap((overlay) => ['-loop', '1', '-i', overlay.path]), '-filter_complex', filters.join(';'),
    '-map', `[${videoOutput}]`, '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
}

export async function assembleVideoTakes(clips: Array<{ bytes: Buffer; seconds: number }>, overlays: VideoOverlay[] = []): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'studio-takes-'));
  try {
    const paths = clips.map((_, index) => join(directory, `take-${index}.mp4`));
    await Promise.all(clips.map((clip, index) => writeFile(paths[index]!, clip.bytes)));
    const output = join(directory, 'sequence.mp4');
    const overlayPaths = overlays.map((overlay, index) => ({ path: join(directory, `overlay-${index}.png`), startSeconds: overlay.startSeconds, endSeconds: overlay.endSeconds }));
    await Promise.all(overlays.map((overlay, index) => writeFile(overlayPaths[index]!.path, overlay.png)));
    await exec(binary(), assemblyArguments(paths, clips.map((clip) => clip.seconds), output, overlayPaths), { timeout: 180_000, maxBuffer: 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
