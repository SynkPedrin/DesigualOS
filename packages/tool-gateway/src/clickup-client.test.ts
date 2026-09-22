import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeAttachmentUrl, createTask, getTeamMembers, uploadTaskAttachment } from './clickup-client';

/**
 * Cobertura do timeout de rede adicionado na auditoria de production
 * readiness (2026-09): todo fetch pro ClickUp sai com AbortSignal de 20s e
 * um estouro de timeout vira mensagem legível, porque os call sites (rotas
 * da API) só propagam error.message.
 */

const CONFIG = { apiKey: 'pk_fake', teamId: 'T1' };

afterEach(() => vi.unstubAllGlobals());

describe('timeout de rede nos fetches do ClickUp', () => {
  it('getTeamMembers sai com AbortSignal de timeout', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ team: { members: [] } }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getTeamMembers(CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('createTask também sai com signal (método POST, não só GETs)', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'abc', url: 'https://app.clickup.com/t/abc' }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createTask(CONFIG, { listId: 'L1', name: 'Tarefa' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout vira mensagem legível em pt-BR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
      }),
    );
    await expect(getTeamMembers(CONFIG)).rejects.toThrow(/não respondeu em 20s/);
  });

  it('erros que não são timeout seguem propagando intactos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(getTeamMembers(CONFIG)).rejects.toThrow('fetch failed');
  });
});

/**
 * P1-09 (release readiness audit, 22/09/2026): `uploadTaskAttachment`
 * recebia `fileUrl` de `z.string().url()` (validação de FORMATO, não de
 * DESTINO) e baixava de onde quer que apontasse — SSRF clássico: metadata de
 * nuvem, localhost, serviço interno. Anexo real deste sistema só existe no
 * nosso próprio Storage; a correção restringe a origem a isso.
 */
describe('assertSafeAttachmentUrl — SSRF: anexo só do nosso Storage', () => {
  const env = { SUPABASE_URL: 'https://xyzcompany.supabase.co' } as NodeJS.ProcessEnv;

  it('aceita URL do nosso bucket público de storage', () => {
    expect(() => assertSafeAttachmentUrl('https://xyzcompany.supabase.co/storage/v1/object/public/user-uploads/foo.png', env)).not.toThrow();
  });

  it.each([
    ['metadata de nuvem (AWS/GCP)', 'https://169.254.169.254/latest/meta-data/iam/security-credentials/'],
    ['localhost', 'https://localhost:5432/admin'],
    ['IP privado (rede interna)', 'https://10.0.0.5/internal-api'],
    ['outro host qualquer, mesmo https', 'https://attacker.example.com/payload'],
    ['nosso host mas fora do prefixo de storage público', 'https://xyzcompany.supabase.co/rest/v1/users'],
    ['nosso host mas com bucket certo NA QUERY, não no path (bypass tentando enganar startsWith)', 'https://attacker.example.com/x?u=https://xyzcompany.supabase.co/storage/v1/object/public/'],
  ])('rejeita %s', (_label, url) => {
    expect(() => assertSafeAttachmentUrl(url, env)).toThrow();
  });

  it('rejeita http:// mesmo que fosse o host certo — só https', () => {
    expect(() => assertSafeAttachmentUrl('http://xyzcompany.supabase.co/storage/v1/object/public/user-uploads/foo.png', env)).toThrow(/https/);
  });

  it('sem SUPABASE_URL configurada, falha fechado — nada passa', () => {
    expect(() => assertSafeAttachmentUrl('https://xyzcompany.supabase.co/storage/v1/object/public/user-uploads/foo.png', {} as NodeJS.ProcessEnv)).toThrow(/SUPABASE_URL/);
  });

  it('URL malformada não derruba o processo, só rejeita', () => {
    expect(() => assertSafeAttachmentUrl('não é uma url', env)).toThrow();
  });
});

describe('uploadTaskAttachment recusa SSRF antes de qualquer fetch', () => {
  const CONFIG_ATTACH = { apiKey: 'pk_fake', teamId: 'T1' };

  it('URL fora do Storage nunca chega a fazer fetch nenhum', async () => {
    const original = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://xyzcompany.supabase.co';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(uploadTaskAttachment(CONFIG_ATTACH, 'task-1', 'https://169.254.169.254/latest/meta-data/', 'x.png')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = original;
    }
  });
});
