import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * O CONVITE QUE O PROVEDOR JOGA FORA RESPONDENDO 200.
 *
 * Achado no log da conta Resend em 08/10/2026. A sequência real:
 *
 *   13:01  convite para um endereço inexistente  -> `bounced`
 *   13:02  convite para o MESMO endereço         -> `suppressed`
 *
 * Depois de um bounce o Resend põe o endereço numa lista de supressão e
 * passa a DESCARTAR os envios seguintes — devolvendo 200, com id, como se
 * tivesse mandado. A API lia `response.ok`, respondia "status: invited", e a
 * tela dizia "convite enviado". Nada chegou nas duas vezes.
 *
 * O custo não foi só o silêncio. Como o único convite que de fato caiu numa
 * caixa de entrada naquele dia foi um endereçado ao próprio administrador, a
 * leitura virou "o sistema está mandando tudo pro meu e-mail" — um
 * diagnóstico que manda procurar o defeito no `to`, onde ele nunca esteve.
 *
 * Aqui o Supabase e o módulo de e-mail são mockados: o que está sob teste é a
 * decisão da ROTA diante do estado de entrega, não o Resend.
 */

const generateLink = vi.fn();
const sendInviteEmail = vi.fn();
const conferirEntrega = vi.fn();

vi.mock('@desigual-os/auth', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { generateLink: (...a: unknown[]) => generateLink(...a) } } }),
}));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'master-1', roles: ['master'], permissions: [{ resource: 'users', action: 'write' }] };
  },
  requirePermission: () => async () => {},
  requireRole: () => async () => {},
  invalidateUserAccessCache: vi.fn(),
}));

vi.mock('../lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/tenant-context')>()),
  requireTenant: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { organizationId: 'org-1' };
  },
}));

vi.mock('../lib/email', () => ({
  sendInviteEmail: (...a: unknown[]) => sendInviteEmail(...a),
  conferirEntrega: (...a: unknown[]) => conferirEntrega(...a),
  // O de verdade: é a regra que decide, e ela é barata o bastante pra não mockar.
  entregaFalhou: (evento: string | null) => evento === 'suppressed' || evento === 'bounced' || evento === 'failed',
}));

/**
 * Banco encadeável genérico: qualquer método devolve a si mesmo e qualquer
 * `await` resolve numa linha. A rota faz várias consultas depois do e-mail
 * (cria o usuário, o vínculo com a empresa, a auditoria) e nenhuma delas é o
 * que está sob teste aqui — mockar cada forma de query à mão só adicionaria
 * maneiras de o teste quebrar por motivo errado.
 */
function consulta(): unknown {
  const linhas = [{ id: 'novo-usuario', email: 'pessoa@real.com', name: null, active: true, role: 'colaborador' }];
  return new Proxy(() => consulta(), {
    get: (_alvo, prop) => (prop === 'then' ? (ok: (v: unknown) => void) => ok(linhas) : () => consulta()),
    apply: () => consulta(),
  });
}

vi.mock('@desigual-os/database', () => ({
  db: new Proxy({}, { get: () => () => consulta() }),
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => 'coluna' }) }),
}));

const { registerAdminRoutes } = await import('./routes');

async function convidar(email: string) {
  const app = Fastify();
  await registerAdminRoutes(app);
  return app.inject({ method: 'POST', url: '/admin/invite', payload: { email, role: 'colaborador' } });
}

/**
 * RECONVIDAR QUEM JÁ TEM CONTA.
 *
 * O Supabase recusa `type: 'invite'` para e-mail já registrado. Sem
 * tratamento, isso virava 500 "Internal Server Error" na tela — relatado em
 * 08/10/2026 ao tentar convidar alguém que já estava no sistema.
 *
 * Recusar é a resposta errada: há conta no banco com ZERO papéis e nenhum
 * vínculo, que entra e toma 403 em toda tela, e reconvidar é a única porta que
 * conserta isso. Medido no banco real depois do fix: papeis={} -> ["colaborador"].
 */
describe('POST /admin/invite — quem já tem conta é reconvidado, não recusado', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://projeto.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_fake';
    process.env.RESEND_API_KEY = 're_fake';
    process.env.RESEND_FROM_EMAIL = 'Desigual OS <noreply@agenciadesigual.com.br>';
    sendInviteEmail.mockReset().mockResolvedValue('envio-1');
    conferirEntrega.mockReset().mockResolvedValue('delivered');
    generateLink.mockReset().mockImplementation((args: { type: string }) =>
      args.type === 'invite'
        ? Promise.resolve({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } })
        : Promise.resolve({ data: { user: { id: 'auth-1' }, properties: { action_link: 'https://app/senha#token' } }, error: null }),
    );
  });

  it('e-mail já registrado vira link de recuperação, não erro', async () => {
    const res = await convidar('ja.existe@institutoalmada.org');

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('reinvited');
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recovery', email: 'ja.existe@institutoalmada.org' }),
    );
  });

  it('o e-mail sai mesmo assim — é por ele que a pessoa define a senha', async () => {
    await convidar('ja.existe@institutoalmada.org');
    expect(sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ja.existe@institutoalmada.org' }));
  });

  it('erro que NÃO é "já registrado" continua sendo recusa, não vira recuperação', async () => {
    generateLink.mockReset().mockResolvedValue({ data: { user: null }, error: { message: 'Invalid email address' } });

    const res = await convidar('torto@exemplo.com');

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid email');
    expect(generateLink).toHaveBeenCalledTimes(1);
  });
});

describe('POST /admin/invite — 200 do provedor não é entrega', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://projeto.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_fake';
    process.env.RESEND_API_KEY = 're_fake';
    process.env.RESEND_FROM_EMAIL = 'Desigual OS <noreply@agenciadesigual.com.br>';
    generateLink.mockReset().mockResolvedValue({
      data: { user: { id: 'auth-1' }, properties: { action_link: 'https://app/convite#token' } },
      error: null,
    });
    sendInviteEmail.mockReset().mockResolvedValue('envio-1');
    conferirEntrega.mockReset().mockResolvedValue('delivered');
  });

  it('endereço na lista de supressão: recusa em vez de dizer "convidado"', async () => {
    conferirEntrega.mockResolvedValue('suppressed');

    const res = await convidar('qa-convite-descartavel@agenciadesigual.com.br');

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('suppressed');
    // A mensagem tem que dizer o que fazer, não só que falhou.
    expect(res.json().error).toMatch(/lista de supressão/i);
  });

  it('bounce também não passa por sucesso', async () => {
    conferirEntrega.mockResolvedValue('bounced');
    expect((await convidar('nao-existe@agenciadesigual.com.br')).statusCode).toBe(502);
  });

  it('entrega normal segue em frente', async () => {
    const res = await convidar('pessoa@real.com');
    expect(res.statusCode).not.toBe(502);
    expect(sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'pessoa@real.com' }));
  });

  /**
   * O usuário já existe no Supabase Auth quando esta checagem roda. Se não
   * conseguimos saber o estado da entrega, o convite NÃO pode virar erro —
   * seria transformar uma incerteza nossa em falha de quem convidou.
   */
  it('estado de entrega desconhecido não derruba um convite já criado', async () => {
    conferirEntrega.mockResolvedValue(null);
    expect((await convidar('pessoa@real.com')).statusCode).not.toBe(502);
  });

  it('o endereço digitado é o que vai pro provedor — o `to` nunca foi reescrito', async () => {
    await convidar('alguem@outrodominio.com');
    expect(generateLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'alguem@outrodominio.com' }));
    expect(sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alguem@outrodominio.com' }));
  });
});
