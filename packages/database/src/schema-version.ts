import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * P1-04 (release readiness audit, 22/09/2026): "não é possível certificar
 * equivalência entre web, API, worker e nodes" — schema_version é o dado que
 * falta pra provar que o processo rodando agora concorda com o banco que ele
 * está lendo. A última tag de `database/migrations/meta/_journal.json` (o
 * próprio ledger do drizzle-kit, não um número inventado à parte) é essa
 * prova: se o processo não bate com o schema real, a tag muda e o
 * desencontro fica visível no /health.
 */
function journalPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/database/src -> repo root -> database/migrations/meta
  return resolve(here, '../../../database/migrations/meta/_journal.json');
}

/**
 * Assado pelo esbuild (ver scripts/identidade-de-release.mjs). Na imagem de
 * produção a pasta `database/` não existe, então o `readFileSync` abaixo
 * nunca encontrava o journal e o campo virava 'unknown' em silêncio.
 */
declare const __SCHEMA_VERSION__: string | undefined;

function resolveSchemaVersion(): string {
  const assado = typeof __SCHEMA_VERSION__ === 'string' ? __SCHEMA_VERSION__.trim() : '';
  if (assado && assado !== 'unknown') return assado;
  try {
    const raw = readFileSync(journalPath(), 'utf8');
    const journal = JSON.parse(raw) as { entries?: Array<{ tag?: string }> };
    const last = journal.entries?.at(-1);
    return last?.tag ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const SCHEMA_VERSION = resolveSchemaVersion();

/** Tag da última migration aplicada ao schema (resolvida uma vez, no import). */
export function getSchemaVersion(): string {
  return SCHEMA_VERSION;
}
