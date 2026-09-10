import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { compositeExactLogo } from './brand-compositor';

describe('exact brand compositor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not touch an in-scene logo because that belongs to model generation', async () => {
    const base = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#000000' } }).png().toBuffer();
    const output = await compositeExactLogo(base, { sourceUrl: 'https://example.com/logo.png', placement: 'in_scene' });
    expect(output).toBe(base);
  });

  it('places the supplied logo bytes on the requested canvas corner', async () => {
    const base = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#000000' } }).png().toBuffer();
    const logo = await sharp({ create: { width: 60, height: 20, channels: 4, background: '#ff0000' } }).png().toBuffer();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(logo), { status: 200, headers: { 'Content-Type': 'image/png' } }));

    const output = await compositeExactLogo(base, {
      sourceUrl: 'https://example.com/logo.png',
      placement: 'canvas_bottom_right',
      widthRatio: 0.3,
      marginRatio: 0.05,
    });
    const metadata = await sharp(output).metadata();
    const corner = await sharp(output).extract({ left: 130, top: 70, width: 60, height: 20 }).raw().toBuffer();

    expect(metadata).toMatchObject({ width: 200, height: 100 });
    expect(corner.some((value, index) => index % 4 === 0 && value > 200)).toBe(true);
  });
});
