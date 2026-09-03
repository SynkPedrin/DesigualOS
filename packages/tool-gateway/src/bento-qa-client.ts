/**
 * Cliente do bento-qa (porta 8791 no Mac Mini do Bento), o serviço de Q&A
 * com citação obrigatória que a Susy já usa de verdade no WhatsApp
 * (agents/suzy/services/bentoAsk.js no susy-service). Compartilhado entre
 * apps/api (menção no ClickUp) e apps/worker (dispatch do Chat central):
 * uma implementação só, pra não divergir com o tempo.
 */
export interface BentoQAAnswer {
  text: string;
  citations: { n: number; path: string }[];
}

export class BentoQAError extends Error {
  kind: string;
  constructor(message: string, kind: string) {
    super(message);
    this.name = 'BentoQAError';
    this.kind = kind;
  }
}

interface BentoQARawResponse {
  status: string;
  answer?: string;
  citations?: { n: number; path: string }[];
  texto?: string;
  elapsed_ms?: number;
}

function hasCitedAnswer(body: BentoQARawResponse): boolean {
  return Boolean(body.status === 'ok' && (body.answer ?? '').trim() && Array.isArray(body.citations) && body.citations.length > 0);
}

export interface BentoQAConfig {
  url: string;
  token: string;
  timeoutMs?: number;
  channel?: 'whatsapp' | 'clickup';
}

/**
 * Pergunta ao Bento via bento-qa. Timeout sempre explícito, e recusa
 * repassar um "ok" sem citação resolvível (mesma defesa em profundidade que
 * o bento-qa já aplica em si, e que a Susy replica do lado dela).
 */
export async function askBentoQA(config: BentoQAConfig, question: string): Promise<BentoQAAnswer> {
  const timeoutMs = config.timeoutMs ?? 100_000;

  let response: Response;
  try {
    response = await fetch(`${config.url}/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, channel: config.channel ?? 'clickup' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new BentoQAError(
      timeout ? `o Bento não respondeu em ${Math.round(timeoutMs / 1000)}s` : `não consegui falar com o Bento (${(error as Error).message})`,
      timeout ? 'timeout' : 'rede',
    );
  }

  if (!response.ok) {
    let detalhe = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detalhe = body.error;
    } catch {
      // corpo não era JSON, mantém o HTTP status como detalhe
    }
    throw new BentoQAError(detalhe, response.status === 401 ? 'auth' : 'bento');
  }

  const body = (await response.json()) as BentoQARawResponse;
  if (body.status === 'ok' && !hasCitedAnswer(body)) {
    throw new BentoQAError('o Bento respondeu sem fonte resolvível, não repasso isso como fato', 'sem-fonte');
  }

  const text = body.texto ?? `${(body.answer ?? '').trim()}`;
  return { text, citations: body.citations ?? [] };
}
