import { describe, expect, it } from 'vitest';
import { splitRange } from './media-sync';

describe('splitRange', () => {
  const today = new Date('2026-10-20T12:00:00Z');
  it('7 dias cabem numa janela só', () => {
    expect(splitRange(7, today)).toEqual([{ since: '2026-10-14', until: '2026-10-20' }]);
  });
  it('90 dias viram janelas de até 14, sem buraco e sem sobreposição', () => {
    const w = splitRange(90, today);
    expect(w.length).toBe(7);
    expect(w[0]!.since).toBe('2026-07-23');
    expect(w.at(-1)!.until).toBe('2026-10-20');
    for (let i = 1; i < w.length; i += 1) {
      const prevEnd = new Date(`${w[i - 1]!.until}T00:00:00Z`).getTime();
      const start = new Date(`${w[i]!.since}T00:00:00Z`).getTime();
      expect(start - prevEnd).toBe(86_400_000);
    }
  });
});
