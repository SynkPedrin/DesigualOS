import { execFileSync } from 'node:child_process';

/**
 * P1-04 (release readiness audit, 22/09/2026): API/worker rodam `tsx src`
 * direto do checkout, sem build nem SHA no health — depois de um deploy não
 * dava pra provar QUAL commit está rodando de verdade em cada serviço, nem
 * comparar entre web/API/worker/nodes. `RELEASE_SHA` é o caminho de um
 * pipeline de build de verdade (setado explicitamente antes do processo
 * subir); sem ele, o processo lê o HEAD do próprio checkout — o que já é a
 * verdade nesta arquitetura, já que não existe artefato separado do código
 * fonte. Resolvido UMA VEZ no import: o SHA de um processo já em pé nunca
 * muda, mesmo que o checkout mude embaixo dele.
 */
/**
 * Assado pelo esbuild (`define` em apps/api/build.mjs e apps/worker/build.mjs).
 * Em `tsx` — dev, testes — o identificador não existe, e `typeof` sobre um
 * identificador não declarado é a única forma de checar isso sem estourar.
 */
declare const __RELEASE_SHA__: string | undefined;

/**
 * Ordem: assado > variável de ambiente > git do checkout.
 *
 * O valor assado vem NA FRENTE da variável de propósito, invertendo o que
 * valia antes. `RELEASE_SHA` é preenchida à mão no ambiente e pode ficar pra
 * trás — um .env com o SHA do deploy anterior faz o /health afirmar, com toda
 * a confiança, que está rodando um código que não está. O literal dentro do
 * bundle não tem como divergir do bundle: ele É o bundle. Entre uma fonte que
 * pode mentir e uma que não pode, num campo cujo único propósito é provar o
 * que está no ar, vale a que não pode.
 */
function resolveReleaseSha(): string {
  const assado = typeof __RELEASE_SHA__ === 'string' ? __RELEASE_SHA__.trim() : '';
  if (assado && assado !== 'unknown') return assado;
  const fromEnv = process.env.RELEASE_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return 'unknown';
  }
}

const RELEASE_SHA = resolveReleaseSha();
const BUILD_TIME = new Date().toISOString();

export interface ReleaseInfo {
  release_sha: string;
  build_time: string;
  environment: string;
}

/** Identidade do processo pra prova de deploy (Phase 11 da missão de release): mesmo formato em API, worker e nodes. */
export function getReleaseInfo(): ReleaseInfo {
  return {
    release_sha: RELEASE_SHA,
    build_time: BUILD_TIME,
    environment: process.env.NODE_ENV ?? 'development',
  };
}
