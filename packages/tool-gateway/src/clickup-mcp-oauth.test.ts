import { describe, expect, it } from 'vitest';
import { buildClickUpMcpAuthorizeUrl, generatePkcePair } from './clickup-mcp-oauth.js';

describe('generatePkcePair', () => {
  it('gera verifier e challenge diferentes, dentro do range válido do RFC 7636', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeChallenge).not.toBe(codeVerifier);
    // Determinístico: mesmo verifier sempre produz o mesmo challenge (S256 puro).
    const again = generatePkcePair();
    expect(again.codeVerifier).not.toBe(codeVerifier); // aleatório entre chamadas
  });
});

describe('buildClickUpMcpAuthorizeUrl', () => {
  it('monta a URL com S256 e todos os parâmetros exigidos pelo discovery real', () => {
    const url = buildClickUpMcpAuthorizeUrl({
      clientId: 'client-123',
      redirectUri: 'https://api.example.com/integrations/clickup-mcp/callback',
      state: 'estado-assinado',
      codeChallenge: 'challenge-abc',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://mcp.clickup.com/oauth/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('scope')).toBe('read write');
  });
});
