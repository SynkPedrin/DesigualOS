import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMetaAds } from './meta-oauth';

/**
 * `getMetaAds` é a primeira leitura do gateway que desce abaixo de CAMPANHA.
 *
 * Até 08/10/2026 o produto só sabia dizer quanto uma campanha gastou, nunca o
 * que a peça era — e mesmo assim o cartão de conexão prometia ao usuário que
 * "os agentes leem campanhas, criativos e resultados". Esta suíte trava as três
 * coisas que fazem a promessa valer: uma chamada só, a imagem do criativo
 * chegando junto, e ausência virando `null` em vez de número inventado.
 */

const TOKEN = 'tok';
const CONTA = 'act_123';

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (url: string | URL) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
    url: String(url),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function anuncio(extra: Record<string, unknown> = {}) {
  return {
    id: 'ad-1',
    name: 'Criativo Verão — vídeo 15s',
    status: 'ACTIVE',
    creative: { id: 'cr-1', thumbnail_url: 'https://meta.cdn/thumb.jpg', image_url: 'https://meta.cdn/full.jpg' },
    insights: { data: [{ spend: '1234.50', impressions: '98000', clicks: '420', ctr: '0.43' }] },
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getMetaAds', () => {
  it('pede anúncio, criativo e insights numa chamada só — nunca N+1', async () => {
    const fetchMock = stubFetch({ data: [anuncio()] });

    await getMetaAds(TOKEN, CONTA);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]![0]));
    expect(url).toContain('/act_123/ads');
    expect(url).toContain('creative{id,thumbnail_url,image_url}');
    expect(url).toContain('insights.date_preset(last_30d){spend,impressions,clicks,ctr}');
  });

  it('traz a imagem do criativo e os números do período', async () => {
    stubFetch({ data: [anuncio()] });

    const [ad] = await getMetaAds(TOKEN, CONTA);

    expect(ad).toMatchObject({
      id: 'ad-1',
      name: 'Criativo Verão — vídeo 15s',
      status: 'ACTIVE',
      thumbnailUrl: 'https://meta.cdn/thumb.jpg',
      imageUrl: 'https://meta.cdn/full.jpg',
      spend: 1234.5,
      impressions: 98000,
      clicks: 420,
      ctr: 0.43,
    });
  });

  /**
   * Anúncio de vídeo ou carrossel costuma vir sem `image_url`, e anúncio novo
   * vem sem `insights`. Nenhum dos dois é erro — e nenhum dos dois pode virar
   * zero, que é a mentira mais fácil de contar num painel de mídia.
   */
  it('ausência vira null, nunca zero', async () => {
    stubFetch({ data: [anuncio({ creative: { id: 'cr-2', thumbnail_url: 'https://meta.cdn/t.jpg' }, insights: undefined })] });

    const [ad] = await getMetaAds(TOKEN, CONTA);

    expect(ad!.imageUrl).toBeNull();
    expect(ad!.spend).toBeNull();
    expect(ad!.clicks).toBeNull();
    expect(ad!.thumbnailUrl).toBe('https://meta.cdn/t.jpg');
  });

  it('anúncio sem criativo nenhum não derruba a leitura', async () => {
    stubFetch({ data: [anuncio({ creative: null })] });

    const [ad] = await getMetaAds(TOKEN, CONTA);

    expect(ad!.thumbnailUrl).toBeNull();
    expect(ad!.imageUrl).toBeNull();
    expect(ad!.name).toBe('Criativo Verão — vídeo 15s');
  });

  /** Janela explícita (o relatório compara dois períodos) vira `time_range`. */
  it('aceita intervalo explícito além do preset', async () => {
    const fetchMock = stubFetch({ data: [] });

    await getMetaAds(TOKEN, CONTA, { since: '2026-09-01', until: '2026-09-30' });

    const url = decodeURIComponent(String(fetchMock.mock.calls[0]![0]));
    expect(url).toContain('time_range({"since":"2026-09-01","until":"2026-09-30"})');
  });

  /** Conta grande tem centenas de anúncios; nem a galeria nem o PDF usam isso. */
  it('manda um teto explícito de resultados', async () => {
    const fetchMock = stubFetch({ data: [] });

    await getMetaAds(TOKEN, CONTA, 'last_30d', 8);

    expect(decodeURIComponent(String(fetchMock.mock.calls[0]![0]))).toContain('limit=8');
  });

  it('erro HTTP propaga com o corpo, nunca devolve lista vazia como se fosse verdade', async () => {
    stubFetch({ error: { message: 'Invalid OAuth access token' } }, 401);

    await expect(getMetaAds(TOKEN, CONTA)).rejects.toThrow(/Meta ads lookup failed|401|Invalid OAuth/);
  });
});
