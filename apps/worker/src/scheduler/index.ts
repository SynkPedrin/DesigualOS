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
import { syncAllGoogleCalendars } from './google-calendar-sync.js';
import { syncAllMetaAdAccounts } from './meta-accounts-sync.js';
import { syncAllMicrosoftCalendars } from './microsoft-calendar-sync.js';
import { varrerOperacao } from './bento-varredura.js';
import { briefingOperacional } from './bento-briefing.js';
import { prepararReunioesDeCliente } from './meeting-prep.js';
import { reconciliarAutomacoes } from './reconciliar-automacoes.js';

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
  'google-calendar-sync',
  'meta-accounts-sync',
  'microsoft-calendar-sync',
  'meeting-prep',
  'reconciliar-automacoes',
  'bento-varredura',
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
    // SYNC DO GOOGLE CALENDAR a cada 15 min (§25 do prompt "CALENDAR +
    // AUTOMATIONS + BENTO V2", 06/10/2026) — mesma cadência da saúde de
    // integração, cadência que não esgota a cota da Calendar API nem deixa
    // a agenda ficar velha demais entre uma sync e outra.
    queue.add('google-calendar-sync', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'google-calendar-sync' }),
    // SYNC DE CONTAS META ADS uma vez por dia, 04:30 (16/10/2026) — madrugada,
    // fora do pico, meia hora depois da consolidação de conhecimento (03:00).
    // Conta nova na BM ou cliente novo no cadastro viram vínculo por nome sem
    // ninguém lembrar de apertar o botão. Diária e não mais frequente porque
    // o vínculo é por NOME: não é dado que envelhece em minutos, e cada
    // rodada varre todas as BMs de todas as conexões.
    queue.add('meta-accounts-sync', {}, { repeat: { pattern: '30 4 * * *' }, jobId: 'meta-accounts-sync' }),
    // SYNC DO MICROSOFT/OUTLOOK CALENDAR (07/10/2026) — mesma cadência do
    // Google, mesma razão: fresco o bastante sem esgotar cota do Graph.
    queue.add('microsoft-calendar-sync', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'microsoft-calendar-sync' }),
    // MEETING PREP a cada 5 min (§51-53 do mesmo prompt): aviso de reunião de
    // cliente chega ~15 min antes dela — de 5 em 5 min porque o próprio
    // dedup (notificação já existe pra este evento) protege contra repetir,
    // então a cadência só precisa ser menor que a janela de aviso.
    queue.add('meeting-prep', {}, { repeat: { pattern: '*/5 * * * *' }, jobId: 'meeting-prep' }),
    // RECONCILIAR AUTOMAÇÕES de 15 em 15 min. O `enabled` mora no Postgres e o
    // agendamento mora no Redis, e nada reconciliava os dois: perder o Redis
    // deixava toda automação "ativa" na tela e morta no agendador, pra sempre,
    // sem caminho de conserto (o PATCH só registra quando a agenda muda ou
    // quando a automação sai de desligada). Medido em 09/10/2026 com a "ASDA".
    //
    // Cadência de 15 min, e não de minuto em minuto, porque a função lê o banco
    // e lista os repeatables: é barata, não é de graça. Quinze minutos é bem
    // menor que o intervalo de qualquer automação real e bem maior que o tempo
    // de um reinício de Redis.
    queue.add('reconciliar-automacoes', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'reconciliar-automacoes' }),
    // VARREDURA PROATIVA DO BENTO de 15 em 15 min (Bento 3.1). Armada sempre,
    // mas não faz nada com BENTO_PROACTIVE_MONITORING ausente/off — ligar e
    // desligar é só a flag, sem redeploy de agenda. 15 min: prazo que vence
    // hoje ainda tem tempo de ser salvo, e a leitura é uma consulta paginada
    // por empresa, sem modelo de linguagem.
    queue.add('bento-varredura', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'bento-varredura' }),
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
    /**
     * RECONCILIA JÁ NO BOOT, além de a cada 15 min. O caso que esta função
     * existe pra consertar é justamente a perda do Redis, e perda de Redis
     * costuma vir junto com um reinício. Esperar o primeiro tique de 15 min
     * deixaria as automações mortas por um quarto de hora logo depois do
     * momento em que mais provavelmente morreram.
     *
     * Não derruba o boot se falhar: o worker tem outras doze funções, e ficar
     * sem reconciliação é pior que ficar sem worker só na teoria.
     */
    .then(() => reconciliarAutomacoes())
    .catch((error: unknown) => logger.error({ error }, 'Failed to register daily digest repeatable jobs'));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'end-of-day-checklist') {
        await runEndOfDayChecklist(logger);
      } else if (job.name === 'morning-briefing') {
        await runMorningBriefing(logger);
        // As tarefas do dia, por pessoa (Bento 3.1). Atrás das flags da
        // proatividade; falhar aqui não derruba o briefing antigo, que já rodou.
        await briefingOperacional(logger).catch((error: unknown) => logger.error({ error }, '[bento-briefing] falhou'));
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
      } else if (job.name === 'google-calendar-sync') {
        await syncAllGoogleCalendars(logger);
      } else if (job.name === 'meta-accounts-sync') {
        await syncAllMetaAdAccounts(logger);
      } else if (job.name === 'microsoft-calendar-sync') {
        await syncAllMicrosoftCalendars(logger);
      } else if (job.name === 'meeting-prep') {
        await prepararReunioesDeCliente(logger);
      } else if (job.name === 'reconciliar-automacoes') {
        await reconciliarAutomacoes();
      } else if (job.name === 'bento-varredura') {
        await varrerOperacao(logger);
      }
    },
    { connection: getRedisConnection() },
  );

  return worker;
}
