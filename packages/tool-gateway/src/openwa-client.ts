/**
 * openwa-client.ts — cliente HTTP do OpenWA (vendor 'openwa').
 *
 * O OpenWA é a cópia local do projeto `OpenWA-main/` dentro desta mesma
 * pasta de checkout: uma API REST documentada em
 * `OpenWA-main/docs/06-api-specification.md`. A agência não hospeda outra
 * instância — quando há conexão real, é essa cópia local (ou outra
 * instância equivalente) que serve.
 *
 * O que este cliente cobre (o resto do `CommunicationProvider` é opcional):
 *
 *   - envio de texto, imagem, áudio e documento;
 *   - health da sessão (estado retornado por GET /sessions/:id).
 *
 * O Bento no WhatsApp já fala com o OpenWA por conta própria
 * (`apps/api/src/bento-whatsapp/openwa/client.ts`) e expõe a mesma superfície
 * mínima — este cliente existe para a frente da INBOX, que além de enviar
 * precisa ler (chats, contatos, histórico) e receber eventos; os métodos de
 * leitura ficam em `apps/api/src/openwa-integration/`, não aqui, para não
 * entregar ao provider a responsabilidade de sincronizar conversas.
 *
 * Autenticação: header `X-API-Key` (chave de API do OpenWA), mesma convenção
 * documentada na especificação. `Idempotency-Key` no envio permite retry após
 * timeout sem duplicar a mensagem.
 */

export interface OpenwaConfig {
  /** Base URL do OpenWA, sem barra final. */
  baseUrl: string;
  /** Chave de API do OpenWA (scoped a uma ou mais sessões). */
  apiKey: string;
  /**
   * UUID da sessão OpenWA que pertence a esta organização. O OpenWA é
   * multi-sessão: sem este id, o envio não sabe para onde ir.
   */
  sessionId: string;
}

export interface OpenwaSentMessage {
  messageId: string;
  timestamp?: number;
}

export interface OpenwaHealth {
  healthy: boolean;
  detail?: string;
}

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
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class OpenwaClient {
  private readonly timeoutMs: number;

  constructor(private readonly opcoes: OpcoesDoCliente) {
    this.timeoutMs = opcoes.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async requisitar(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
    cabecalhos: Record<string, string> = {},
  ): Promise<Response> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.timeoutMs);
    let resposta: Response;
    try {
      resposta = await fetch(`${this.opcoes.baseUrl}${caminho}`, {
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
      // Rede ou timeout: o pedido pode ou não ter chegado. Repetir é decisão
      // do chamador — e apenas com chave de idempotência.
      const motivo = error instanceof Error ? error.message : String(error);
      throw new OpenwaError(`OpenWA inacessível: ${motivo.replace(/\n/g, ' ')}`, null, 'NETWORK', true);
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
        // corpo não-JSON: fica só o status
      }
      const repetivel = resposta.status === 429 || resposta.status >= 500;
      throw new OpenwaError(mensagem, resposta.status, codigo, repetivel);
    }
    return resposta;
  }

  /** POST /api/sessions/:sessionId/messages/send-text */
  async sendText(input: {
    chatId: string;
    text: string;
    quotedMessageId?: string;
    idempotencyKey: string;
  }): Promise<OpenwaSentMessage> {
    const resposta = await this.requisitar(
      'POST',
      `/api/sessions/${encodeURIComponent(this.opcoes.sessionId)}/messages/send-text`,
      {
        chatId: input.chatId,
        text: input.text,
        linkPreview: false,
        ...(input.quotedMessageId ? { quotedMessageId: input.quotedMessageId } : {}),
      },
      { 'Idempotency-Key': input.idempotencyKey },
    );
    return (await resposta.json()) as OpenwaSentMessage;
  }

  /** POST /api/sessions/:sessionId/messages/send-image */
  async sendImage(input: { chatId: string; url?: string; base64?: string; mimetype: string; filename?: string; caption?: string; idempotencyKey?: string }): Promise<OpenwaSentMessage> {
    return this.enviarMedia('send-image', this.corpoDeMidia(input), input.idempotencyKey);
  }

  /** POST /api/sessions/:sessionId/messages/send-video */
  async sendVideo(input: { chatId: string; url?: string; base64?: string; mimetype: string; filename?: string; caption?: string; idempotencyKey?: string }): Promise<OpenwaSentMessage> {
    return this.enviarMedia('send-video', this.corpoDeMidia(input), input.idempotencyKey);
  }

  /** POST /api/sessions/:sessionId/messages/send-audio */
  async sendAudio(input: { chatId: string; url?: string; base64?: string; mimetype: string; filename?: string; caption?: string; ptt?: boolean; idempotencyKey?: string }): Promise<OpenwaSentMessage> {
    return this.enviarMedia('send-audio', { ...this.corpoDeMidia(input), ...(input.ptt ? { ptt: true } : {}) }, input.idempotencyKey);
  }

  /** POST /api/sessions/:sessionId/messages/send-sticker — o WhatsApp converte qualquer imagem em figurinha. */
  async sendSticker(input: { chatId: string; url?: string; base64?: string; mimetype: string; filename?: string; idempotencyKey?: string }): Promise<OpenwaSentMessage> {
    return this.enviarMedia('send-sticker', this.corpoDeMidia(input), input.idempotencyKey);
  }

  /** POST /api/sessions/:sessionId/messages/send-document */
  async sendDocument(input: { chatId: string; url?: string; base64?: string; mimetype: string; filename: string; idempotencyKey?: string }): Promise<OpenwaSentMessage> {
    return this.enviarMedia('send-document', this.corpoDeMidia(input), input.idempotencyKey);
  }

  private corpoDeMidia(input: { chatId: string; url?: string; base64?: string; mimetype: string; filename?: string; caption?: string }) {
    return {
      chatId: input.chatId,
      ...(input.url ? { url: input.url } : {}),
      ...(input.base64 ? { base64: input.base64 } : {}),
      mimetype: input.mimetype,
      ...(input.filename ? { filename: input.filename } : {}),
      ...(input.caption ? { caption: input.caption } : {}),
    };
  }

  private async enviarMedia(rota: string, corpo: unknown, idempotencyKey?: string): Promise<OpenwaSentMessage> {
    const resposta = await this.requisitar(
      'POST',
      `/api/sessions/${encodeURIComponent(this.opcoes.sessionId)}/messages/${rota}`,
      corpo,
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    );
    return (await resposta.json()) as OpenwaSentMessage;
  }

  /**
   * Health é o estado da própria sessão: se a API responde e a sessão existe,
   * o transporte funciona. O que a sessão representa (conectada ou não) é
   * informação de negócio — quem decida conectá-la é o painel.
   */
  async health(): Promise<OpenwaHealth> {
    const resposta = await this.requisitar('GET', `/api/sessions/${encodeURIComponent(this.opcoes.sessionId)}`);
    const sessao = (await resposta.json()) as { status?: string };
    const saude: OpenwaHealth = { healthy: true };
    if (sessao.status) {
      saude.detail = sessao.status;
    }
    return saude;
  }
}
