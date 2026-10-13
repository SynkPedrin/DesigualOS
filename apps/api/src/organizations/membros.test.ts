import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import type * as escopoModule from '../lib/escopo-de-organizacao';

/**
 * AS REGRAS DE MEMBROS E CONVITES DE EMPRESA, travadas nas rotas:
 *
 *   - convite org-bound cria pendente, recusa duplicado, reenvia e revoga;
 *   - e-mail que JÁ tem conta vira membro na hora (sem link mágico), com o
 *     convite gravado como aceito — o rastro de quem colocou a pessoa;
 *   - troca de papel e remoção com as duas guardas: único dono intocável e
 *     admin não mexe em dono;
 *   - empresa alheia responde 404 em TODOS os endpoints, nunca 403;
 *   - colaborador não gerencia (403), provedor gerencia e fica marcado na
 *     auditoria como acting_as_provider.
 *
 * Fastify real com banco e escopo mockados (mesmo padrão de
 * clickup/routes.test.ts e organizations/routes.test.ts): o banco é um
 * conjunto de arrays em memória e o `where` é resolvido por inspeção dos
 * parâmetros embutidos na condição drizzle.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';
const DONO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLAB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEGUNDO_DONO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROVEDOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SEM_CONTA_EMAIL = 'novo@cliente.com';
const EXISTENTE = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; // tem conta, não é membro

interface MembroRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}
interface UsuarioRow {
  id: string;
  email: string;
  name: string;
  active: boolean;
  authUserId: string | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  organizacaoAtivaId: string | null;
}
interface ConviteRow {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  invitedByUserId: string | null;
  supabaseUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let mockEscopo: { organizationIds: string[]; ehProvider: boolean };
let orgs: { id: string; name: string }[];
let members: MembroRow[];
let usuarios: UsuarioRow[];
let convites: ConviteRow[];
let auditRows: Array<Record<string, unknown>>;
let proximoId = 0;

const mockEnviarConvite = vi.fn();
const mockAvisoAdicao = vi.fn();

vi.mock('@desigual-os/database', () => {
  const organizations = { id: 'organizations.id', name: 'organizations.name' };
  const organizationMembers = {
    id: 'om.id',
    organizationId: 'om.organization_id',
    userId: 'om.user_id',
    role: 'om.role',
    createdAt: 'om.created_at',
  };
  const users = {
    id: 'users.id',
    email: 'users.email',
    name: 'users.name',
    active: 'users.active',
    authUserId: 'users.auth_user_id',
    lastSeenAt: 'users.last_seen_at',
    deletedAt: 'users.deleted_at',
    organizacaoAtivaId: 'users.organizacao_ativa_id',
  };
  const organizationInvites = {
    id: 'oi.id',
    organizationId: 'oi.organization_id',
    email: 'oi.email',
    role: 'oi.role',
    status: 'oi.status',
    invitedByUserId: 'oi.invited_by_user_id',
    supabaseUserId: 'oi.supabase_user_id',
    createdAt: 'oi.created_at',
  };
  const auditLogs = { id: 'audit.id' };

  /** Todos os valores string embutidos numa condição drizzle (eq/and/sql). */
  const coletarParams = (no: unknown, achados: string[] = []): string[] => {
    if (typeof no === 'string') {
      achados.push(no);
      return achados;
    }
    if (Array.isArray(no)) {
      for (const item of no) coletarParams(item, achados);
      return achados;
    }
    if (no === null || typeof no !== 'object') return achados;
    if ('value' in no && !Array.isArray((no as { value: unknown }).value)) {
      coletarParams((no as { value: unknown }).value, achados);
    }
    const chunks = (no as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) for (const c of chunks) coletarParams(c, achados);
    return achados;
  };

  const STATUS = new Set(['pendente', 'aceito', 'revogado']);

  function filtrar(table: unknown, cond: unknown): unknown[] {
    const params = coletarParams(cond);
    if (table === organizations) return orgs.filter((o) => params.includes(o.id));
    if (table === organizationMembers) {
      const orgIds = params.filter((p) => orgs.some((o) => o.id === p));
      const userIds = params.filter((p) => usuarios.some((u) => u.id === p));
      const memberIds = params.filter((p) => members.some((m) => m.id === p));
      // Cópias, nunca referências: o banco real não devolve o objeto que um
      // UPDATE posterior muta — e a rota lê `alvo.role` depois do update.
      return members
        .filter(
          (m) =>
            (orgIds.length === 0 || orgIds.includes(m.organizationId)) &&
            (userIds.length === 0 || userIds.includes(m.userId)) &&
            (memberIds.length === 0 || memberIds.includes(m.id)),
        )
        .map((m) => ({ ...m }));
    }
    if (table === users) {
      return usuarios.filter((u) => params.includes(u.id) || params.includes(u.email.toLowerCase()));
    }
    if (table === organizationInvites) {
      const orgIds = params.filter((p) => orgs.some((o) => o.id === p));
      const inviteIds = params.filter((p) => convites.some((c) => c.id === p));
      const status = params.filter((p) => STATUS.has(p));
      return convites
        .filter(
          (c) =>
            (orgIds.length === 0 || orgIds.includes(c.organizationId)) &&
            (inviteIds.length === 0 || inviteIds.includes(c.id)) &&
            (status.length === 0 || status.includes(c.status)) &&
            params.every((p) => !p.includes('@') || c.email === p.toLowerCase()),
        )
        .map((c) => ({ ...c }));
    }
    return [];
  }

  const insert = (table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      if (table === organizationMembers) {
        const row: MembroRow = {
          id: `membro-${++proximoId}`,
          organizationId: v.organizationId as string,
          userId: v.userId as string,
          role: (v.role as string) ?? 'collaborator',
          createdAt: new Date(),
        };
        members.push(row);
        return { onConflictDoNothing: () => Promise.resolve(undefined), returning: () => Promise.resolve([row]) };
      }
      if (table === organizationInvites) {
        // A rede de segurança do índice parcial (org, email) WHERE pendente.
        if (
          (v.status as string) === 'pendente' &&
          convites.some(
            (c) => c.organizationId === v.organizationId && c.email === v.email && c.status === 'pendente',
          )
        ) {
          return {
            returning: () => Promise.reject(new Error('duplicate key value violates unique constraint "organization_invites_pendente_unique"')),
          };
        }
        const row: ConviteRow = {
          id: `convite-${++proximoId}`,
          organizationId: v.organizationId as string,
          email: v.email as string,
          role: v.role as string,
          status: v.status as string,
          invitedByUserId: (v.invitedByUserId as string) ?? null,
          supabaseUserId: (v.supabaseUserId as string) ?? null,
          acceptedAt: (v.acceptedAt as Date) ?? null,
          revokedAt: null,
          createdAt: new Date(),
        };
        convites.push(row);
        return { returning: () => Promise.resolve([row]) };
      }
      if (table === auditLogs) {
        auditRows.push(v);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    },
  });

  return {
    db: {
      insert,
      select: (_cols?: unknown) => ({
        from: (table: unknown) => {
          const porWhere = (cond: unknown) => {
            const linhas = filtrar(table, cond);
            // O GET de convites pendentes seleciona colunas com apelido
            // (papel, convidado_em); o mock projeta como o drizzle faria.
            if (table === organizationInvites && _cols !== null && typeof _cols === 'object' && 'papel' in (_cols as Record<string, unknown>)) {
              return Promise.resolve(
                (linhas as ConviteRow[]).map((c) => ({ id: c.id, email: c.email, papel: c.role, status: c.status, convidado_em: c.createdAt })),
              );
            }
            return Promise.resolve(linhas);
          };
          return {
            where: porWhere,
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (cond: unknown) => {
                const vinculos = filtrar(organizationMembers, cond) as MembroRow[];
                const linhas = vinculos.map((m) => {
                  const u = usuarios.find((x) => x.id === m.userId);
                  return {
                    id: u?.id,
                    nome: u?.name,
                    email: u?.email,
                    papel: m.role,
                    ativa: u?.active,
                    ultimo_acesso: u?.lastSeenAt ?? null,
                    membro_desde: m.createdAt,
                  };
                });
                return Promise.resolve(linhas);
              },
            }),
          };
        },
      }),
      update: (table: unknown) => ({
        set: (v: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            const params = coletarParams(cond);
            if (table === organizationMembers) {
              for (const m of members) if (params.includes(m.id)) Object.assign(m, v);
            }
            if (table === organizationInvites) {
              for (const c of convites) if (params.includes(c.id)) Object.assign(c, v);
            }
            if (table === users) {
              const ids = params.filter((p) => usuarios.some((u) => u.id === p));
              const orgIds = params.filter((p) => orgs.some((o) => o.id === p));
              for (const u of usuarios) {
                if (ids.includes(u.id) && (orgIds.length === 0 || u.organizacaoAtivaId === null || orgIds.includes(u.organizacaoAtivaId))) {
                  Object.assign(u, v);
                }
              }
            }
            return Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve([]) });
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: (cond: unknown) => {
          const params = coletarParams(cond);
          if (table === organizationMembers) {
            const alvo = members.filter((m) => params.includes(m.id));
            members = members.filter((m) => !params.includes(m.id));
            return Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve(alvo) });
          }
          return Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve([]) });
        },
      }),
    },
    schema: { organizations, organizationMembers, users, organizationInvites, auditLogs },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
  requirePermission: () => async () => {},
}));

