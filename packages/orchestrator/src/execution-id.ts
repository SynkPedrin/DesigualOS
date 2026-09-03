import { randomBytes } from 'node:crypto';

/**
 * Formato EXE-2026-000982 (seção 6.3). Não é sequencial de verdade (não
 * consulta o banco pra isso, evita condição de corrida por um contador).
 *
 * Versão anterior usava só os últimos 6 dígitos do timestamp, que se repete
 * a cada 1_000_000ms (~16m40s): duas execuções nesse intervalo geravam o
 * mesmo id e a segunda quebrava a constraint unique() da coluna. Timestamp
 * completo (base36, pra caber mais em menos caracteres) + bytes aleatórios
 * elimina a colisão na prática.
 */
export function generateExecutionId(now: Date = new Date()): string {
  const year = now.getFullYear();
  const suffix = `${now.getTime().toString(36)}${randomBytes(3).toString('hex')}`;
  return `EXE-${year}-${suffix}`.toUpperCase();
}

/** Formato STU-9282 (seção 7.3), mesma lógica de geração e mesma correção de colisão. */
export function generateStudioJobId(now: Date = new Date()): string {
  const suffix = `${now.getTime().toString(36)}${randomBytes(3).toString('hex')}`;
  return `STU-${suffix}`.toUpperCase();
}
