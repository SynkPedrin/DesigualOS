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

export function setAccessTokenProvider(provider: () => string | null) {
  accessTokenProvider = provider;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = accessTokenProvider?.() ?? null;
  const headers = new Headers(init?.headers);
  // FormData bodies (file uploads) need the browser to set Content-Type itself
  // (multipart boundary included); setting it manually breaks the upload.
  if (!(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(body?.error ?? response.statusText, response.status, body?.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
