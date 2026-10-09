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
    /** O corpo JSON inteiro do erro, quando a rota manda mais que `{error, details}`
     *  (ex.: `{conflicts, suggested_slots}` do 409 de Calendar, §19). Opcional — a
     *  maioria dos chamadores só usa `.message`. */
    public readonly body?: unknown,
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

/**
 * CONTA DESATIVADA NÃO É "INFRAESTRUTURA FORA DO AR".
 *
 * `requireAuth` responde 403 "User account is deactivated" pra qualquer rota,
 * e cada tela tinha a própria frase genérica pra erro de query ("não consegui
 * carregar a saúde da infraestrutura", "não consegui carregar X") — nenhuma
 * delas sabia que a causa era a CONTA de quem perguntou, não o que a tela
 * mostra. Resultado medido (08/10/2026): a pessoa lia "infraestrutura" e
 * procurava o problema lá, quando o problema era a própria sessão.
 *
 * Um único lugar sabe disso — aqui, onde toda resposta HTTP já passa — e
 * avisa quem se inscrever (AuthProvider) pra mostrar UM aviso claro em vez
 * de deixar cada tela inventar a própria explicação errada em paralelo.
 */
const MENSAGEM_DE_CONTA_DESATIVADA = 'User account is deactivated';
let aoDesativarConta: (() => void) | null = null;

export function setOnAccountDeactivated(callback: () => void) {
  aoDesativarConta = callback;
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
      if (response.status === 403 && body?.error === MENSAGEM_DE_CONTA_DESATIVADA) {
        aoDesativarConta?.();
      }
      throw new ApiRequestError(body?.error ?? response.statusText, response.status, body?.details, body ?? undefined);
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
