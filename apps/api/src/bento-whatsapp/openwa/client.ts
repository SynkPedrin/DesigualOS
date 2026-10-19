import type { BentoWhatsappTransport, OpenwaSentMessage, OpenwaSession } from './contract';

/**
 * Cliente HTTP do OpenWA para a sessão do Bento.
 *
 * Escopado a UMA sessão por construção: o id vem da configuração e nenhum
 * método aceita outro. O Bento não tem como enviar pela sessão de um
 * colaborador nem criar uma segunda sessão para o próprio número — não há
 * `createSession` aqui de propósito (conectar o número é ato de uma pessoa com
 * o celular na mão, pelo painel).
 */

export class OpenwaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenwaError';
  }
}

interface OpcoesDoCliente {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenwaClient implements BentoWhatsappTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opcoes: OpcoesDoCliente) {
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
    this.timeoutMs = opcoes.timeoutMs ?? 20_000;
  }

  private sessao(caminho = ''): string {
    return `/api/sessions/${encodeURIComponent(this.opcoes.sessionId)}${caminho}`;
  }

  private async chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
    cabecalhos: Record<string, string> = {},
  ): Promise<Response> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.timeoutMs);
    let resposta: Response;
    try {
      resposta = await this.fetchImpl(`${this.opcoes.baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          'X-API-Key': this.opcoes.apiKey,
          ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...cabecalhos,
        },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        signal: controle.signal,
      });
    } catch (error) {
      // Rede ou timeout: o pedido pode ou não ter chegado. Quem chama decide
      // se repete — e só repete o que tem chave de idempotência.
      const motivo = error instanceof Error ? error.message : String(error);
      throw new OpenwaError(`OpenWA inacessível: ${motivo}`, null, 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
    if (!resposta.ok) {
      let mensagem = `HTTP ${resposta.status}`;
      let codigo: string | null = null;
      try {
        const erro = (await resposta.json()) as { message?: string | string[]; code?: string };
        if (erro.message) mensagem = Array.isArray(erro.message) ? erro.message.join('; ') : erro.message;
        codigo = erro.code ?? null;
      } catch {
        // corpo não-JSON: fica o status
      }
      const repetivel = resposta.status === 429 || resposta.status >= 500;
      throw new OpenwaError(mensagem, resposta.status, codigo, repetivel);
    }
    return resposta;
  }

  async sendText(input: {
    chatId: string;
    text: string;
    quotedMessageId?: string;
    idempotencyKey: string;
  }): Promise<OpenwaSentMessage> {
    const resposta = await this.chamar(
      'POST',
      this.sessao('/messages/send-text'),
      {
        chatId: input.chatId,
        text: input.text,
        linkPreview: false,
        ...(input.quotedMessageId ? { quotedMessageId: input.quotedMessageId } : {}),
      },
      // O OpenWA guarda a resposta por 24h sob esta chave: repetir o envio
      // depois de um timeout devolve a MESMA mensagem em vez de mandar outra.
      { 'Idempotency-Key': input.idempotencyKey },
    );
    return (await resposta.json()) as OpenwaSentMessage;
  }

  async setTyping(input: { chatId: string; state: 'typing' | 'recording' | 'paused' }): Promise<void> {
    await this.chamar('POST', this.sessao('/chats/typing'), input);
  }

  async markRead(input: { chatId: string; messageIds: string[] }): Promise<void> {
    await this.chamar('POST', this.sessao('/chats/read'), {
      chatId: input.chatId,
      messageIds: input.messageIds.slice(0, 100),
    });
  }

  async downloadMedia(input: { chatId: string; messageId: string; maxBytes: number }): Promise<Buffer> {
    const resposta = await this.chamar(
      'GET',
      this.sessao(`/messages/${encodeURIComponent(input.chatId)}/${encodeURIComponent(input.messageId)}/media`),
    );
    const declarado = Number(resposta.headers.get('content-length') ?? '0');
    if (declarado > input.maxBytes) {
      throw new OpenwaError(`Mídia maior que o limite (${declarado} bytes)`, 413, 'TOO_LARGE');
    }
    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (bytes.byteLength > input.maxBytes) {
      throw new OpenwaError(`Mídia maior que o limite (${bytes.byteLength} bytes)`, 413, 'TOO_LARGE');
    }
    return bytes;
  }

  async resolvePhone(contactId: string): Promise<string | null> {
    const resposta = await this.chamar('GET', this.sessao(`/contacts/${encodeURIComponent(contactId)}/phone`));
    const corpo = (await resposta.json()) as { phone?: string | null };
    return corpo.phone ? corpo.phone.replace(/\D/g, '') : null;
  }

  async getSession(): Promise<OpenwaSession> {
    const resposta = await this.chamar('GET', this.sessao());
    return (await resposta.json()) as OpenwaSession;
  }

  async startSession(): Promise<OpenwaSession> {
    const resposta = await this.chamar('POST', this.sessao('/start'));
    return (await resposta.json()) as OpenwaSession;
  }

  async requestPairingCode(phoneNumber: string): Promise<{ pairingCode: string; status: string }> {
    const resposta = await this.chamar('POST', this.sessao('/pairing-code'), { phoneNumber: phoneNumber.replace(/\D/g, '') });
    return (await resposta.json()) as { pairingCode: string; status: string };
  }

  async getQr(): Promise<{ qrCode: string; status: string }> {
    const resposta = await this.chamar('GET', this.sessao('/qr'));
    return (await resposta.json()) as { qrCode: string; status: string };
  }
}
