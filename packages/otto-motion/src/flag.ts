/**
 * Fronteira do Motion Engine (§2 da spec).
 *
 * Desligada, NADA deste módulo entra no caminho do Otto: o guard em
 * apps/worker/src/processors/execute-job.ts devolve null antes de tocar em
 * qualquer outra coisa daqui, e o worker de motion nem é registrado. O
 * comportamento do Otto volta a ser bit a bit o de antes.
 *
 * Lida a CADA chamada de propósito (nada de cache em escopo de módulo): os
 * testes de regressão (§46/§47-A) precisam alternar a flag dentro do mesmo
 * processo, e uma constante congelada no import tornaria isso impossível de
 * provar.
 */
export function ottoMotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTTO_MOTION_ENABLED === 'true';
}