vi.mock('../lib/escopo-de-organizacao', async (importOriginal) => {
  const actual = await importOriginal<typeof escopoModule>();
  return { ...actual, escopoDeOrganizacao: () => Promise.resolve(mockEscopo) };
});

vi.mock('../lib/convite', () => ({
  enviarConviteDeOrganizacao: (params: unknown) => mockEnviarConvite(params),
}));

vi.mock('../lib/email', () => ({
  sendAddedToOrganizationEmail: (params: unknown) => mockAvisoAdicao(params),
  sendInviteEmail: vi.fn(),
}));

const { registerOrganizationMemberRoutes } = await import('./membros');

async function buildApp() {
  const app = Fastify();
  // O server real traduz ZodError para 400 (server.ts); o Fastify pelado do
  // teste responderia 500, escondendo exatamente o contrato que se quer travar.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: error.issues.map((i) => i.message).join(' ') });
      return;
    }
    void reply.code(500).send({ error: error.message });
  });
  await registerOrganizationMemberRoutes(app);
  return app;
}

function membro(userId: string, role: string, orgId = ORG): MembroRow {
  return { id: `vinculo-${userId.slice(0, 4)}-${orgId.slice(0, 4)}`, organizationId: orgId, userId, role, createdAt: new Date('2026-10-01T00:00:00Z') };
}

