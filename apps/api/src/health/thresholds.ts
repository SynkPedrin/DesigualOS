/**
 * Máquina de estados de saúde (seção 6.1 do prompt mestre): sem heartbeat
 * por warning/degraded/offline segundos, o node cai de severidade. Um
 * heartbeat novo já bota o node de volta em 'online' direto no handler de
 * heartbeat (apps/api/src/nodes/routes.ts); o sweep só rebaixa, nunca sobe.
 */
/**
 * Valores calibrados para o modelo REAL de coleta, que é PULL: quem mede é a
 * sonda do Orchestrator (health/probe-scheduler.ts), a cada 30s — os agentes
 * não empurram heartbeat.
 *
 * Os valores antigos (10s/30s/60s) supunham heartbeat empurrado de poucos em
 * poucos segundos. Com a sonda de 30s eles derrubavam tudo pra "warning"
 * quase o tempo todo: medido, as 4 máquinas apareciam degradadas estando
 * perfeitamente no ar. Uma máquina não está com problema porque ninguém
 * perguntou dela há 11 segundos.
 *
 * Regra: cada limiar tem que ser um MÚLTIPLO folgado do intervalo da sonda,
 * pra que uma rodada perdida não vire alarme falso.
 */
export const HEALTH_THRESHOLDS_MS = {
  warning: 75_000,
  degraded: 150_000,
  offline: 300_000,
} as const;

export const HEALTH_SWEEP_INTERVAL_MS = 5_000;
