import pino, { type Logger } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { service, level = process.env.LOG_LEVEL ?? 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

  if (pretty) {
    return pino({
      level,
      base: { service },
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  return pino({ level, base: { service } });
}

/**
 * Correlaciona todos os logs de uma execução com o mesmo execution_id,
 * exigido pela regra de ouro 7 (toda ação relevante entra em audit_logs).
 */
export function withExecutionId(logger: Logger, executionId: string): Logger {
  return logger.child({ execution_id: executionId });
}

export type { Logger } from 'pino';
