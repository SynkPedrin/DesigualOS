import { MotionModelUnavailableError } from './errors.js';

/**
 * §5 — MODELO OBRIGATÓRIO.
 *
 * `claude-opus-5-5` não é um id inventado: foi descoberto contra a instalação
 * real desta máquina. Em 24/09/2026, com o Claude Code 2.1.263, a API
 * respondia 400 "Claude Code 2.1.263 does not support this model; version
 * 2.1.280 or newer is required" — ou seja, o modelo EXISTE e o que faltava era
 * a CLI. Depois do `claude update` (2.1.281) a mesma chamada devolveu resposta
 * normal com `modelUsage: { "claude-opus-5-5": ... }`.
 *
 * Essa história importa porque define o formato do erro: "Opus 5.5
 * indisponível" quase sempre quer dizer CLI velha ou sessão sem acesso, não
 * modelo inexistente. Por isso a mensagem manda reconectar/atualizar em vez de
 * sugerir outro modelo.
 */
export const MOTION_MODEL_ID = 'claude-opus-5-5';

/** Versão mínima da CLI que aceita o Opus 5.5 (medido, ver acima). */
export const MIN_CLAUDE_CODE_VERSION = '2.1.280';

/**
 * Nunca deixe um alias ('opus', 'sonnet') passar. Alias resolve pro "melhor
 * Opus disponível" do dia — que hoje é o 5, não o 5.5 — e é exatamente o
 * fallback silencioso que §5 proíbe.
 */
export function assertMotionModel(model: string): void {
  if (model !== MOTION_MODEL_ID) {
    throw new MotionModelUnavailableError(
      `modelo pedido '${model}' não é ${MOTION_MODEL_ID}; o Motion Engine não aceita substituto`,
    );
  }
}

/** Compara "2.1.281" com "2.1.280" sem depender de semver externo. */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const parse = (value: string): number[] =>
    value
      .trim()
      .split(/[^\d]+/)
      .filter((part) => part !== '')
      .map((part) => Number.parseInt(part, 10));
  const a = parse(actual);
  const b = parse(minimum);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

/**
 * Prova de que o Opus 5.5 REALMENTE respondeu, lida do `modelUsage` que o
 * `--output-format json` devolve.
 *
 * Isto é o que fecha a porta do fallback silencioso de verdade: passar
 * `--model claude-opus-5-5` é uma intenção, `modelUsage` é o fato. Se a CLI
 * tivesse degradado por conta própria, o id do modelo degradado apareceria
 * aqui e a execução é reprovada.
 *
 * Haiku aparecer junto é normal e esperado — a CLI usa modelos auxiliares
 * pequenos pra tarefas internas (título de sessão, detecção de tópico). O que
 * não pode faltar é o Opus 5.5 entre os modelos que rodaram.
 */
export function assertModelActuallyUsed(modelUsage: Record<string, unknown> | undefined): void {
  const used = Object.keys(modelUsage ?? {});
  if (!used.includes(MOTION_MODEL_ID)) {
    throw new MotionModelUnavailableError(
      `a sessão terminou sem nenhum uso de ${MOTION_MODEL_ID}; modelos que de fato rodaram: ${
        used.length > 0 ? used.join(', ') : '(nenhum)'
      }`,
    );
  }
}
