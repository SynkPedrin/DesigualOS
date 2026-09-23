import { adaptJarbasResponse, type AdaptedJarbasResponse } from './jarbas-response-adapter';
import { verifyClaimedRatio } from './metric-verifier';

/**
 * jarbas-v2-client.ts — cliente do serviço V2 real (100.118.12.97:3112,
 * verificado offline+online na missão de shadow/cutover, 24/09/2026).
 *
 * Regra §9 da missão de wiring: se o V2 está indisponível, NUNCA cai
 * silenciosamente pro legado (:3102) apresentando prosa numérica como se
 * fosse verificada. `askJarbasV2` só tem dois resultados: `ok` com um
 * envelope verificado, ou `unavailable` — nunca um terceiro caminho
 * escondido que finge sucesso.
 */

export interface JarbasV2Config {
  url: string;
  token: string;
  timeoutMs?: number;
}

export interface AskJarbasV2Input {
  text: string;
  sessionId: string;
  scope?: {
    organizationId?: string;
    clientId?: string;
    accountId?: string;
    entityType?: string;
    periodStart?: string;
    periodEnd?: string;
    timezone?: string;
  };
}

export type AskJarbasV2Result =
  | { status: 'ok'; adapted: AdaptedJarbasResponse; raw: unknown; metricVerified: boolean; durationMs: number }
  | { status: 'unavailable'; reason: string };

/**
 * §10 da missão: só chama o resultado de "verificado" quando schemaVersion=2
 * E há pelo menos um par (numerador/denominador + taxa alegada) que o
 * verificador local reproduz de forma independente. Ter `metricFacts`
 * não-vazio sozinho não basta — precisa ter passado pela conta, não só
 * pela presença do dado.
 */
function computeMetricVerified(adapted: AdaptedJarbasResponse): boolean {
  if (!adapted.v2 || adapted.v2.metricFacts.length === 0) return false;
  const byEntity = new Map<string, Map<string, number>>();
  for (const f of adapted.v2.metricFacts) {
    if (!byEntity.has(f.entityId)) byEntity.set(f.entityId, new Map());
    byEntity.get(f.entityId)!.set(f.metric, f.value);
  }
  for (const metrics of byEntity.values()) {
    const clicks = metrics.get('clicks');
    const impressions = metrics.get('impressions');
    const ctrClaimed = metrics.get('ctr_calculated');
    if (clicks !== undefined && impressions !== undefined && ctrClaimed !== undefined) {
      const check = verifyClaimedRatio(ctrClaimed, clicks, impressions, 0.01);
      if (check.ok) return true;
    }
  }
  return false;
}

export async function askJarbasV2(config: JarbasV2Config, input: AskJarbasV2Input): Promise<AskJarbasV2Result> {
  const startedAt = Date.now();
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ agent: 'jarbas', text: input.text, sessionId: input.sessionId, scope: input.scope }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
    });
    if (!res.ok) return { status: 'unavailable', reason: `V2 respondeu HTTP ${res.status}` };
    const raw = await res.json();
    const adapted = adaptJarbasResponse(raw);
    return { status: 'ok', adapted, raw, metricVerified: computeMetricVerified(adapted), durationMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
  }
}
