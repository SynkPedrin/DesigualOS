import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O banco é mockado por TABELA (mesmo padrão de resolve-client.test.ts no
 * context-engine): o que se prova aqui é a agregação — contagens por tipo,
 * reconhecimento do brain pelo sufixo ':brain' do subject e a degradação
 * quando o cliente não existe — não o SQL.
 */
const state = {
  client: null as { name: string } | null,
  kit: null as { logoUrl: string | null; colors: string[]; fonts: string[] } | null,
  assets: [] as { type: string; count: number }[],
  profiles: [] as { subject: string | null }[],
};

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, value: unknown) => ({ op: 'eq', value }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
  sql: () => ({ op: 'sql' }),
}));

vi.mock('@desigual-os/database', () => {
  const schema = {
    clients: { __table: 'clients' },
    clientBrandKits: { __table: 'client_brand_kits' },
    studioAssets: { __table: 'studio_assets' },
    memories: { __table: 'memories' },
  };
  const db = {
    select: () => ({
      from: (table: { __table: string }) => ({
        where: () => {
          if (table.__table === 'studio_assets') {
            return { groupBy: () => Promise.resolve(state.assets) };
          }
          return {
            limit: () =>
              Promise.resolve(
                table.__table === 'clients'
                  ? state.client
                    ? [state.client]
                    : []
                  : table.__table === 'client_brand_kits'
                    ? state.kit
                      ? [state.kit]
                      : []
                    : state.profiles,
              ),
          };
        },
      }),
    }),
  };
  return { db, schema };
});

const { summarizeClientContext } = await import('./summary');

beforeEach(() => {
  state.client = { name: 'Fratelli' };
  state.kit = { logoUrl: 'https://storage/logo.png', colors: ['#111111'], fonts: ['Work Sans'] };
  state.assets = [
    { type: 'image', count: 5 },
    { type: 'carousel', count: 2 },
    { type: 'video', count: 1 },
    { type: 'reels', count: 1 },
  ];
  state.profiles = [{ subject: 'fratelli:brain' }];
});

describe('summarizeClientContext', () => {
  it('resume marca, acervo e brain de um cliente completo', async () => {
    const summary = await summarizeClientContext('client-1');
    expect(summary).toEqual({
      clientName: 'Fratelli',
      hasBrandKit: true,
      logoUrl: 'https://storage/logo.png',
      colors: ['#111111'],
      fonts: ['Work Sans'],
      images: 7,
      videos: 2,
      totalAssets: 9,
      hasBrain: true,
    });
  });

  it('carrossel conta como imagem e reels como vídeo — é assim que o contentTypeFromUrl os trata', async () => {
    state.assets = [{ type: 'carousel', count: 3 }];
    const summary = await summarizeClientContext('client-1');
    expect(summary.images).toBe(3);
    expect(summary.videos).toBe(0);
    expect(summary.totalAssets).toBe(3);
  });

  it('tipos fora de imagem/vídeo entram no total mas não nas contagens visuais', async () => {
    state.assets = [{ type: 'document', count: 4 }];
    const summary = await summarizeClientContext('client-1');
    expect(summary).toMatchObject({ images: 0, videos: 0, totalAssets: 4 });
  });

  it('brain é reconhecido pelo SUFIXO :brain do subject, não pelo kind sozinho', async () => {
    state.profiles = [{ subject: 'fratelli:dossie' }, { subject: null }];
    const summary = await summarizeClientContext('client-1');
    expect(summary.hasBrain).toBe(false);
  });

  it('cliente sem nada: zeros e flags false, sem quebrar', async () => {
    state.kit = null;
    state.assets = [];
    state.profiles = [];
    const summary = await summarizeClientContext('client-1');
    expect(summary).toMatchObject({
      clientName: 'Fratelli',
      hasBrandKit: false,
      logoUrl: null,
      colors: [],
      fonts: [],
      images: 0,
      videos: 0,
      totalAssets: 0,
      hasBrain: false,
    });
  });

  it('cliente inexistente devolve clientName null — o chamador degrada pro texto genérico', async () => {
    state.client = null;
    const summary = await summarizeClientContext('nao-existe');
    expect(summary.clientName).toBeNull();
  });
});
