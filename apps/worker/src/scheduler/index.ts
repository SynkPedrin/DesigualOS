import { Queue, Worker } from 'bullmq';
import { getRedisConnection } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';
import { runEndOfDayChecklist, runMorningBriefing } from './daily-digest';
import { processPendingEvents } from '../processors/operational-events';
import { checkIntegrationHealth } from './integration-health.js';
import { runKnowledgeConsolidation } from './knowledge-consolidation.js';
import { keepInferenceWarm } from './inference-warmth.js';
import { expireStaleStudioJobs } from './studio-queue-timeout.js';
import { expireStaleExecutions } from './execution-timeout.js';
import { avisarDeConexoesMcp } from './aviso-de-conexao-mcp.js';

const QUEUE_NAME = 'daily-digest';
const logger = createLogger({ service: 'worker:scheduler' });

/**
 * Os nomes dos jobs repetíveis, na ordem em que são registrados abaixo.
 *
 * Existe pro log poder dizer a verdade: a mensagem "Scheduler armado" trazia
 * uma lista escrita à mão que anunciava CINCO jobs enquanto NOVE estavam
 * armados. Log que enumera precisa enumerar de verdade — é a mesma coisa que
 * uma tela contar o que coube e chamar de total, só que ninguém olha.
 */
const JOBS_REPETIVEIS = [
  'end-of-day-checklist',
  'morning-briefing',
  'operational-events',
  'integration-health',
  'knowledge-consolidation',
  'inference-warmth',
  'studio-queue-timeout',
  'execution-timeout',
  'aviso-conexao-mcp',
] as const;

/**
 * Checklist de fim de dia (18h) e resumo de pendências de manhã (8h),
 * pedidos pelo usuário pra manter a visão do colaborador simples: métricas
 * ficam só pro master, o colaborador recebe isso pronto todo dia.
 *
 * Junto com eles roda a varredura de EVENTOS OPERACIONAIS (a cada 5 min): o
 * event store recebia evento do ClickUp o dia inteiro e nada consumia a fila
 * (processed_at ficava nulo pra sempre). Não é diário porque prazo estourado
 * e criativo rejeitado perdem o valor se só forem notados no dia seguinte.
 */
