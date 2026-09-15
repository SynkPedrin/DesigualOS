import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkBrainHealth, createOttoLLMProvider } from '@desigual-os/otto';
import { loadConfig } from '../config.js';
import type { OttoNodeDeps } from '../execute.js';
import { buildServer } from './index.js';

/**
 * Health agregado do /health: o provider é o REAL (createOttoLLMProvider)
 * com fetch injetado, então o teste exercita o parsing de /api/tags de
 * verdade - só a rede é substituída. O brain é um vault real em tmpdir.
 */

let brainDir: string;

beforeEach(() => {
  brainDir = mkdtempSync(join(tmpdir(), 'otto-node-health-'));
  writeFileSync(join(brainDir, 'doc.md'), '# Funil de demanda\nConteúdo de marketing.\n', 'utf-8');
});

afterEach(() => {
  rmSync(brainDir, { recursive: true, force: true });
});

function tagsResponse(models: string[]): Response {
  return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeDeps(fetchFn: typeof fetch, brainPath: string = brainDir): OttoNodeDeps {
  return {
    llm: createOttoLLMProvider({ baseUrl: 'http://localhost:11434', model: 'mistral', fetchFn }),
    retrieveKnowledge: () => [],
    brainHealth: () => checkBrainHealth(brainPath),
  };
}

function makeConfig() {
  return loadConfig({ NODE_SECRET: 'segredo-teste' });
}

describe('GET /health agregado', () => {
  it('reporta ok quando Ollama responde, modelo instalado e brain legível', async () => {
    const app = buildServer(makeConfig(), makeDeps(async () => tagsResponse(['mistral:latest'])), false);
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.node_id).toBe('NODE_OTTO_01');
    expect(body.llm.status).toBe('ok');
    expect(body.brain.status).toBe('ok');
    expect(body.brain.docCount).toBe(1);

    await app.close();
  });

  it('reporta down quando o Ollama está inalcançável', async () => {
    const app = buildServer(
      makeConfig(),
      makeDeps(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
      false,
    );
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(body.status).toBe('down');
    expect(body.llm.status).toBe('down');
    expect(body.llm.detail).toContain('Ollama unreachable');

    await app.close();
  });

  it('reporta degraded quando o modelo configurado não está instalado', async () => {
    const app = buildServer(makeConfig(), makeDeps(async () => tagsResponse(['llama3.1:latest'])), false);
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(body.status).toBe('degraded');
    expect(body.llm.status).toBe('degraded');
    expect(body.llm.detail).toContain('not installed');

    await app.close();
  });

  it('reporta degraded quando o brain está ausente mesmo com LLM ok', async () => {
    const app = buildServer(
      makeConfig(),
      makeDeps(async () => tagsResponse(['mistral:latest']), join(brainDir, 'nao-existe')),
      false,
    );
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(body.status).toBe('degraded');
    expect(body.brain.status).toBe('missing');

    await app.close();
  });
});
