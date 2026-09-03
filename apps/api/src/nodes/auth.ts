import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { extractBearerToken } from '@desigual-os/auth';

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Autenticação node -> Orchestrator via segredo compartilhado (seção 10:
 * "NODE_ID + NODE_SECRET no MVP, arquitetura preparada para mTLS").
 */
export async function requireNodeSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.NODE_SECRET;
  if (!expected) {
    reply.code(500).send({ error: 'NODE_SECRET not configured on the Orchestrator' });
    return;
  }

  const token = extractBearerToken(request.headers.authorization);

  if (!token || !safeEqual(token, expected)) {
    reply.code(401).send({ error: 'Invalid or missing node credentials' });
  }
}
