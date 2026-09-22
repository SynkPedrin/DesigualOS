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
function resolveReleaseSha(): string {
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
