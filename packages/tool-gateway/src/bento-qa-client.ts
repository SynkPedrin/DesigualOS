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
  /**
   * false (default): devolve `body.answer` — o texto limpo, sem cabeçalho de canal nem rodapé
   * "Fontes:" com caminho de arquivo do vault. É o que qualquer consumidor com UI própria quer
   * (o Chat central, que já pega `citations` separado pra montar `sources`).
   * true: devolve `body.texto` — pré-formatado com "🧠 Bento:"/"🧠 Bento responde:" e o bloco
   * "Fontes:\n[n] caminho.md", pronto pra postar cru como comentário. Só faz sentido pra um
   * destino sem UI própria de fontes, como o comentário do ClickUp.
   *
   * Bug real corrigido em 09/09/2026: o default antigo era `body.texto ?? body.answer`, e como
   * `texto` SEMPRE vem preenchido do bento-qa, o Chat central (apps/worker/execute-job.ts)
   * SEMPRE recebia o texto formatado — inclusive o caminho `.md` de arquivo do vault embutido no
   * meio da resposta. Isso ignorava por completo a limpeza feita no lado do bento-qa
   * (stripInlineCitations, stripQuestionEcho etc): a resposta chegava suja de qualquer forma,
   * porque vinha de um campo diferente do que estava sendo limpo.
   */
  preferFormattedText?: boolean;
}

/**
 * Pergunta ao Bento via bento-qa. Timeout sempre explícito, e recusa
 * repassar um "ok" sem citação resolvível (mesma defesa em profundidade que
 * o bento-qa já aplica em si, e que a Susy replica do lado dela).
 */
export async function askBentoQA(config: BentoQAConfig, question: string, operationalContext?: string): Promise<BentoQAAnswer> {
  const timeoutMs = config.timeoutMs ?? 100_000;

  let response: Response;
  try {
    response = await fetch(`${config.url}/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        channel: config.channel ?? 'clickup',
        // Campo SEPARADO de propósito: o bento-qa usa `question` inteira como consulta
        // vetorial, então dado operacional anexado ali envenenava a busca E era
        // interceptado pelo detector de ClickUp dele ("de qual cliente?") sem nunca ser
        // lido. Neste campo o dado é usado só na síntese. Ver askBentoComContextoOperacional
        // no qa.js da máquina do Bento.
        ...(operationalContext ? { operational_context: operationalContext } : {}),
      }),
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

  const text = config.preferFormattedText
    ? (body.texto ?? (body.answer ?? '').trim())
    : (body.answer ?? '').trim() || (body.texto ?? '');
  return { text, citations: body.citations ?? [] };
}
