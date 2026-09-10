import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderVideoTypography } from './video-typography';

describe('deterministic video typography', () => {
  it('renders original copy into real glyphs on transparent PNG layers', async () => {
    const overlays = await renderVideoTypography({ width: 384, height: 672, seconds: 5, metadata: {
      video_text_overlays: [{ text: 'Um outro ponto de vista', start_seconds: 0, end_seconds: 3 }, { text: 'da vida', start_seconds: 3, end_seconds: 5 }],
    } });
    expect(overlays).toHaveLength(2);
    expect(overlays[1]!.startSeconds).toBe(3);
    expect(await sharp(overlays[0]!.png).metadata()).toMatchObject({ width: 384, height: 672, hasAlpha: true });
  });
  it('rejects invalid time windows instead of silently omitting lettering', async () => {
    await expect(renderVideoTypography({ width: 96, height: 160, seconds: 5, metadata: {
      video_text_overlays: [{ text: 'logo', start_seconds: 4, end_seconds: 3 }],
    } })).rejects.toThrow('Intervalo');
  });
});
