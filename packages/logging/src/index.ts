import pino, { type Logger } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

/**
 * Loggers-raiz por (level, pretty). Cada `pino({ transport })` sobe uma worker
 * thread de pino-pretty E registra um `process.on('exit')` enquanto ela não
 * fica pronta (pino/lib/transport.js: buildStream). Como os 16 call sites de
 * createLogger são `const logger = createLogger(...)` em escopo de MÓDULO,
 * todos rodavam no import, antes de qualquer thread ficar pronta: 16 threads e
 * 16 listeners de uma vez no worker em dev — era daí que vinha o
 * MaxListenersExceededWarning ("11 exit listeners added to [process]").
 *
 * Um transport por configuração, N loggers filhos: o processo passa a ter UMA
 * thread e UM listener (que o próprio pino remove no 'ready'). Cada serviço
 * continua com o campo `service` próprio via child().
 */
const roots = new Map<string, Logger>();

function rootLogger(level: string, pretty: boolean): Logger {
  const key = `${level}|${pretty}`;
  const existing = roots.get(key);
  if (existing) return existing;

  // base: null remove pid/hostname do payload. Antes cada logger passava
  // `base: { service }`, que também os removia; manter assim preserva o
  // formato do log em produção (onde não há pino-pretty pra esconder campo).
  const root = pretty
    ? pino({
        level,
        base: null,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      })
    : pino({ level, base: null });

  roots.set(key, root);
  return root;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { service, level = process.env.LOG_LEVEL ?? 'info', pretty = process.env.NODE_ENV !== 'production' } = options;
  return rootLogger(level, pretty).child({ service });
}

/**
 * Correlaciona todos os logs de uma execução com o mesmo execution_id,
 * exigido pela regra de ouro 7 (toda ação relevante entra em audit_logs).
 */
export function withExecutionId(logger: Logger, executionId: string): Logger {
  return logger.child({ execution_id: executionId });
}

export type { Logger } from 'pino';

/**
 * P0-03 (auditoria de release readiness, 22/09/2026): o WebSocket recebe o
 * bearer Supabase na query string (`/ws?token=...` — o WebSocket nativo do
 * browser não permite header Authorization no handshake, ver ws/routes.ts),
 * e o logger de request/response do Fastify grava a URL completa por
 * padrão. Confirmado: 2.242 ocorrências de `/ws?token=` em 8 MB de log, 13
 * tokens distintos, 2 ainda válidos no momento da coleta.
 *
 * Mascara SÓ o valor do parâmetro `token`, preservando o resto da URL (path,
 * outros query params) — é isso que mantém o log útil pra depuração sem
 * carregar a credencial. Cobre `?token=` e `&token=` em qualquer posição.
 */
const TOKEN_QUERY_PARAM = /([?&]token=)[^&\s]+/gi;

export function redactTokenFromUrl(url: string): string {
  return url.replace(TOKEN_QUERY_PARAM, '$1[REDACTED]');
}

export { getReleaseInfo, type ReleaseInfo } from './release-info.js';
