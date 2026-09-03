import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/**
 * Caches the start() promise so React Strict Mode's double effect invocation
 * in dev does not call worker.start() twice, which throws ("cannot configure
 * an already enabled network") on the second call.
 */
let startPromise: ReturnType<typeof worker.start> | null = null;

export function startWorkerOnce(): ReturnType<typeof worker.start> {
  startPromise ??= worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  return startPromise;
}
