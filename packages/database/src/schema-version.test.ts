import { describe, expect, it } from 'vitest';
import { getSchemaVersion } from './schema-version.js';

/**
 * P1-04 (release readiness audit, 22/09/2026): schema_version prova que o
 * processo rodando concorda com o schema real do banco — a última tag do
 * próprio ledger do drizzle-kit (database/migrations/meta/_journal.json),
 * não um número mantido à parte que pode divergir em silêncio.
 */
describe('getSchemaVersion', () => {
  it('lê a última tag real do journal de migrations, não "unknown"', () => {
    // Se isto vier "unknown", o caminho relativo até
    // database/migrations/meta/_journal.json quebrou — silenciosamente
    // esconder isso seria pior que o teste falhar aqui.
    expect(getSchemaVersion()).not.toBe('unknown');
    expect(getSchemaVersion()).toMatch(/^\d{4}_/);
  });

  it('resolvida uma vez, estável entre chamadas', () => {
    expect(getSchemaVersion()).toBe(getSchemaVersion());
  });
});
