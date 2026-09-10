import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'ops-alert' });

/**
 * Alerta operacional pluggable (agente caiu, fila travou/job esgotou
 * tentativas). Até 08/09/2026 não existia NENHUM alerta automático - só a
 * tela de Monitoramento manual, que precisa de alguém abrindo pra notar.
 *
 * Destino via ALERT_SLACK_WEBHOOK_URL (Slack incoming webhook). Sem essa
 * env var configurada, a função vira no-op silencioso - o gancho existe e
 * está chamado nos pontos certos, só falta o time colar a URL do webhook do
 * canal de operação quando tiver uma (ver docs/runbook.md). Nunca lança:
 * alertar é efeito colateral, uma falha aqui não pode derrubar o fluxo real
 * que está sendo alertado.
 */
export async function sendOpsAlert(params: {
  severity: 'warning' | 'critical';
  title: string;
  detail?: string;
}): Promise<void> {
  const webhookUrl = process.env.ALERT_SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = params.severity === 'critical' ? '🔴' : '🟡';
  const text = params.detail
    ? `${emoji} *${params.title}*\n${params.detail}`
    : `${emoji} *${params.title}*`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        'Slack recusou o alerta (webhook inválido/revogado?)',
      );
    }
  } catch (error) {
    logger.warn({ error }, 'Falha ao mandar alerta pro Slack');
  }
}
