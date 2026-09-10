import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * Portabilidade é requisito do node (ele migra de máquina junto com o
 * brain): os defaults nunca podem vazar IP Tailscale nem path absoluto de
 * uma máquina específica.
 */

describe('loadConfig', () => {
  it('aplica defaults portáteis quando só NODE_SECRET é dado', () => {
    const config = loadConfig({ NODE_SECRET: 'segredo-teste' });

    expect(config.NODE_ID).toBe('NODE_OTTO_01');
    expect(config.AGENT_NAME).toBe('otto');
    expect(config.PORT).toBe(4002);
    expect(config.PRIVATE_HOST).toBe('http://localhost:4002');
    expect(config.ORCHESTRATOR_URL).toBe('http://localhost:3001');
    expect(config.HEARTBEAT_INTERVAL_MS).toBe(10_000);

    // Rede Tailscale usa 100.64.0.0/10; um default assim prenderia o node
    // a uma máquina específica.
    for (const value of [config.PRIVATE_HOST, config.ORCHESTRATOR_URL]) {
      expect(value).not.toMatch(/100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./);
    }

    // OTTO_* embutidos via loadOttoConfig: defaults locais também.
    expect(config.otto.provider).toBe('ollama');
    expect(config.otto.ollamaUrl).toBe('http://localhost:11434');
    expect(config.otto.model).toBe('mistral');
    expect(config.otto.brainPath).not.toMatch(/100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./);
  });

  it('rejeita AGENT_NAME diferente de otto', () => {
    expect(() => loadConfig({ NODE_SECRET: 'segredo-teste', AGENT_NAME: 'bento' })).toThrow(
      /Invalid otto-node configuration/,
    );
  });

  it('exige NODE_SECRET', () => {
    expect(() => loadConfig({})).toThrow(/Invalid otto-node configuration/);
  });

  it('respeita overrides de env', () => {
    const config = loadConfig({
      NODE_SECRET: 'segredo-teste',
      PORT: '4999',
      OTTO_MODEL: 'llama3.1',
      OTTO_OLLAMA_URL: 'http://localhost:22434',
    });
    expect(config.PORT).toBe(4999);
    expect(config.otto.model).toBe('llama3.1');
    expect(config.otto.ollamaUrl).toBe('http://localhost:22434');
  });
});