function usuario(id: string, email: string, extra: Partial<UsuarioRow> = {}): UsuarioRow {
  return { id, email, name: email.split('@')[0] ?? email, active: true, authUserId: `auth-${id.slice(0, 4)}`, lastSeenAt: null, deletedAt: null, organizacaoAtivaId: null, ...extra };
}

beforeEach(() => {
  proximoId = 0;
  auditRows = [];
  mockEnviarConvite.mockReset().mockResolvedValue({ emailEnviado: true, motivo: null, link: 'https://link-do-supabase/convite', supabaseUserId: 'supa-novo' });
  mockAvisoAdicao.mockReset().mockResolvedValue(undefined);

  orgs = [
    { id: ORG, name: 'Empresa Alfa' },
    { id: OUTRA, name: 'Empresa Vizinha' },
  ];
  usuarios = [
    usuario(DONO, 'dono@alfa.com'),
    usuario(ADMIN, 'admin@alfa.com'),
    usuario(COLAB, 'colab@alfa.com', { lastSeenAt: new Date('2026-10-04T10:00:00Z') }),
    usuario(SEGUNDO_DONO, 'dono2@alfa.com'),
    usuario(PROVEDOR, 'provedor@desigual.com'),
    usuario(EXISTENTE, 'existente@fora.com'),
  ];
  members = [membro(DONO, 'owner'), membro(ADMIN, 'admin'), membro(COLAB, 'collaborator')];
  convites = [];

  currentUser = { id: DONO, roles: ['colaborador'], permissions: [] };
  mockEscopo = { organizationIds: [ORG], ehProvider: false };
});