export function setupDailyJobs(): Worker {
  /**
   * Teto de retenção, igual ao das filas de agente (DEFAULT_JOB_OPTIONS em
   * packages/orchestrator/src/queues.ts). Esta fila ficou de fora quando
   * aquele teto foi criado, e ela é a que MAIS gera histórico: são sete jobs
   * repetíveis, um deles de minuto em minuto. Medido em 18/09/2026, ao
   * diagnosticar outra coisa: 1.911 `completed` e 226 `failed` acumulados no
   * Redis, sem limite nenhum.
   *
   * `failed` com teto maior porque é o que se consulta pra diagnosticar - foi
   * exatamente essa lista que revelou que o vigia de execuções estava
   * quebrando a cada 2 minutos.
   */
  const queue = new Queue(QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
  });

  // Antes eram `void queue.add(...)`: se o Redis estivesse lento/fora do
  // ar bem no boot, a rejeição não tinha handler nenhum (unhandled
  // rejection) e o log de "scheduler armado" logo abaixo disparava do
  // mesmo jeito, escondendo que os jobs repetíveis nunca foram
  // registrados de verdade.
  Promise.all([
    queue.add('end-of-day-checklist', {}, { repeat: { pattern: '0 18 * * *' }, jobId: 'end-of-day-checklist' }),
    queue.add('morning-briefing', {}, { repeat: { pattern: '0 8 * * *' }, jobId: 'morning-briefing' }),
    queue.add('operational-events', {}, { repeat: { pattern: '*/5 * * * *' }, jobId: 'operational-events' }),
    // SAÚDE DA INTEGRAÇÃO a cada 15 min. O webhook do ClickUp já morreu em
    // silêncio por cinco dias (URL de ngrok extinta, suspenso após 102 falhas)
    // enquanto o sistema respondia como se estivesse em dia. Silêncio de fonte
    // precisa ser um estado observado, não uma suposição.
    queue.add('integration-health', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'integration-health' }),
    // CONSOLIDAÇÃO às 03:00. Não substitui o webhook: reconcilia o que escapou.
    // Com um só caminho de atualização, uma falha silenciosa vira conhecimento
    // velho apresentado como atual.
    queue.add('knowledge-consolidation', {}, { repeat: { pattern: '0 3 * * *' }, jobId: 'knowledge-consolidation' }),
    // AQUECIMENTO a cada 10 min no expediente. Medido: modelo frio custa 88s de
    // TTFT contra 0,6-4,2s quente. O que transformava turno de 10s em 4 minutos
    // era carga fria, não concorrência — duas chamadas simultâneas entregam
    // MAIS respostas por minuto que uma.
    queue.add('inference-warmth', {}, { repeat: { pattern: '*/10 * * * *' }, jobId: 'inference-warmth' }),
    // TIMEOUT DE FILA DO STUDIO a cada minuto. Achado real: com o
    // studio-node fora do ar, um job ficou `queued` por DOIS DIAS e o
    // frontend mostrou "gerando" o tempo todo. De minuto em minuto porque
    // o valor aqui é justamente a pessoa descobrir rápido.
    queue.add('studio-queue-timeout', {}, { repeat: { pattern: '* * * * *' }, jobId: 'studio-queue-timeout' }),
    // TIMEOUT DE EXECUÇÃO DE AGENTE a cada 2 min. Achado real (18/09/2026):
    // doze execuções presas em `queued`/`running`, a mais antiga havia 326
    // horas, porque worker que morre no meio do job não escreve desfecho
    // nenhum. O chat mostrava "pensando" pra sempre. Ver execution-timeout.ts.
    queue.add('execution-timeout', {}, { repeat: { pattern: '*/2 * * * *' }, jobId: 'execution-timeout' }),
    // AVISO DE CONEXÃO MCP a cada 2 min. O servidor já registrava
    // `CONNECTION_CREATED` e ninguém era avisado — o evento morria no banco.
    // De 2 em 2 minutos porque "alguém plugou o Claude agora" perde o sentido
    // se chegar no dia seguinte, e o vigia olha 15 min pra trás justamente pra
    // sobreviver a uma parada curta sem ressuscitar conexão velha.
    queue.add('aviso-conexao-mcp', {}, { repeat: { pattern: '*/2 * * * *' }, jobId: 'aviso-conexao-mcp' }),
  ])
    /**
     * A lista é escrita à mão e já ficou para trás: ela anunciava cinco jobs
     * enquanto nove estavam armados. Log que ENUMERA precisa enumerar de
     * verdade, senão vira a mesma coisa que uma tela contando o que coube —
     * então agora ela sai da fila registrada, não da memória de quem editou.
     */
    .then(() =>
      logger.info(
        { jobs: JOBS_REPETIVEIS },
        `Scheduler armado (${JOBS_REPETIVEIS.length} jobs repetiveis)`,
      ),
    )
    .catch((error: unknown) => logger.error({ error }, 'Failed to register daily digest repeatable jobs'));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'end-of-day-checklist') {
        await runEndOfDayChecklist(logger);
      } else if (job.name === 'morning-briefing') {
        await runMorningBriefing(logger);
      } else if (job.name === 'operational-events') {
        await processPendingEvents(logger);
      } else if (job.name === 'integration-health') {
        await checkIntegrationHealth(logger);
      } else if (job.name === 'inference-warmth') {
        await keepInferenceWarm(logger);
      } else if (job.name === 'knowledge-consolidation') {
        await runKnowledgeConsolidation(logger, { somenteClientesComMudanca: true });
      } else if (job.name === 'studio-queue-timeout') {
        await expireStaleStudioJobs(logger);
      } else if (job.name === 'execution-timeout') {
        await expireStaleExecutions(logger);
      } else if (job.name === 'aviso-conexao-mcp') {
        await avisarDeConexoesMcp(logger);
      }
    },
    { connection: getRedisConnection() },
  );

  return worker;
}
