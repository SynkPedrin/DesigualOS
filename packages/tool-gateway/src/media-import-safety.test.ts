import { describe, expect, it, vi } from 'vitest';

/**
 * Importar um módulo de mídia NÃO pode executar `sql` (nem outro helper do drizzle). Dezenas de testes
 * dos outros pacotes simulam `drizzle-orm` sem esses exports; um `sql` avaliado na carga do módulo
 * derrubava 153 testes do worker (aconteceu duas vezes em 20-21/10/2026). Este guarda quebra aqui,
 * com o nome do módulo culpado, em vez de lá.
 */
vi.mock('drizzle-orm', () => ({}));
vi.mock('@desigual-os/database', () => ({ db: {}, schema: new Proxy({}, { get: () => new Proxy({}, { get: () => ({}) }) }) }));

const MODULOS = ['./media-hub', './media-queries', './media-sync', './media-alerts', './media-settings', './media-agent-tools', './media-actions', './media-report-schedules', './media-templates', './media-metrics'];

describe('módulos de mídia importam sem tocar no drizzle', () => {
  for (const m of MODULOS) {
    it(m, async () => {
      await expect(import(m)).resolves.toBeDefined();
    });
  }
});
