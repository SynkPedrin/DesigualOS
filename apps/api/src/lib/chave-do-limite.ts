import type { FastifyRequest } from 'fastify';
import { extractBearerToken, verifySupabaseToken } from '@desigual-os/auth';

/**
 * QUEM conta para o limite de requisições (300/min).
 *
 * Antes era o IP da conexão — e em produção a API fica atrás do nginx da própria VPS, então TODA requisição chegava
 * como 172.18.0.1: a operação inteira, os webhooks do WhatsApp e do ClickUp e a checagem de saúde dividiam um limite
 * só. Medido em 29/10/2026: uma pessoa abrindo o Daily já levou 429 em oito rotas de uma vez. Contar por IP real
 * também não bastaria: no escritório todo mundo sai pelo mesmo IP público.
 *
 * Com login, conta a PESSOA (o token é conferido de verdade — um token inventado não abre um balde novo, cai no do
 * IP). Sem login, conta o IP real que o nginx informa em X-Real-IP; o cabeçalho só vale vindo de endereço interno
 * (o proxy), nunca de fora, onde qualquer um o escreveria.
 */

const INTERNO = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|::ffff:(127|10|172\.(1[6-9]|2\d|3[01])|192\.168)\.)/;

export function ipReal(req: Pick<FastifyRequest, 'ip' | 'headers'>): string {
  const informado = req.headers['x-real-ip'];
  if (INTERNO.test(req.ip) && typeof informado === 'string' && informado.trim()) return informado.trim();
  return req.ip;
}

// Mesmo token chega várias vezes por minuto (cada tela pede várias rotas): guarda quem ele é por pouco tempo.
const conhecidos = new Map<string, { sub: string; ate: number }>();

export async function chaveDoLimite(req: Pick<FastifyRequest, 'ip' | 'headers'>, verificar = verifySupabaseToken): Promise<string> {
  const token = extractBearerToken(req.headers.authorization);
  const url = process.env.SUPABASE_URL;
  if (token && url) {
    const guardado = conhecidos.get(token);
    if (guardado && guardado.ate > Date.now()) return `u:${guardado.sub}`;
    try {
      const { sub } = await verificar(token, url);
      if (conhecidos.size > 5_000) conhecidos.clear();
      conhecidos.set(token, { sub, ate: Date.now() + 60_000 });
      return `u:${sub}`;
    } catch {
      // token ruim: conta pelo IP (e o requireAuth responde 401 depois)
    }
  }
  return `ip:${ipReal(req)}`;
}
