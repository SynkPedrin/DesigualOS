import { describe, expect, it } from 'vitest';
import { redactTokenFromUrl } from './index';

/**
 * P0-03 (auditoria de release readiness, 22/09/2026): tokens de sessão
 * ativos em `/ws?token=<jwt>` apareciam gravados na íntegra no log de
 * request/response do Fastify — 2.242 ocorrências em 8 MB, 13 tokens
 * distintos, 2 ainda válidos no momento da coleta.
 */
describe('redactTokenFromUrl — WS_TOKEN_NOT_LOGGED / QUERY_TOKEN_REDACTED', () => {
  it('mascara o token no handshake real do WebSocket', () => {
    const jwt =
      'eyJhbGciOiJFUzI1NiIsImtpZCI6ImNkZjJlMzI5LWRkNmItNDIyZi04MjM3LTNmNGQyZTljMzk5OCIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.assinatura';
    const url = `/ws?token=${jwt}`;
    const redacted = redactTokenFromUrl(url);
    expect(redacted).toBe('/ws?token=[REDACTED]');
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain('eyJ');
  });

  it('preserva o resto da URL quando o token não é o único parâmetro', () => {
    expect(redactTokenFromUrl('/ws?foo=bar&token=abc.def.ghi&baz=1')).toBe('/ws?foo=bar&token=[REDACTED]&baz=1');
  });

  it('não mexe em URL sem token nenhum', () => {
    expect(redactTokenFromUrl('/conversations?limit=20')).toBe('/conversations?limit=20');
    expect(redactTokenFromUrl('/health')).toBe('/health');
  });

  it('é idempotente — redigir de novo não muda nada', () => {
    const uma = redactTokenFromUrl('/ws?token=abc.def.ghi');
    expect(redactTokenFromUrl(uma)).toBe(uma);
  });

  it('cobre o caso HTTP_AUTH_NOT_LOGGED: token vindo de outra rota que também usa query string', () => {
    expect(redactTokenFromUrl('/some/route?token=abc123&other=1')).not.toContain('abc123');
  });
});
