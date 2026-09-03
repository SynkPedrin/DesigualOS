import { syncAgents } from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';

/**
 * Sonda periódica dos agentes.
 *
 * Por que ela precisa existir: o `startHealthSweep` rebaixa qualquer node
 * sem heartbeat há 60s (ver thresholds.ts). Nossos agentes NÃO mandam
 * heartbeat — quem vai até eles é o Orchestrator. Sem uma sonda periódica,
 * o Monitoramento voltava pra "offline" poucos minutos depois de cada
 * clique em Sincronizar, e a tela mentia sobre máquinas que estavam de pé.
 *
 * O intervalo tem que ser MENOR que o limiar de offline (60s), senão existe
 * uma janela em que tudo aparece caído sem estar. 30s dá margem de sobra e
 * é barato: são 4 requisições HTTP curtas.
 */
const PROBE_INTERVAL_MS = 30_000;

export function startAgentProbe(logger: Logger): NodeJS.Timeout {
  const run = () => {
    void syncAgents()
      .then((report) => {
        const online = report.agents.filter((a) => a.status === 'online').length;
        logger.debug({ online, total: report.agents.length }, 'Sonda periódica de agentes');
      })
      .catch((error: unknown) => {
        // Falha na sonda não pode derrubar a API: o pior caso é o
        // Monitoramento ficar com dado velho até a próxima rodada.
        logger.error({ error }, 'Sonda periódica de agentes falhou');
      });
  };

  // Roda uma vez no boot pra tela já nascer com dado real, em vez de
  // esperar 30s mostrando tudo offline.
  run();
  return setInterval(run, PROBE_INTERVAL_MS);
}