describe('POST /organizations/:id/invites', () => {
  it('e-mail sem conta: cria convite pendente org-bound, com papel, e envia pelo fluxo Supabase/Resend', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'collaborator' } });

    expect(res.statusCode).toBe(201);
    const corpo = res.json();
    expect(corpo).toMatchObject({ email: SEM_CONTA_EMAIL, papel: 'collaborator', status: 'pendente', membro_criado: false, email_enviado: true, link: 'https://link-do-supabase/convite' });
    expect(mockEnviarConvite).toHaveBeenCalledWith(expect.objectContaining({ email: SEM_CONTA_EMAIL, papel: 'collaborator', nomeDaEmpresa: 'Empresa Alfa' }));
    expect(convites).toHaveLength(1);
    expect(convites[0]).toMatchObject({ organizationId: ORG, email: SEM_CONTA_EMAIL, role: 'collaborator', status: 'pendente', invitedByUserId: DONO, supabaseUserId: 'supa-novo' });
    expect(auditRows).toContainEqual(expect.objectContaining({ action: 'convite.criado', organizationId: ORG }));
  });

  it('e-mail em caixa alta é normalizado para minúsculo na gravação', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: 'NOVO@Cliente.com', role: 'admin' } });

    expect(res.statusCode).toBe(201);
    expect(convites[0]?.email).toBe('novo@cliente.com');
  });

  it('convite pendente duplicado para o mesmo e-mail é recusado (409)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'collaborator' } });

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'admin' } });

    expect(res.statusCode).toBe(409);
    expect(convites).toHaveLength(1);
  });

  it('e-mail que JÁ tem conta vira membro na hora, convite gravado como aceito, sem link mágico', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: 'existente@fora.com', role: 'admin' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'aceito', membro_criado: true, link: null });
    expect(mockEnviarConvite).not.toHaveBeenCalled();
    expect(members.some((m) => m.userId === EXISTENTE && m.organizationId === ORG && m.role === 'admin')).toBe(true);
    expect(convites[0]).toMatchObject({ status: 'aceito', email: 'existente@fora.com' });
    expect(mockAvisoAdicao).toHaveBeenCalledWith(expect.objectContaining({ to: 'existente@fora.com', organizationName: 'Empresa Alfa' }));
    expect(auditRows).toContainEqual(expect.objectContaining({ action: 'member.added', organizationId: ORG }));
  });

  it('adicionar quem já é membro é 409, não vínculo duplicado', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: 'colab@alfa.com', role: 'admin' } });

    expect(res.statusCode).toBe(409);
  });

  it('falha no envio NÃO finge sucesso: convite pendente criado e email_enviado=false com motivo e link', async () => {
    mockEnviarConvite.mockResolvedValue({ emailEnviado: false, motivo: 'Resend fora do ar', link: 'https://link-manual', supabaseUserId: 'supa-novo' });
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'collaborator' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email_enviado: false, motivo: 'Resend fora do ar', link: 'https://link-manual', status: 'pendente' });
    expect(convites).toHaveLength(1);
  });

  it('provedor convidando fica marcado na auditoria como acting_as_provider', async () => {
    currentUser = { id: PROVEDOR, roles: ['master'], permissions: [] };
    mockEscopo = { organizationIds: [], ehProvider: true };
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'collaborator' } });

    expect(res.statusCode).toBe(201);
    expect(auditRows).toContainEqual(
      expect.objectContaining({ action: 'convite.criado', metadata: expect.objectContaining({ acting_as_provider: true }) }),
    );
  });

  it('papel fora de owner/admin/collaborator é 400', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'master' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /organizations/:id/members', () => {
  it('dono lista membros com papel e último acesso, e os convites pendentes, sem vazar outra empresa', async () => {
    members.push(membro(SEGUNDO_DONO, 'owner', OUTRA));
    usuarios.push(usuario('99999999-9999-4999-8999-999999999999', 'vizinho@outra.com'));
    convites.push(
      { id: '10101010-1010-4101-8101-101010101010', organizationId: ORG, email: SEM_CONTA_EMAIL, role: 'collaborator', status: 'pendente', invitedByUserId: DONO, supabaseUserId: null, acceptedAt: null, revokedAt: null, createdAt: new Date() },
      { id: '20202020-2020-4202-8202-202020202020', organizationId: OUTRA, email: 'outro@la.com', role: 'admin', status: 'pendente', invitedByUserId: null, supabaseUserId: null, acceptedAt: null, revokedAt: null, createdAt: new Date() },
      { id: '30303030-3030-4303-8303-303030303030', organizationId: ORG, email: 'ja@foi.com', role: 'collaborator', status: 'aceito', invitedByUserId: DONO, supabaseUserId: null, acceptedAt: new Date(), revokedAt: null, createdAt: new Date() },
    );
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${ORG}/members` });

    expect(res.statusCode).toBe(200);
    const { membros, convites_pendentes } = res.json();
    expect(membros).toHaveLength(3);
    expect(membros.map((m: { email: string }) => m.email).sort()).toEqual(['admin@alfa.com', 'colab@alfa.com', 'dono@alfa.com']);
    const colab = membros.find((m: { email: string }) => m.email === 'colab@alfa.com');
    expect(colab).toMatchObject({ papel: 'collaborator', ativa: true, ultimo_acesso: '2026-10-04T10:00:00.000Z' });
    expect(convites_pendentes).toHaveLength(1);
    expect(convites_pendentes[0]).toMatchObject({ id: '10101010-1010-4101-8101-101010101010', email: SEM_CONTA_EMAIL, papel: 'collaborator' });
  });

  it('colaborador NÃO gerencia a lista (403)', async () => {
    currentUser = { id: COLAB, roles: ['colaborador'], permissions: [] };
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${ORG}/members` });

    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /organizations/:id/members/:userId', () => {
  it('dono promove colaborador a admin, com auditoria de/para', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${COLAB}`, payload: { role: 'admin' } });

    expect(res.statusCode).toBe(200);
    expect(members.find((m) => m.userId === COLAB)?.role).toBe('admin');
    expect(auditRows).toContainEqual(
      expect.objectContaining({ action: 'member.role_changed', metadata: expect.objectContaining({ de: 'collaborator', para: 'admin' }) }),
    );
  });

  it('o ÚNICO dono não pode ser rebaixado, empresa sem dono é conta que ninguém administra', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${DONO}`, payload: { role: 'collaborator' } });

    expect(res.statusCode).toBe(409);
    expect(members.find((m) => m.userId === DONO)?.role).toBe('owner');
  });

  it('com SEGUNDO dono, rebaixar um deles passa', async () => {
    members.push(membro(SEGUNDO_DONO, 'owner'));
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${DONO}`, payload: { role: 'admin' } });

    expect(res.statusCode).toBe(200);
    expect(members.find((m) => m.userId === DONO)?.role).toBe('admin');
  });

  it('admin NÃO rebaixa dono, mesmo havendo outro dono', async () => {
    members.push(membro(SEGUNDO_DONO, 'owner'));
    currentUser = { id: ADMIN, roles: ['colaborador'], permissions: [] };
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${DONO}`, payload: { role: 'collaborator' } });

    expect(res.statusCode).toBe(403);
  });

  it('admin promove colaborador normalmente', async () => {
    currentUser = { id: ADMIN, roles: ['colaborador'], permissions: [] };
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${COLAB}`, payload: { role: 'admin' } });

    expect(res.statusCode).toBe(200);
  });

  it('provedor rebaixa dono quando há outro dono, e a auditoria marca acting_as_provider', async () => {
    members.push(membro(SEGUNDO_DONO, 'owner'));
    currentUser = { id: PROVEDOR, roles: ['master'], permissions: [] };
    mockEscopo = { organizationIds: [], ehProvider: true };
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${DONO}`, payload: { role: 'admin' } });

    expect(res.statusCode).toBe(200);
    expect(auditRows).toContainEqual(
      expect.objectContaining({ action: 'member.role_changed', metadata: expect.objectContaining({ acting_as_provider: true }) }),
    );
  });

  it('nem o provedor deixa a empresa sem dono', async () => {
    currentUser = { id: PROVEDOR, roles: ['master'], permissions: [] };
    mockEscopo = { organizationIds: [], ehProvider: true };
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${DONO}`, payload: { role: 'admin' } });

    expect(res.statusCode).toBe(409);
  });

  it('membro inexistente na empresa é 404', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${EXISTENTE}`, payload: { role: 'admin' } });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /organizations/:id/members/:userId', () => {
  it('dono remove colaborador: o vínculo sai, a conta fica, e a empresa ativa é limpa', async () => {
    usuarios.find((u) => u.id === COLAB)!.organizacaoAtivaId = ORG;
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/members/${COLAB}` });

    expect(res.statusCode).toBe(200);
    expect(members.some((m) => m.userId === COLAB)).toBe(false);
    expect(usuarios.some((u) => u.id === COLAB)).toBe(true);
    expect(usuarios.find((u) => u.id === COLAB)?.organizacaoAtivaId).toBeNull();
    expect(auditRows).toContainEqual(expect.objectContaining({ action: 'member.removed', organizationId: ORG }));
  });

  it('o único dono não pode ser removido', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/members/${DONO}` });

    expect(res.statusCode).toBe(409);
    expect(members.some((m) => m.userId === DONO)).toBe(true);
  });

  it('admin não remove dono', async () => {
    members.push(membro(SEGUNDO_DONO, 'owner'));
    currentUser = { id: ADMIN, roles: ['colaborador'], permissions: [] };
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/members/${DONO}` });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /organizations/:id/invites/:inviteId/reenviar', () => {
  const PENDENTE: ConviteRow = {
    id: '10101010-1010-4101-8101-101010101010',
    organizationId: ORG,
    email: SEM_CONTA_EMAIL,
    role: 'collaborator',
    status: 'pendente',
    invitedByUserId: DONO,
    supabaseUserId: null,
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  };

  it('reenvia convite pendente: link novo gerado e resultado do envio na resposta', async () => {
    convites.push({ ...PENDENTE });
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010/reenviar` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: '10101010-1010-4101-8101-101010101010', email_enviado: true, link: 'https://link-do-supabase/convite' });
    expect(mockEnviarConvite).toHaveBeenCalledWith(expect.objectContaining({ email: SEM_CONTA_EMAIL, papel: 'collaborator' }));
    // O supabase_user_id do reenvio atualiza o registro (o primeiro envio pode
    // ter falhado antes de criar o usuário lá).
    expect(convites[0]?.supabaseUserId).toBe('supa-novo');
    expect(auditRows).toContainEqual(expect.objectContaining({ action: 'convite.reenviado' }));
  });

  it('convite já aceito não se reenvia (409)', async () => {
    convites.push({ ...PENDENTE, status: 'aceito', acceptedAt: new Date() });
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010/reenviar` });

    expect(res.statusCode).toBe(409);
  });

  it('convite de OUTRA empresa é 404 nesta', async () => {
    convites.push({ ...PENDENTE, organizationId: OUTRA });
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010/reenviar` });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /organizations/:id/invites/:inviteId (revogar)', () => {
  const PENDENTE: ConviteRow = {
    id: '10101010-1010-4101-8101-101010101010',
    organizationId: ORG,
    email: SEM_CONTA_EMAIL,
    role: 'collaborator',
    status: 'pendente',
    invitedByUserId: DONO,
    supabaseUserId: null,
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  };

  it('revoga pendente: vira revogado com carimbo, e a linha fica como rastro', async () => {
    convites.push({ ...PENDENTE });
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010` });

    expect(res.statusCode).toBe(200);
    expect(convites[0]?.status).toBe('revogado');
    expect(convites[0]?.revokedAt).toBeInstanceOf(Date);
    expect(auditRows).toContainEqual(expect.objectContaining({ action: 'convite.revogado', organizationId: ORG }));
  });

  it('convite já aceito não se revoga (409)', async () => {
    convites.push({ ...PENDENTE, status: 'aceito' });
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010` });

    expect(res.statusCode).toBe(409);
  });
});

