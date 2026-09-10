import { describe, it, expect } from 'vitest';
import { buildProductionTakes, resolveVideoCanvas, plannedCarouselPrompt, shouldRenderHtmlCarousel } from './take-plan';

describe('production takes', () => {
  it('uses each scene prompt, continuity and motion without dropping the storyboard', () => {
    const takes = buildProductionTakes('generic', { video_plan: {
      duration: 7, scenes: [
        { image_prompt: 'portrait in navy light', duration_seconds: 3, continuity: 'same white shirt' },
        { image_prompt: 'macro racket strings', duration_seconds: 4, camera_movement: 'slow dolly' },
      ], generation_prompts: ['player breathes', 'ball contacts strings'],
    } });
    expect(takes.map((take) => take.seconds)).toEqual([3, 4]);
    expect(takes[0]!.imagePrompt).toContain('same white shirt');
    expect(takes[1]!.imagePrompt).toContain('macro racket strings');
    expect(takes[1]!.motionPrompt).toContain('ball contacts strings');
    expect(takes[1]!.motionPrompt).toContain('slow dolly');
    expect(takes[1]!.motionPrompt).not.toContain('No zoom');
  });
  it('splits long legacy jobs into bounded shots without shortening the requested duration', () => {
    const takes = buildProductionTakes('tractor', {}, 12);
    expect(takes.map((take) => take.seconds)).toEqual([4, 4, 4]);
  });
  it('rejects invalid duration and mismatched plans before GPU submission', () => {
    for (const duration of [NaN, Infinity, 0, -2, 81]) expect(() => buildProductionTakes('x', {}, duration)).toThrow();
    expect(() => buildProductionTakes('x', { video_plan: { duration: 5, scenes: [{}, {}], generation_prompts: ['x'] } })).toThrow();
  });
  it('does not let a preserve substring disable motion safeguards', () => {
    expect(buildProductionTakes('preserve texture', {})[0]!.motionPrompt).toContain('no morphing');
  });
  it('caps video area and snaps to the model grid without cropping landscape requests', () => {
    const canvas = resolveVideoCanvas(3840, 2160);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(768 * 1344);
    expect(canvas.width % 32).toBe(0);
    expect(canvas.height % 32).toBe(0);
    expect(canvas.width).toBeGreaterThan(canvas.height);
    expect(resolveVideoCanvas(1080, 1920, true)).toEqual({ width: 768, height: 1344 });
  });
  it('uses actual photographic slide prompts even when references exist', () => {
    const metadata = { carousel_plan: { slides: [{ image_prompt: 'macro tire rubber', composition: 'side light' }] } };
    expect(plannedCarouselPrompt(metadata, 0)).toContain('macro tire rubber');
    expect(shouldRenderHtmlCarousel(metadata, true)).toBe(false);
    expect(shouldRenderHtmlCarousel({ design: 'takes' }, true)).toBe(false);
    expect(shouldRenderHtmlCarousel({ design: 'html' }, true)).toBe(true);
  });
});
