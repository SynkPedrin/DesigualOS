import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSET_BUDGET, hasUsableVisuals, inferAssetKind, selectAssets } from './asset-index.js';
import type { MotionAsset } from './types.js';

function asset(overrides: Partial<MotionAsset> = {}): MotionAsset {
  return {
    kind: 'image',
    sourceUrl: `https://storage/${Math.random()}`,
    filename: 'foto.png',
    contentType: 'image/png',
    origin: 'studio_assets',
    ...overrides,
  };
}

describe('E — cliente sem assets (§47-E)', () => {
  it('seleção vazia não quebra', () => {
    expect(selectAssets([]).selected).toEqual([]);
  });

  it('reconhece que não há material visual utilizável', () => {
    expect(hasUsableVisuals([])).toBe(false);
    expect(hasUsableVisuals([asset({ kind: 'document' })])).toBe(false);
  });
});

describe('F — cliente com assets (§47-F, §31)', () => {
  it('reconhece material utilizável', () => {
    expect(hasUsableVisuals([asset({ kind: 'logo' })])).toBe(true);
  });

  it('a referência que a pessoa anexou vem antes de tudo', () => {
    const { selected } = selectAssets([
      asset({ kind: 'image' }),
      asset({ kind: 'logo', origin: 'client_brand_kits' }),
      asset({ kind: 'reference', origin: 'anexo do turno', filename: 'quero-assim.png' }),
    ]);
    expect(selected[0]?.filename).toBe('quero-assim.png');
  });

  it('o logo declarado da marca vem antes de foto gerada', () => {
    const { selected } = selectAssets([
      asset({ kind: 'image', filename: 'gerada.png' }),
      asset({ kind: 'logo', origin: 'client_brand_kits', filename: 'logo.png' }),
    ]);
    expect(selected[0]?.filename).toBe('logo.png');
  });

  it('corta no orçamento em vez de mandar o acervo inteiro pro Opus', () => {
    const muitas = Array.from({ length: 40 }, (_, index) => asset({ filename: `foto-${index}.png` }));
    const { selected, skipped } = selectAssets(muitas);
    expect(selected).toHaveLength(DEFAULT_ASSET_BUDGET.images);
    expect(skipped.length).toBe(40 - DEFAULT_ASSET_BUDGET.images);
    expect(skipped[0]?.reason).toContain('orçamento');
  });

  it('no empate, a maior resolução ganha — foto pequena esticada é o defeito mais comum', () => {
    const { selected } = selectAssets([
      asset({ filename: 'pequena.png', width: 400, height: 400 }),
      asset({ filename: 'grande.png', width: 3000, height: 4000 }),
    ]);
    expect(selected[0]?.filename).toBe('grande.png');
  });

  it('o mesmo arquivo não entra duas vezes', () => {
    const url = 'https://storage/mesma.png';
    const { selected, skipped } = selectAssets([
      asset({ sourceUrl: url, filename: 'a.png' }),
      asset({ sourceUrl: url, filename: 'b.png' }),
    ]);
    expect(selected).toHaveLength(1);
    expect(skipped[0]?.reason).toBe('duplicado');
  });

  it('a seleção é determinística — mesmo acervo, mesma escolha', () => {
    const acervo = [
      asset({ filename: 'a.png', width: 100, height: 100 }),
      asset({ filename: 'b.png', width: 200, height: 200 }),
      asset({ kind: 'video', filename: 'c.mp4', contentType: 'video/mp4' }),
    ];
    const primeira = selectAssets(acervo).selected.map((item) => item.filename);
    const segunda = selectAssets(acervo).selected.map((item) => item.filename);
    expect(primeira).toEqual(segunda);
  });
});

describe('inferAssetKind', () => {
  it('o logo do brand kit é logo por origem, mesmo sem "logo" no nome', () => {
    expect(inferAssetKind('image/png', 'marca-2026-final.png', 'client_brand_kits')).toBe('logo');
  });

  it('reconhece logo pelo nome do arquivo', () => {
    expect(inferAssetKind('image/png', 'LOGO-PRINCIPAL.png', 'studio_assets')).toBe('logo');
  });

  it.each([
    ['video/mp4', 'peca.mp4', 'video'],
    ['image/jpeg', 'foto.jpg', 'image'],
    ['font/ttf', 'WorkSans.ttf', 'font'],
    ['application/pdf', 'brandbook.pdf', 'document'],
  ])('%s -> %s', (contentType, filename, expected) => {
    expect(inferAssetKind(contentType, filename, 'studio_assets')).toBe(expected);
  });
});
