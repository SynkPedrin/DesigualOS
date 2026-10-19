import { createHmac, timingSafeEqual } from 'node:crypto';

export function assinaturaOpenwaValida(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const received = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}
