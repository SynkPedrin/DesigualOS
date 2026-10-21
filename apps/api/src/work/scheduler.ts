import { automationTick, runDueRecurrences } from '@desigual-os/work-engine';

/**
 * Relógio do Daily Tasks: automações a cada poucos segundos, recorrências a cada minuto.
 * Idempotente e seguro com várias instâncias (o motor usa lock de transação e "reivindica" cada ocorrência).
 * `WORK_SCHEDULER=off` desliga (testes, ou quando o worker assumir o papel).
 */
export function startWorkScheduler(log: { warn: (o: object, m: string) => void }): () => void {
  if (process.env.WORK_SCHEDULER === 'off') return () => undefined;
  let rodando = false;
  let ciclo = 0;
  const timer = setInterval(() => {
    if (rodando) return;
    rodando = true;
    ciclo++;
    void (async () => {
      try {
        await automationTick();
        if (ciclo % 12 === 0) await runDueRecurrences();
      } catch (error) {
        log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Daily Tasks: ciclo do relógio falhou');
      } finally {
        rodando = false;
      }
    })();
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
