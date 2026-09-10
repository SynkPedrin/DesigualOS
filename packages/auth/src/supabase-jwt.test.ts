import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose';
import { verifySupabaseToken } from './supabase-jwt';

/**
 * jose, rodando em Node, busca o JWKS remoto via node:http/https diretamente
 * (não via `fetch` global - ver node_modules/jose/dist/node/esm/runtime/
 * fetch_jwks.js), então stubar `global.fetch` não intercepta nada aqui. Em
 * vez disso, sobe um servidor HTTP local (loopback, nunca sai da máquina -
 * não é o Supabase real) servindo o JWKS de uma chave gerada só pro teste, e
 * assina tokens de verdade com essa chave: exercita a verificação de
 * assinatura, expiração e audience/issuer reais (jose/WebCrypto), não uma
 * simulação do resultado esperado.
 */

const KID = 'test-key-1';

let server: Server;
let supabaseUrl: string;
let signingKey: KeyLike;
let rogueKey: KeyLike;

interface IssueTokenOverrides {
  sub?: string | undefined;
  email?: string | undefined;
  audience?: string;
  issuer?: string;
  expiresInSeconds?: number;
  key?: KeyLike;
}

async function issueToken(overrides: IssueTokenOverrides): Promise<string> {
  // Cuidado: 'sub' e 'email' usam `undefined` de propósito pra sinalizar
  // "não incluir essa claim no token" (testes de claim ausente). Um valor
  // default no destructuring (`sub = 'x'`) dispararia nesse caso mesmo com
  // a chave presente no objeto, mascarando a omissão - por isso o "in"
  // check abaixo em vez de destructuring com default.
  const sub = 'sub' in overrides ? overrides.sub : 'auth-user-1';
  const email = 'email' in overrides ? overrides.email : 'colaborador@desigual.com';
  const {
    audience = 'authenticated',
    issuer = `${supabaseUrl}/auth/v1`,
    expiresInSeconds = 3600,
    key = signingKey,
  } = overrides;

  const claims: Record<string, unknown> = {};
  if (email !== undefined) claims.email = email;

  let builder = new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: KID }).setIssuedAt();
  if (sub !== undefined) builder = builder.setSubject(sub);
  builder = builder
    .setAudience(audience)
    .setIssuer(issuer)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds);

  return builder.sign(key);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  signingKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = KID;
  jwk.alg = 'ES256';
  jwk.use = 'sig';

  const rogue = await generateKeyPair('ES256', { extractable: true });
  rogueKey = rogue.privateKey;

  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  supabaseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('verifySupabaseToken', () => {
  it('valida um token bem formado, assinado pela chave publicada no JWKS', async () => {
    const token = await issueToken({ sub: 'auth-user-1', email: 'colaborador@desigual.com' });

    const claims = await verifySupabaseToken(token, supabaseUrl);

    expect(claims.sub).toBe('auth-user-1');
    expect(claims.email).toBe('colaborador@desigual.com');
    expect(claims.raw.sub).toBe('auth-user-1');
  });

  it('rejeita token expirado', async () => {
    const token = await issueToken({ expiresInSeconds: -60 });

    await expect(verifySupabaseToken(token, supabaseUrl)).rejects.toThrow();
  });

  it('rejeita token com assinatura inválida (assinado por uma chave que não está no JWKS)', async () => {
    const token = await issueToken({ key: rogueKey });

    await expect(verifySupabaseToken(token, supabaseUrl)).rejects.toThrow();
  });

  it('rejeita token com audience diferente de "authenticated" (emitido pra outro propósito)', async () => {
    const token = await issueToken({ audience: 'service_role' });

    await expect(verifySupabaseToken(token, supabaseUrl)).rejects.toThrow();
  });

  it('rejeita token com issuer de outro projeto Supabase', async () => {
    const token = await issueToken({ issuer: 'https://outro-projeto.supabase.co/auth/v1' });

    await expect(verifySupabaseToken(token, supabaseUrl)).rejects.toThrow();
  });

  it('rejeita token sem claim de email, mesmo com assinatura/audience/issuer válidos', async () => {
    const token = await issueToken({ email: undefined });

    await expect(verifySupabaseToken(token, supabaseUrl)).rejects.toThrow(
      'Supabase token is missing sub or email claims',
    );
  });

  it('rejeita token sem claim de sub, mesmo com assinatura/audience/issuer válidos', async () => {
    const token = await issueToken({ sub: undefined });

    await expect(verifySupabaseToken(token, supabaseUrl)).rejects.toThrow(
      'Supabase token is missing sub or email claims',
    );
  });
});
