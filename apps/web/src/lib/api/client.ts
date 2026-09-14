import type { ApiError } from './contracts';

/**
 * Single entry point for every API call in the app.
 * `NEXT_PUBLIC_API_MODE=mock` (default) serves requests from MSW, registered in
 * src/mocks. `NEXT_PUBLIC_API_MODE=live` points at NEXT_PUBLIC_API_URL, the real
 * Orchestrator. No component should ever import from src/mocks directly.
 */
const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';
const API_BASE_URL = API_MODE === 'live' ? (process.env.NEXT_PUBLIC_API_URL ?? '') : '';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Set by the auth layer once Supabase login is wired up (later phase). Until then, undefined. */
let accessTokenProvider: (() => string | null) | null = null;

/** Provider assíncrono para o boot: queries que disparam antes do
 * getSession() inicial resolver iam SEM token e voltavam 401, gerando um
 * retry e um erro de console em toda carga de página (medido na auditoria
 * de performance: 1x 401 /me em TODA rota). Agora o primeiro token é
 * aguardado (com teto) em vez de sair sem ele. */
let accessTokenAsyncProvider: (() => Promise<string | null>) | null = null;

export function setAccessTokenProvider(provider: () => string | null) {
  accessTokenProvider = provider;
}

export function setAccessTokenAsyncProvider(provider: () => Promise<string | null>) {
  accessTokenAsyncProvider = provider;
}

/** Timeout default de toda chamada. Uploads de anexos passam um teto maior
 * via `timeoutMs` (arquivo grande em conexão lenta estouraria 30s fácil). */
export const API_FETCH_DEFAULT_TIMEOUT_MS = 30_000;
export const API_FETCH_UPLOAD_TIMEOUT_MS = 120_000;

export interface ApiFetchOptions {
  timeoutMs?: number;
}

export async function apiFetch<T>(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<T> {
  let token = accessTokenProvider?.() ?? null;
  if (!token && accessTokenAsyncProvider) {
    token = await accessTokenAsyncProvider().catch(() => null);
  }
  const headers = new Headers(init?.headers);
  // FormData bodies (file uploads) need the browser to set Content-Type itself
  // (multipart boundary included); setting it manually breaks the upload.
  if (!(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const callerSignal = init?.signal ?? null;
  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options?.timeoutMs ?? API_FETCH_DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      throw new ApiRequestError(body?.error ?? response.statusText, response.status, body?.details);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    // Timeout vira ApiRequestError com status 0 (nenhuma resposta chegou) pra
    // cair no tratamento de erro já existente dos hooks com mensagem humana.
    if (timedOut && error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError('A conexão demorou demais. Tente novamente.', 0);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}
