import { describe, expect, it } from 'vitest';
import { MOTION_FORMATS } from '../types.js';
import { SAFE_AREAS, safeInsets } from './index.js';

describe('safe areas (§20)', () => {
  it('9:16 reserva mais embaixo que em cima — a UI do Instagram ocupa o rodapé', () => {
    expect(SAFE_AREAS['9:16'].bottom).toBeGreaterThan(SAFE_AREAS['9:16'].top);
  });

  it('converte pra pixels no formato real de Stories', () => {
    expect(safeInsets('9:16', 1080, 1920)).toEqual({ top: 230, bottom: 269, left: 86, right: 86 });
  });

  it('os formatos de feed são simétricos', () => {
    const insets = safeInsets('1:1', 1080, 1080);
    expect(insets.top).toBe(insets.bottom);
    expect(insets.left).toBe(insets.right);
  });

  it('todo formato suportado tem safe area declarada', () => {
    // Comparado com MOTION_FORMATS, não com uma lista escrita à mão: assim
    // um formato novo em types.ts falha aqui em vez de render sem safe area.
    expect(Object.keys(SAFE_AREAS).sort()).toEqual(Object.keys(MOTION_FORMATS).sort());
  });
});
