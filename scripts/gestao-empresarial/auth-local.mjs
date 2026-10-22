#!/usr/bin/env node
/**
 * auth-local.mjs: um "Supabase Auth" FALSO, só para rodar a Gestão Empresarial no localhost.
 *
 * Fala o suficiente do protocolo do GoTrue para o front (supabase-js) e a API (JWKS) funcionarem:
 * login por senha, renovação, usuário atual, logout e as chaves públicas. NÃO é um serviço de
 * autenticação: qualquer um que alcance esta porta entra como os usuários abaixo.
 *
 * POR ISSO ELE SE RECUSA A SUBIR fora do loopback, e nunca deve ser apontado por uma variável de
 * produção. As senhas abaixo são de desenvolvimento, de e-mails que não existem (`@local.test`).
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const requireApi = createRequire(new URL('../../packages/auth/package.json', import.meta.url));
const { SignJWT, exportJWK, generateKeyPair } = requireApi('jose');

const PORTA = Number(process.env.AUTH_LOCAL_PORT ?? 4211);
const HOST = '127.0.0.1';
const ORIGENS = (process.env.AUTH_LOCAL_ORIGINS ?? 'http://localhost:3210,http://127.0.0.1:3210').split(',');
const BASE = `http://localhost:${PORTA}`;

/** IDs fixos: o seed do banco local usa os mesmos, e a sessão sobrevive a reiniciar este processo. */
export const USUARIOS = {
  'admin@local.test': { id: '00000000-0000-4000-8000-0000000000a1', senha: 'gestao-local-admin', nome: 'Admin Local' },
  'colaborador@local.test': { id: '00000000-0000-4000-8000-0000000000b2', senha: 'gestao-local-colab', nome: 'Colaborador Local' },
};

const { publicKey, privateKey } = await generateKeyPair('ES256');
const kid = randomUUID();
const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
const refreshs = new Map();

const usuarioJson = (email) => {
  const u = USUARIOS[email];
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { name: u.nome }, identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
};

async function sessao(email) {
  const u = USUARIOS[email];
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = await new SignJWT({ email, role: 'authenticated', user_metadata: { name: u.nome } })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
    .setSubject(u.id)
    .setAudience('authenticated')
    .setIssuer(`${BASE}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
  const refresh_token = randomUUID();
  refreshs.set(refresh_token, email);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: usuarioJson(email) };
}

const corpo = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });

const servidor = createServer(async (req, res) => {
  const origem = req.headers.origin;
  if (origem && ORIGENS.includes(origem)) {
    res.setHeader('access-control-allow-origin', origem);
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('access-control-allow-headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  const enviar = (status, dados) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(dados === undefined ? '' : JSON.stringify(dados)); };
  if (req.method === 'OPTIONS') return enviar(204);
  const url = new URL(req.url, BASE);
  if (url.pathname === '/auth/v1/.well-known/jwks.json') return enviar(200, { keys: [jwk] });
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const b = await corpo(req);
    const tipo = url.searchParams.get('grant_type');
    if (tipo === 'password') {
      const email = String(b.email ?? '').toLowerCase();
      if (USUARIOS[email]?.senha !== b.password) return enviar(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, msg: 'Invalid login credentials' });
      return enviar(200, await sessao(email));
    }
    if (tipo === 'refresh_token') {
      const email = refreshs.get(b.refresh_token);
      if (!email) return enviar(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 400, msg: 'Invalid Refresh Token' });
      refreshs.delete(b.refresh_token);
      return enviar(200, await sessao(email));
    }
    return enviar(400, { error: 'unsupported_grant_type' });
  }
  if (url.pathname === '/auth/v1/user') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
      if (claims.exp < Date.now() / 1000 || !USUARIOS[claims.email]) throw new Error('x');
      return enviar(200, usuarioJson(claims.email));
    } catch {
      return enviar(401, { code: 401, msg: 'invalid JWT' });
    }
  }
  if (url.pathname === '/auth/v1/logout') return enviar(204);
  if (url.pathname === '/auth/v1/health') return enviar(200, { name: 'auth-local' });
  return enviar(404, { msg: 'not found' });
});

servidor.listen(PORTA, HOST, () => {
  console.log(`[auth-local] ${BASE} (só loopback). Entradas de DESENVOLVIMENTO:`);
  for (const [email, u] of Object.entries(USUARIOS)) console.log(`  ${email}  senha: ${u.senha}`);
});
