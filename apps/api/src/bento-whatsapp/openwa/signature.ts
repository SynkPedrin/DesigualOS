import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura do webhook do OpenWA: `X-OpenWA-Signature: sha256=<hex>`, HMAC-SHA256
 * do corpo CRU com o segredo do webhook (src/modules/webhook/utils/deliver-once.ts).
 *
 * Tem que ser o corpo cru: re-serializar o JSON parseado muda espaço e ordem
 * de chave, e a assinatura deixa de bater — por isso a rota usa um parser de
 * string escopado (ver routes.ts), como o webhook do ClickUp.
 */
export function assinaturaOpenwaValida(corpoCru: string, cabecalho: string | undefined, segredo: string): boolean {
  if (!cabecalho || !segredo) return false;
  const recebido = cabecalho.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recebido)) return false;
  const esperado = createHmac('sha256', segredo).update(corpoCru, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(recebido, 'hex'), Buffer.from(esperado, 'hex'));
}

/** Para testes e para a documentação de handoff: assina como o OpenWA assina. */
export function assinarComoOpenwa(corpoCru: string, segredo: string): string {
  return `sha256=${createHmac('sha256', segredo).update(corpoCru, 'utf8').digest('hex')}`;
}
