/**
 * Cliente do `POST /internal/ask` do agentes-desigual (susy-service), o
 * serviço Express (porta 3102) que já roda em produção nos Mac Minis do
 * Jarbas e da Suzy e que é a fonte de verdade do WhatsApp/Instagram de
 * clientes reais. A rota despacha pro `answerQuestion()` de cada agente,
 * que reaproveita o cérebro real já usado no WhatsApp (bentoAsk,
 * openclawBrain, Ollama) — nenhuma lógica nova foi criada lá, então aqui
 * também não existe nenhuma.
 *
 * Compartilhado entre apps/api (menção no ClickUp) e apps/worker (dispatch
 * do Chat central), mesmo padrão do bento-qa-client.ts.
 */
export class AgentAskError extends Error {
  kind: string;
  constructor(message: string, kind: string) {
    super(message);
    this.name = 'AgentAskError';
    this.kind = kind;
  }
}

export interface AgentAskConfig {
  url: string;
  token: string;
  agent: 'jarbas' | 'suzy';
  timeoutMs?: number;
}

interface AgentAskRawResponse {
  ok?: boolean;
  agent?: string;
  answer?: string;
  error?: string;
}

const AGENT_LABEL: Record<AgentAskConfig['agent'], string> = {
  jarbas: 'o Jarbas',
  suzy: 'a Suzy',
};

/**
 * Pergunta direta a um agente do agentes-desigual. Timeout sempre explícito.
 * `sessionId` vira a chave de sessão/histórico do lado do agente
 * (equivalente ao "phone" do WhatsApp), então o chamador deve mandar um id
 * estável por conversa quando quiser continuidade de contexto.
 */
export async function askAgent(config: AgentAskConfig, text: string, sessionId?: string): Promise<string> {
  const timeoutMs = config.timeoutMs ?? 100_000;
  const label = AGENT_LABEL[config.agent];

  let response: Response;
  try {
    response = await fetch(`${config.url}/internal/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: config.agent, text, sessionId: sessionId ?? 'internal-orchestrator' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new AgentAskError(
      timeout ? `${label} não respondeu em ${Math.round(timeoutMs / 1000)}s` : `não consegui falar com ${label} (${(error as Error).message})`,
      timeout ? 'timeout' : 'rede',
    );
  }

  if (!response.ok) {
    let detalhe = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as AgentAskRawResponse;
      if (body?.error) detalhe = body.error;
    } catch {
      // corpo não era JSON, mantém o HTTP status como detalhe
    }
    throw new AgentAskError(detalhe, response.status === 401 || response.status === 403 ? 'auth' : 'agente');
  }

  const body = (await response.json()) as AgentAskRawResponse;
  const answer = (body.answer ?? '').trim();
  if (!body.ok || !answer) {
    throw new AgentAskError(`${label} respondeu vazio, não repasso isso como resposta`, 'vazio');
  }
  return answer;
}
