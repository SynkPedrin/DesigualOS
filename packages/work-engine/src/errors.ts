/**
 * Erros do motor de trabalho. O código vira o status HTTP na borda (rota); a mensagem é para gente.
 * Separar "não existe" de "não é sua" NÃO é feito de propósito: ambos viram `not_found`, para não
 * confirmar a existência de dado de outra empresa.
 */
export type WorkErrorCode = 'not_found' | 'invalid' | 'conflict' | 'forbidden';

export class WorkError extends Error {
  constructor(
    readonly code: WorkErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkError';
  }
}

export const notFound = (what: string) => new WorkError('not_found', `${what} não encontrado.`);
export const invalid = (message: string, details?: Record<string, unknown>) => new WorkError('invalid', message, details);
export const conflict = (message: string, details?: Record<string, unknown>) => new WorkError('conflict', message, details);

export const HTTP_STATUS: Record<WorkErrorCode, number> = { not_found: 404, invalid: 400, conflict: 409, forbidden: 403 };
