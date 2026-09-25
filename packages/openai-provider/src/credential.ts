/**
 * Resolução da credencial OpenAI. Verificado em 2026-09-25 (auditoria desta
 * missão): não existe nenhuma credencial OpenAI gravada em tabela do
 * Supabase hoje — o único ponto de leitura existente é
 * `packages/otto-motion/src/providers/connection.ts`, que também lê
 * `OPENAI_API_KEY` de env (para um propósito não relacionado, o Motion
 * Engine). Este módulo segue o mesmo padrão: variável de ambiente
 * server-side, nunca logada, nunca exposta ao frontend.
 *
 * Se no futuro a credencial passar a viver em uma tabela (ex:
 * `integration_connections` com provider 'openai', mesmo padrão do ClickUp
 * em `apps/api/src/integrations/access.ts`), só este arquivo precisa mudar —
 * todo o resto do pacote consome `resolveOpenAICredential()`.
 */

export interface OpenAICredential {
  apiKey: string;
}

export class OpenAICredentialMissingError extends Error {
  constructor() {
    super(
      'OPENAI_API_KEY não configurada. Nenhuma chamada à OpenAI pode ser feita até a credencial existir no ambiente do servidor (nunca no frontend).',
    );
    this.name = 'OpenAICredentialMissingError';
  }
}

/**
 * Nunca logar `apiKey`. Nunca serializar este objeto em resposta HTTP.
 * Chamadores devem tratar `OpenAICredentialMissingError` como sinal para
 * degradar explicitamente (ex: `/ready` reporta `configured: false`), nunca
 * para cair silenciosamente em outro provider.
 */
export function resolveOpenAICredential(): OpenAICredential {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAICredentialMissingError();
  }
  return { apiKey };
}

/** Uso em `/ready`: existência da credencial, sem tentar autenticar contra a OpenAI (zero-cost). */
export function isOpenAICredentialConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
