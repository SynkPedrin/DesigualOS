import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeConfig } from '../config.js';

/**
 * Autenticação node -> Orchestrator via segredo compartilhado (seção 10 do
 * prompt mestre: "NODE_ID + NODE_SECRET no MVP, arquitetura preparada para mTLS").
 */
export function authHeaders(config: NodeConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.NODE_SECRET}`,
    'Content-Type': 'application/json',
  };
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual exige buffers do mesmo tamanho; tamanhos diferentes já
  // significam "não bate", sem precisar (e sem poder) comparar byte a byte.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Mesmo segredo compartilhado, mas na direção Orchestrator -> Node: sem
 * isso, qualquer host que alcançar a porta do node (mesmo dentro da rede
 * Tailscale) conseguia chamar POST /execute sem credencial nenhuma e
 * disparar um turno real do OpenClaw (custo real). authHeaders() acima já
 * manda esse Bearer nas chamadas Node -> Orchestrator; isto aqui é o
 * preHandler que falta no outro sentido.
 */
export function requireNodeSecret(config: NodeConfig) {
  return async function checkNodeSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token || !safeEqual(token, config.NODE_SECRET)) {
      reply.code(401).send({ error: 'Invalid or missing node credentials' });
    }
  };
}
