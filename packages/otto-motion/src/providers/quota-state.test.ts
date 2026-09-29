import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUOTA_UNAVAILABLE_MESSAGE, clearQuotaState, readQuotaState, recordQuotaUnavailable } from './quota-state.js';

/**
 * O arquivo de quota é a ponte entre a sessão que DETECTOU o limite e todo o
 * resto que precisa saber dele. Estes testes usam um OTTO_MOTION_RUNTIME_DIR
 * temporário pra nunca tocar o runtime real do pacote.
 */
let runtimeDir = '';

beforeAll(async () => {
  runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-quota-state-'));
  process.env.OTTO_MOTION_RUNTIME_DIR = runtimeDir;
});

afterAll(async () => {
  delete process.env.OTTO_MOTION_RUNTIME_DIR;
  await fs.rm(runtimeDir, { recursive: true, force: true });
});

describe('estado de quota do Claude (quota-state.ts)', () => {
  it('sem arquivo, lê null', async () => {
    await clearQuotaState();
    expect(await readQuotaState()).toBeNull();
  });

  it('grava e lê de volta, com a frase exata da UI e o detalhe original da CLI', async () => {
    await recordQuotaUnavailable("You've reached your weekly usage limit. Resets Sep 28 at 4pm.");

    const estado = await readQuotaState();
    expect(estado).not.toBeNull();
    expect(estado?.message).toBe(QUOTA_UNAVAILABLE_MESSAGE);
    expect(estado?.message).toBe('O Claude Opus 5.5 está indisponível — limite de uso atingido.');
    expect(estado?.detail).toContain('weekly usage limit');
    expect(Number.isNaN(Date.parse(estado?.recordedAt ?? ''))).toBe(false);

    // O arquivo mora na RAIZ do runtimeDir (não dentro de motion_<id>): a
    // quota é da conta, e o próximo job precisa herdá-la.
    const bruto = JSON.parse(await fs.readFile(path.join(runtimeDir, 'claude-quota-state.json'), 'utf8')) as {
      message: string;
    };
    expect(bruto.message).toBe(QUOTA_UNAVAILABLE_MESSAGE);
  });

  it('arquivo corrompido vira null — nunca derruba a checagem de conexão', async () => {
    await fs.writeFile(path.join(runtimeDir, 'claude-quota-state.json'), '{ nao é json', 'utf8');
    expect(await readQuotaState()).toBeNull();
  });

  it('shape errado (campos faltando) vira null', async () => {
    await fs.writeFile(path.join(runtimeDir, 'claude-quota-state.json'), '{"message":"x"}', 'utf8');
    expect(await readQuotaState()).toBeNull();
  });

  it('clearQuotaState apaga e é idempotente', async () => {
    await recordQuotaUnavailable('daily limit reached');
    await clearQuotaState();
    expect(await readQuotaState()).toBeNull();
    await clearQuotaState();
    expect(await readQuotaState()).toBeNull();
  });
});
