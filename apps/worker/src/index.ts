import './env.js';
import { Worker } from 'bullmq';
import { AGENT_NAMES } from '@desigual-os/types';
import { createLogger } from '@desigual-os/logging';
import {
  AUTOMATIONS_QUEUE_NAME,
  getRedisConnection,
  queueNameForAgent,
  type AgentJobData,
  type AutomationJobData,
} from '@desigual-os/orchestrator';
import { processAgentJob } from './processors/execute-job.js';
import { processAutomationJob } from './processors/run-automation.js';
import { setupDailyJobs } from './scheduler/index.js';

const logger = createLogger({ service: 'worker' });

const dailyDigestWorker = setupDailyJobs();

const automationsWorker = new Worker<AutomationJobData>(
  AUTOMATIONS_QUEUE_NAME,
  async (job) => {
    await processAutomationJob(job, logger);
  },
  { connection: getRedisConnection(), concurrency: 5 },
);

automationsWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, automationId: job.data.automationId }, 'Automation job completed');
});

automationsWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, automationId: job?.data.automationId, error: error.message }, 'Automation job failed');
});

const workers = AGENT_NAMES.map((agent) => {
  const worker = new Worker<AgentJobData>(
    queueNameForAgent(agent),
    async (job) => {
      await processAgentJob(job, logger);
    },
    { connection: getRedisConnection(), concurrency: 5 },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, agent }, 'Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, agent, error: error.message }, 'Job failed');
  });

  return worker;
});

logger.info({ agents: AGENT_NAMES }, 'Worker started, listening on all agent queues');

async function shutdown(): Promise<void> {
  logger.info('Shutting down worker');
  await Promise.all([...workers, dailyDigestWorker, automationsWorker].map((worker) => worker.close()));
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
