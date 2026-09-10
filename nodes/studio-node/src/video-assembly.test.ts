import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import { assemblyArguments, assembleVideoTakes, checkVideoAssembler } from './video-assembly';
import { renderVideoTypography } from './video-typography';

describe('video assembly', () => {
  it('trims the H3 grid padding without interpolating and exports seekable h264', () => {
    const args = assemblyArguments(['a.mp4', 'b.mp4'], [2, 3], 'out.mp4');
    expect(args.join(' ')).toContain('trim=duration=2');
    expect(args.join(' ')).toContain('concat=n=2:v=1:a=1');
    expect(args).toContain('+faststart');
    expect(args.join(' ')).not.toContain('minterpolate');
    expect(() => assemblyArguments(['a'], [Infinity], 'out')).toThrow();
  });
  it('assembles two real synthetic MP4 takes with audio locally, without GPU', async () => {
    await checkVideoAssembler();
    const directory = await mkdtemp(join(tmpdir(), 'studio-assembly-test-'));
    try {
      const input = join(directory, 'input.mp4');
      await promisify(execFile)(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x160:r=24',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
      const bytes = await readFile(input);
      const overlays = await renderVideoTypography({ width: 96, height: 160, seconds: 2, metadata: {
        video_text_overlays: [{ text: 'Tênis', start_seconds: 0, end_seconds: 1 }, { text: 'da vida', start_seconds: 1, end_seconds: 2 }],
      } });
      const output = await assembleVideoTakes([{ bytes, seconds: 1 }, { bytes, seconds: 1 }], overlays);
      expect(output.length).toBeGreaterThan(1000);
      expect(output.subarray(4, 8).toString()).toBe('ftyp');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
