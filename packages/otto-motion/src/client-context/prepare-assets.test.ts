import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@desigual-os/logging';
import { createWorkspace, destroyWorkspace, safeAssetName, type MotionWorkspace } from '../workspace/workspace.js';
import { prepareAssets } from './prepare-assets.js';
import type { MotionAsset } from './types.js';

const logger = createLogger({ service: 'motion-test' });
const criados: MotionWorkspace[] = [];

afterAll(async () => {
  for (const workspace of criados) await destroyWorkspace(workspace).catch(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function workspace(nome: string): Promise<MotionWorkspace> {
  const created = await createWorkspace(`assets-${nome}-${Date.now()}`);
  criados.push(created);
  return created;
}

function asset(overrides: Partial<MotionAsset> = {}): MotionAsset {
  return {
    kind: 'image',
    sourceUrl: 'https://storage.example/foto.png',
    filename: 'foto.png',
    contentType: 'image/png',
    origin: 'studio_assets',
    ...overrides,
  };
}

describe('§11 — o original do cliente nunca é tocado', () => {
  it('o que o agente enxerga é uma CÓPIA dentro do workspace', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from([1, 2, 3, 4])));
    const ws = await workspace('copia');
    const { assets } = await prepareAssets({ workspace: ws, assets: [asset()], logger });

    expect(assets[0]?.projectPath).toMatch(/^assets\//);
    expect(assets[0]?.localPath?.startsWith(ws.project)).toBe(true);
    await expect(fs.access(assets[0]!.localPath!)).resolves.toBeUndefined();
  });

  it('a cópia também fica no rastro do job, fora do projeto', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from([1, 2, 3, 4])));
    const ws = await workspace('rastro');
    const { assets } = await prepareAssets({ workspace: ws, assets: [asset()], logger });
    const nome = path.basename(assets[0]!.localPath!);
    await expect(fs.access(path.join(ws.assets, nome))).resolves.toBeUndefined();
  });
});

describe('N — asset ausente não derruba o job (§47-N)', () => {
  it('404 vira item na lista de falhas e a peça segue com o que existe', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('some') ? new Response('', { status: 404 }) : new Response(Buffer.from([1, 2, 3, 4])),
    );
    const ws = await workspace('faltando');
    const { assets, failed } = await prepareAssets({
      workspace: ws,
      assets: [asset({ sourceUrl: 'https://storage.example/some.png', filename: 'some.png' }), asset()],
      logger,
    });

    expect(assets).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.filename).toBe('some.png');
  });

  it('acervo inteiro fora do ar ainda devolve normalmente, sem exceção', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection refused');
    });
    const ws = await workspace('tudo-fora');
    const { assets, failed } = await prepareAssets({ workspace: ws, assets: [asset(), asset()], logger });
    expect(assets).toEqual([]);
    expect(failed).toHaveLength(2);
  });
});

describe('§52 — dois clientes não compartilham asset', () => {
  it('nomes iguais de URLs diferentes não colidem', () => {
    const a = safeAssetName('https://storage/cliente-a/logo.png', 'logo.png');
    const b = safeAssetName('https://storage/cliente-b/logo.png', 'logo.png');
    expect(a).not.toBe(b);
  });

  it('o mesmo arquivo gera sempre o mesmo nome — reimportar não duplica', () => {
    const url = 'https://storage/cliente/logo.png';
    expect(safeAssetName(url, 'logo.png')).toBe(safeAssetName(url, 'logo.png'));
  });

  it('nome hostil vira nome de arquivo seguro', () => {
    const nome = safeAssetName('https://x/y', '../../etc/passwd');
    expect(nome).not.toContain('/');
    expect(nome).not.toContain('..');
  });
});
