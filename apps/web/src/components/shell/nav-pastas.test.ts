import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, NAV_SECTIONS } from './nav-items';

describe('pastas da barra lateral', () => {
  it('todo item mora numa pasta que existe (item órfão some da barra sem erro)', () => {
    const pastas = new Set(NAV_SECTIONS.map((s) => s.id));
    const orfaos = NAV_ITEMS.filter((i) => !pastas.has(i.section)).map((i) => i.href);
    expect(orfaos).toEqual([]);
  });

  it('só a pasta de entrada é fixa, e é a primeira', () => {
    expect(NAV_SECTIONS.filter((s) => s.fixa).map((s) => s.id)).toEqual(['hoje']);
    expect(NAV_SECTIONS[0]!.id).toBe('hoje');
  });

  it('nenhuma pasta fica vazia no cadastro (cada uma tem ao menos um item)', () => {
    for (const s of NAV_SECTIONS) {
      expect(NAV_ITEMS.some((i) => i.section === s.id), s.id).toBe(true);
    }
  });
});
