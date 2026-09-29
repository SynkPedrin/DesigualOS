import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * statusView rico (§41 + painel): versions completo, nome do cliente,
 * campanha e resumo de assets.
 *
 * O drizzle é mockado como uma cadeia thenable que devolve resultados
 * enfileirados na ordem das consultas: banco de verdade aqui provaria o
 * Postgres, não o recorte que a função monta — que é o que a web consome.
 */

const consultas = vi.hoisted(() => ({
  sessao: [] as Record<string, unknown>[],
  renders: [] as Record<string, unknown>[],
  cliente: [] as Record<string, unknown>[],
  metadata: [] as Record<string, unknown>[],
}));

vi.mock('@desigual-os/database', () => {
  // Colunas só precisam EXISTIR pro eq()/asc() montarem o SQL; nada é executado.
  const tabela = new Proxy({}, { get: () => ({}) });
  const schema = new Proxy({}, { get: () => tabela });
  // O despacho é pelo SELECT e não pela ordem das chamadas: getMetadata é
  // awaitado por dentro e resolveria o thenable fora da ordem do Promise.all.
  const filaPara = (cols: Record<string, unknown> | undefined): Record<string, unknown>[] => {
    if (!cols) return consultas.sessao;
    const keys = Object.keys(cols);
    if (keys.includes('metadata')) return consultas.metadata;
    if (keys.includes('version')) return consultas.renders;
    return consultas.cliente;
  };
  const cadeia = (fila: Record<string, unknown>[]): unknown => {
    const cadeiaInterna: Record<string, unknown> = {
      from: () => cadeiaInterna,
      where: () => cadeiaInterna,
      orderBy: () => cadeiaInterna,
      limit: () => cadeiaInterna,
      then: (resolve: (valor: unknown) => void) => resolve(fila),
    };
    return cadeiaInterna;
  };
  return { db: { select: (cols?: Record<string, unknown>) => cadeia(filaPara(cols)) }, schema };
});

const { statusView } = await import('./sessions.js');

const sessionRow = {
  id: 'motion-1',
  clientId: 'cliente-1',
  conversationId: null,
  projectId: null,
  requestedBy: null,
  workspacePath: '/tmp/motion_motion-1',
  status: 'completed',
  stageDetail: null,
  prompt: 'vídeo da promoção',
  durationSeconds: 15,
  fps: 30,
  width: 1080,
  height: 1920,
  format: '9:16',
  model: 'claude-opus-5-5',
  renderVersion: 2,
  error: null,
  errorCode: null,
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-20T10:05:00Z'),
  metadata: {},
};

const renderRow = (version: number, quality: string, storageUrl: string | null, minuto: number) => ({
  version,
  quality,
  storageUrl,
  createdAt: new Date(`2026-09-20T10:${String(minuto).padStart(2, '0')}:00Z`),
});

beforeEach(() => {
  consultas.sessao = [];
  consultas.renders = [];
  consultas.cliente = [];
  consultas.metadata = [];
});

describe('statusView', () => {
  it('expõe versions ordenado, clientName, campaignName e assets, mantendo previewUrl/finalUrl na versão mais recente com arquivo', async () => {
    consultas.sessao = [sessionRow];
    consultas.renders = [
      renderRow(1, 'preview', 'https://storage/v1-preview.mp4', 1),
      renderRow(1, 'final', 'https://storage/v1-final.mp4', 2),
      renderRow(2, 'preview', null, 3),
      renderRow(2, 'final', 'https://storage/v2-final.mp4', 4),
    ];
    consultas.cliente = [{ name: 'Envu Engenharia' }];
    consultas.metadata = [
      {
        metadata: {
          brief: { campaignName: 'Promoção de Setembro' },
          assets_summary: { logo: true, images: 3, videos: 1 },
        },
      },
    ];

    const view = await statusView('motion-1');

    expect(view).not.toBeNull();
    // Compatibilidade: os campos que a web já consome continuam iguais.
    expect(view?.motionId).toBe('motion-1');
    expect(view?.status).toBe('completed');
    expect(view?.stage).toBe('Pronto');
    // previewUrl cai pra V1 porque o preview da V2 não subiu (url null);
    // finalUrl é o da V2.
    expect(view?.previewUrl).toBe('https://storage/v1-preview.mp4');
    expect(view?.finalUrl).toBe('https://storage/v2-final.mp4');

    expect(view?.versions).toHaveLength(4);
    expect(view?.versions.map((v) => [v.version, v.quality])).toEqual([
      [1, 'preview'],
      [1, 'final'],
      [2, 'preview'],
      [2, 'final'],
    ]);
    expect(view?.versions[2]?.url).toBeNull();
    expect(view?.versions[0]?.createdAt).toBeInstanceOf(Date);

    expect(view?.clientName).toBe('Envu Engenharia');
    expect(view?.campaignName).toBe('Promoção de Setembro');
    expect(view?.assets).toEqual({ logo: true, images: 3, videos: 1 });
  });

  it('sem briefing nem assets_summary, campaignName e assets são null — e versions vazio sem renders', async () => {
    consultas.sessao = [sessionRow];
    consultas.cliente = [{ name: 'Envu Engenharia' }];
    consultas.metadata = [{ metadata: {} }];

    const view = await statusView('motion-1');

    expect(view?.versions).toEqual([]);
    expect(view?.previewUrl).toBeNull();
    expect(view?.finalUrl).toBeNull();
    expect(view?.campaignName).toBeNull();
    expect(view?.assets).toBeNull();
  });

  it('assets_summary com shape errado não derruba o status — vira null', async () => {
    consultas.sessao = [sessionRow];
    consultas.cliente = [{ name: 'Envu Engenharia' }];
    consultas.metadata = [{ metadata: { brief: { campaignName: '  ' }, assets_summary: { logo: 'sim' } } }];

    const view = await statusView('motion-1');

    expect(view?.campaignName).toBeNull();
    expect(view?.assets).toBeNull();
  });

  it('retorna null quando a sessão não existe', async () => {
    expect(await statusView('motion-inexistente')).toBeNull();
  });
});
