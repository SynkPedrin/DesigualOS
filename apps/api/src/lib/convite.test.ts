import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A CADEIA DE ENVIO DO CONVITE DE EMPRESA, travada:
 *
 *   - com Resend configurado: generateLink no Supabase (sem e-mail padrão) +
 *     e-mail da marca via Resend (fetch mockado) — e o link volta na resposta;
 *   - com Resend QUEBRANDO: emailEnviado=false com motivo e link, nunca um
 *     envio fingido;
 *   - sem Resend: inviteUserByEmail (quem manda é o Supabase, sem marca);
 *   - sem Supabase configurado: emailEnviado=false, motivo claro, e nenhuma
 *     chamada externa.
 */

const mockGenerateLink = vi.fn();
const mockInviteUserByEmail = vi.fn();
const mockFetch = vi.fn();

vi.mock('@desigual-os/auth', () => ({
  getSupabaseAdminClient: () => ({
    auth: { admin: { generateLink: mockGenerateLink, inviteUserByEmail: mockInviteUserByEmail } },
  }),
}));

const { enviarConviteDeOrganizacao } = await import('./convite');

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  mockGenerateLink.mockReset();
  mockInviteUserByEmail.mockReset();
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);

  process.env.SUPABASE_URL = 'https://projeto.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'secret-de-teste';
  process.env.FRONTEND_URL = 'https://app.desigual.com';
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;

  mockGenerateLink.mockResolvedValue({
    data: { user: { id: 'supa-1' }, properties: { action_link: 'https://supabase/link-magico' } },
    error: null,
  });
  mockInviteUserByEmail.mockResolvedValue({ data: { user: { id: 'supa-2' } }, error: null });
  mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
  vi.unstubAllGlobals();
});

describe('enviarConviteDeOrganizacao', () => {
  it('com Resend configurado: gera o link no Supabase e manda o e-mail da marca via Resend', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    process.env.RESEND_FROM_EMAIL = 'convites@desigual.com';

    const r = await enviarConviteDeOrganizacao({ email: 'pessoa@cliente.com', papel: 'admin', nomeDaEmpresa: 'Empresa Alfa' });

    expect(r).toEqual({ emailEnviado: true, motivo: null, link: 'https://supabase/link-magico', supabaseUserId: 'supa-1' });
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invite',
        email: 'pessoa@cliente.com',
        options: expect.objectContaining({ redirectTo: expect.stringContaining('/convite?email=') }),
      }),
    );
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_teste' }),
      }),
    );
    const corpo = JSON.parse((mockFetch.mock.calls[0]?.[1] as { body: string }).body) as { to: string; html: string };
    expect(corpo.to).toBe('pessoa@cliente.com');
    expect(corpo.html).toContain('Empresa Alfa');
  });

  it('Resend quebrando NÃO finge envio: emailEnviado=false, motivo, e o link para envio manual', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    process.env.RESEND_FROM_EMAIL = 'convites@desigual.com';
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });

    const r = await enviarConviteDeOrganizacao({ email: 'pessoa@cliente.com', papel: 'collaborator', nomeDaEmpresa: 'Empresa Alfa' });

    expect(r.emailEnviado).toBe(false);
    expect(r.motivo).toContain('não saiu');
    expect(r.link).toBe('https://supabase/link-magico');
    expect(r.supabaseUserId).toBe('supa-1');
  });

  it('sem Resend: cai no e-mail padrão do Supabase (inviteUserByEmail), sem link local', async () => {
    const r = await enviarConviteDeOrganizacao({ email: 'pessoa@cliente.com', papel: 'collaborator', nomeDaEmpresa: 'Empresa Alfa' });

    expect(r).toEqual({ emailEnviado: true, motivo: null, link: null, supabaseUserId: 'supa-2' });
    expect(mockInviteUserByEmail).toHaveBeenCalled();
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sem Supabase configurado: emailEnviado=false com motivo, sem nenhuma chamada externa', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;

    const r = await enviarConviteDeOrganizacao({ email: 'pessoa@cliente.com', papel: 'collaborator', nomeDaEmpresa: 'Empresa Alfa' });

    expect(r).toEqual({ emailEnviado: false, motivo: expect.stringContaining('Supabase'), link: null, supabaseUserId: null });
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Supabase recusando o convite: emailEnviado=false com a mensagem dele, convite local segue criável', async () => {
    mockInviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'email rate limit exceeded' } });

    const r = await enviarConviteDeOrganizacao({ email: 'pessoa@cliente.com', papel: 'collaborator', nomeDaEmpresa: 'Empresa Alfa' });

    expect(r.emailEnviado).toBe(false);
    expect(r.motivo).toBe('email rate limit exceeded');
  });
});
