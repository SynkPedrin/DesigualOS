import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * alerts.ts também cria `const logger = createLogger(...)` no escopo do
 * módulo - mesmo motivo do agent-probe.test.ts pra mockar '@desigual-os/logging'.
 */
vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('sendOpsAlert', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockFetch.mockReset();
  });

  it('não chama fetch quando ALERT_SLACK_WEBHOOK_URL não está configurada (no-op silencioso)', async () => {
    vi.stubEnv('ALERT_SLACK_WEBHOOK_URL', '');
    const { sendOpsAlert } = await import('./alerts.js');

    await sendOpsAlert({ severity: 'warning', title: 'Fila travada' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('chama o webhook do Slack com o payload esperado quando a env está configurada', async () => {
    vi.stubEnv('ALERT_SLACK_WEBHOOK_URL', 'https://hooks.slack.com/services/test');
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { sendOpsAlert } = await import('./alerts.js');

    await sendOpsAlert({ severity: 'critical', title: 'Fila travada', detail: 'queue-bento parada há 10min' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '🔴 *Fila travada*\nqueue-bento parada há 10min' }),
      }),
    );
  });

  it('monta o texto sem detail quando detail não é passado', async () => {
    vi.stubEnv('ALERT_SLACK_WEBHOOK_URL', 'https://hooks.slack.com/services/test');
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { sendOpsAlert } = await import('./alerts.js');

    await sendOpsAlert({ severity: 'warning', title: 'Agente degradado' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({ body: JSON.stringify({ text: '🟡 *Agente degradado*' }) }),
    );
  });

  it('nunca lança quando o fetch falha de rede', async () => {
    vi.stubEnv('ALERT_SLACK_WEBHOOK_URL', 'https://hooks.slack.com/services/test');
    mockFetch.mockRejectedValue(new Error('network down'));
    const { sendOpsAlert } = await import('./alerts.js');

    await expect(sendOpsAlert({ severity: 'warning', title: 'x' })).resolves.toBeUndefined();
  });

  it('nunca lança quando o Slack recusa o webhook (HTTP de erro)', async () => {
    vi.stubEnv('ALERT_SLACK_WEBHOOK_URL', 'https://hooks.slack.com/services/test');
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const { sendOpsAlert } = await import('./alerts.js');

    await expect(sendOpsAlert({ severity: 'warning', title: 'x' })).resolves.toBeUndefined();
  });
});