describe('empresa alheia é 404 em TODOS os endpoints, nunca 403, para não confirmar existência', () => {
  beforeEach(() => {
    // Membro só da OUTRA empresa tentando mexer na Alfa.
    currentUser = { id: '77777777-7777-4777-8777-777777777777', roles: ['colaborador'], permissions: [] };
    usuarios.push(usuario('77777777-7777-4777-8777-777777777777', 'vizinho@outra.com'));
    members.push(membro('77777777-7777-4777-8777-777777777777', 'owner', OUTRA));
    mockEscopo = { organizationIds: [OUTRA], ehProvider: false };
  });

  it('POST invites', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites`, payload: { email: SEM_CONTA_EMAIL, role: 'collaborator' } });
    expect(res.statusCode).toBe(404);
  });

  it('GET members', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/organizations/${ORG}/members` });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH member', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/organizations/${ORG}/members/${COLAB}`, payload: { role: 'admin' } });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE member', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/members/${COLAB}` });
    expect(res.statusCode).toBe(404);
  });

  it('POST reenviar', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010/reenviar` });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE invite', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG}/invites/10101010-1010-4101-8101-101010101010` });
    expect(res.statusCode).toBe(404);
  });

  it('empresa inexistente responde o mesmo 404, inclusive para o provedor', async () => {
    currentUser = { id: PROVEDOR, roles: ['master'], permissions: [] };
    mockEscopo = { organizationIds: [], ehProvider: true };
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/organizations/99999999-9999-4999-8999-999999999999/members` });
    expect(res.statusCode).toBe(404);
  });
});
