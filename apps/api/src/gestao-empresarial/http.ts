import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ErroDeValor } from './dominio/dinheiro';

/** Erro que a rota sabe traduzir: status e mensagem em português, sem vazar detalhe interno. */
export class ErroDeNegocio extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

export function responderErro(reply: FastifyReply, erro: unknown) {
  if (erro instanceof ErroDeNegocio) return reply.code(erro.status).send({ error: erro.message });
  if (erro instanceof ErroDeValor) return reply.code(400).send({ error: erro.message });
  if (erro instanceof z.ZodError) return reply.code(400).send({ error: erro.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; ') });
  // Violação de constraint do banco é erro de dado, não do servidor: o texto do Postgres não sai daqui.
  const code = (erro as { code?: string }).code;
  if (code === '23505') return reply.code(409).send({ error: 'Já existe um registro com esses dados.' });
  if (code === '23514' || code === '23503') return reply.code(422).send({ error: 'Os dados enviados não passam nas regras do cadastro.' });
  throw erro;
}

/** Paginação SEMPRE no servidor: nenhuma lista devolve a tabela inteira. */
export const paginacaoSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function paginar<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const uuid = z.string().uuid();
export const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');
/** Centavos: inteiro, positivo, dentro do que o JS soma sem perder precisão. */
export const centavos = z.number().int('Informe o valor em centavos (inteiro).').positive('O valor precisa ser maior que zero.').max(Number.MAX_SAFE_INTEGER);

/** `Partial` que aceita `undefined` explícito: o que o Zod devolve para chave ausente. */
export type Parcial<T> = { [K in keyof T]?: T[K] | undefined };

/** Tira as chaves `undefined` antes de um `.set()`: o Drizzle trata `undefined` como "não mexa", mas o tipo estrito não deixa passar. */
export function semUndefined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}
