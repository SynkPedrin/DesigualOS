import { describe, expect, it } from 'vitest';
import { enumerateDays } from './media-queries';

describe('enumerateDays', () => {
  it('inclui os dois extremos e os dias sem dado', () => {
    expect(enumerateDays({ since: '2026-10-28', until: '2026-11-02' })).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
  it('um dia só', () => {
    expect(enumerateDays({ since: '2026-10-01', until: '2026-10-01' })).toEqual(['2026-10-01']);
  });
});
