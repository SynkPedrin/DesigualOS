import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMicrosoftCalendarAuthorizeUrl, listMicrosoftCalendars, refreshMicrosoftCalendarAccessToken } from './microsoft-calendar-oauth';

/**
 * microsoft-calendar-oauth.test.ts (03/11/2026): a agenda da Manada Filmes não aparecia. Duas causas cobertas aqui:
 * a lista de agendas parava nas 10 primeiras, e agenda compartilhada por outra conta precisa de
 * Calendars.ReadWrite.Shared, que não pode derrubar a renovação de quem ainda não tem o consentimento.
 */
const config = { clientId: 'cid', clientSecret: 'segredo', redirectUri: 'https://api.exemplo/cb', tenant: 'common' };

function resposta(status: number, corpo: unknown): Response {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });
}

function escopoPedido(chamada: unknown[]): string {
  return new URLSearchParams(String((chamada[1] as RequestInit).body)).get('scope') ?? '';
}

afterEach(() => vi.unstubAllGlobals());

describe('listMicrosoftCalendars', () => {
  it('segue o @odata.nextLink até a última página', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resposta(200, { value: [{ id: 'a', name: 'Calendário', isDefaultCalendar: true }], '@odata.nextLink': 'https://graph/proxima' }))
      .mockResolvedValueOnce(resposta(200, { value: [{ id: 'm', name: 'Manada Filmes' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const agendas = await listMicrosoftCalendars('token');

    expect(agendas.map((a) => a.name)).toEqual(['Calendário', 'Manada Filmes']);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('$top=100');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://graph/proxima');
  });
});

describe('permissão de agendas compartilhadas', () => {
  it('desligada, nem a conexão nem a renovação pedem Calendars.ReadWrite.Shared', async () => {
    expect(new URL(buildMicrosoftCalendarAuthorizeUrl(config, 'st')).searchParams.get('scope')).not.toContain('Shared');
    const fetchMock = vi.fn().mockResolvedValueOnce(resposta(200, { access_token: 'at' }));
    vi.stubGlobal('fetch', fetchMock);
    await refreshMicrosoftCalendarAccessToken(config, 'rt');
    expect(escopoPedido(fetchMock.mock.calls[0]!)).not.toContain('Shared');
  });

  it('ligada, a conexão pede a permissão de agendas compartilhadas', () => {
    const scope = new URL(buildMicrosoftCalendarAuthorizeUrl({ ...config, agendasCompartilhadas: true }, 'st')).searchParams.get('scope');
    expect(scope).toContain('Calendars.ReadWrite.Shared');
  });

  it('sem o consentimento ainda, renova com as permissões de antes em vez de expirar a conexão', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resposta(400, { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented' }))
      .mockResolvedValueOnce(resposta(200, { access_token: 'at', refresh_token: 'rt2' }));
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await refreshMicrosoftCalendarAccessToken({ ...config, agendasCompartilhadas: true }, 'rt');

    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt2' });
    expect(escopoPedido(fetchMock.mock.calls[0]!)).toContain('Calendars.ReadWrite.Shared');
    expect(escopoPedido(fetchMock.mock.calls[1]!)).not.toContain('Shared');
  });

  it('o AADSTS70000 de escopo não concedido também renova com as permissões de antes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resposta(400, { error: 'invalid_grant', error_description: 'AADSTS70000: The request was denied because one or more scopes requested are unauthorized or expired.' }))
      .mockResolvedValueOnce(resposta(200, { access_token: 'at' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshMicrosoftCalendarAccessToken({ ...config, agendasCompartilhadas: true }, 'rt')).resolves.toEqual({ accessToken: 'at', refreshToken: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('token revogado continua falhando (é o que faz a tela pedir para reconectar)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resposta(400, { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshMicrosoftCalendarAccessToken({ ...config, agendasCompartilhadas: true }, 'rt')).rejects.toThrow(/AADSTS700082/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
