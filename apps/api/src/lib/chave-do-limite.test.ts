import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chaveDoLimite, ipReal } from './chave-do-limite';

const req = (ip: string, headers: Record<string, string> = {}) => ({ ip, headers }) as never;

describe('chave do limite de requisições', () => {
  beforeEach(() => { process.env.SUPABASE_URL = 'https://supa.test'; });
  afterEach(() => { delete process.env.SUPABASE_URL; });

  it('atrás do nginx (172.18.0.1) vale o X-Real-IP; vindo de fora, o cabeçalho é ignorado', () => {
    expect(ipReal(req('172.18.0.1', { 'x-real-ip': '200.1.2.3' }))).toBe('200.1.2.3');
    expect(ipReal(req('::ffff:172.18.0.1', { 'x-real-ip': '200.1.2.3' }))).toBe('200.1.2.3');
    expect(ipReal(req('8.8.8.8', { 'x-real-ip': '1.1.1.1' }))).toBe('8.8.8.8');
  });

  it('duas pessoas do mesmo escritório (mesmo IP) têm limites separados', async () => {
    const verificar = vi.fn(async (t: string) => ({ sub: t === 'tok-ana' ? 'ana' : 'gui', email: '', raw: {} }));
    const a = await chaveDoLimite(req('172.18.0.1', { 'x-real-ip': '200.1.2.3', authorization: 'Bearer tok-ana' }), verificar);
    const g = await chaveDoLimite(req('172.18.0.1', { 'x-real-ip': '200.1.2.3', authorization: 'Bearer tok-gui' }), verificar);
    expect([a, g]).toEqual(['u:ana', 'u:gui']);
    // o mesmo token não é verificado de novo a cada requisição
    await chaveDoLimite(req('172.18.0.1', { authorization: 'Bearer tok-ana' }), verificar);
    expect(verificar).toHaveBeenCalledTimes(2);
  });

  it('token inventado não abre balde novo: conta pelo IP real', async () => {
    const verificar = vi.fn(async () => { throw new Error('assinatura inválida'); });
    expect(await chaveDoLimite(req('172.18.0.1', { 'x-real-ip': '9.9.9.9', authorization: 'Bearer forjado-1' }), verificar)).toBe('ip:9.9.9.9');
    expect(await chaveDoLimite(req('172.18.0.1', { 'x-real-ip': '9.9.9.9', authorization: 'Bearer forjado-2' }), verificar)).toBe('ip:9.9.9.9');
  });

  it('sem login (webhook), conta pelo IP real', async () => {
    expect(await chaveDoLimite(req('172.18.0.5'))).toBe('ip:172.18.0.5');
  });
});
