export interface OpenwaGatewayConfig {
  baseUrl: string;
  apiKey: string;
  sessionId?: string;
  timeoutMs?: number;
}

export interface OpenwaSessionSnapshot {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  pushName: string | null;
  connectedAt: string | null;
  lastActive: string | null;
  lastError: string | null;
  engineLoaded: boolean;
}

export interface OpenwaChat {
  id: string;
  name: string | null;
  kind: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number | null;
  lastMessage: string | null;
  lastMessageType: string | null;
  archived: boolean;
  pinned: boolean;
}

export interface OpenwaContact {
  id: string;
  name: string | null;
  pushName: string | null;
  number: string | null;
  profilePicUrl: string | null;
  isMyContact?: boolean;
}

export interface OpenwaMedia {
  mimetype: string;
  filename?: string;
  data?: string;
  omitted?: boolean;
  sizeBytes?: number;
}

export interface OpenwaMessage {
  id: string;
  chatId: string;
  from: string | null;
  to: string | null;
  author: string | null;
  body: string | null;
  type: string;
  timestamp: number | null;
  fromMe: boolean;
  isGroup: boolean;
  kind: string;
  direction: 'incoming' | 'outgoing';
  status: string | null;
  senderPhone?: string | null | undefined;
  contact?: { name?: string; pushName?: string; number?: string; profilePicUrl?: string } | undefined;
  media?: OpenwaMedia | undefined;
}

export class OpenwaGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenwaGatewayError';
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeSession(raw: Record<string, unknown>): OpenwaSessionSnapshot {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    status: text(raw.status) ?? 'unknown',
    phone: text(raw.phone),
    pushName: text(raw.pushName),
    connectedAt: text(raw.connectedAt),
    lastActive: text(raw.lastActive),
    lastError: text(raw.lastError),
    engineLoaded: raw.engineLoaded === true,
  };
}

function normalizeMessage(raw: Record<string, unknown>): OpenwaMessage {
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata as Record<string, unknown> : null;
  const rawMedia = (raw.media ?? metadata?.media) as Record<string, unknown> | undefined;
  return {
    id: String(raw.waMessageId ?? raw.id ?? ''),
    chatId: String(raw.chatId ?? ''),
    from: text(raw.from),
    to: text(raw.to),
    author: text(raw.author),
    body: text(raw.body),
    type: text(raw.type) ?? 'unknown',
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : null,
    fromMe: raw.fromMe === true || raw.direction === 'outgoing',
    isGroup: raw.isGroup === true || raw.kind === 'group',
    kind: text(raw.kind) ?? (raw.isGroup === true ? 'group' : 'individual'),
    direction: raw.direction === 'outgoing' || raw.fromMe === true ? 'outgoing' : 'incoming',
    status: text(raw.status),
    senderPhone: text(raw.senderPhone),
    contact: raw.contact && typeof raw.contact === 'object' ? raw.contact as OpenwaMessage['contact'] : undefined,
    media: rawMedia ? {
      mimetype: String(rawMedia.mimetype ?? raw.mediaMimetype ?? 'application/octet-stream'),
      ...(text(rawMedia.filename) ? { filename: text(rawMedia.filename)! } : {}),
      ...(text(rawMedia.data) ? { data: text(rawMedia.data)! } : {}),
      ...(rawMedia.omitted === true ? { omitted: true } : {}),
      ...(typeof rawMedia.sizeBytes === 'number' ? { sizeBytes: rawMedia.sizeBytes } : {}),
    } : undefined,
  };
}

export class OpenwaGatewayClient {
  private readonly timeoutMs: number;

  constructor(private readonly config: OpenwaGatewayConfig) {
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private sessionPath(suffix = ''): string {
    if (!this.config.sessionId) throw new Error('OpenWA sessionId ausente');
    return `/api/sessions/${encodeURIComponent(this.config.sessionId)}${suffix}`;
  }

  private async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = this.timeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'X-API-Key': this.config.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new OpenwaGatewayError(`OpenWA inacessível: ${reason.replace(/\n/g, ' ')}`, null, 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let message = `OpenWA respondeu HTTP ${response.status}`;
      let code: string | null = null;
      try {
        const payload = await response.json() as { message?: string | string[]; code?: string };
        if (payload.message) message = Array.isArray(payload.message) ? payload.message.join('; ') : payload.message;
        code = payload.code ?? null;
      } catch {
        // Mantém o status quando a resposta não tem JSON.
      }
      throw new OpenwaGatewayError(message, response.status, code, response.status === 429 || response.status >= 500);
    }
    return response;
  }

  async createSession(name: string): Promise<OpenwaSessionSnapshot> {
    const response = await this.request('POST', '/api/sessions', { name, config: { maxReconnectAttempts: null, reconnectBaseDelay: 5000 } });
    return normalizeSession(await response.json() as Record<string, unknown>);
  }

  async createScopedOperatorKey(name: string, sessionId: string): Promise<{ id: string; apiKey: string }> {
    const response = await this.request('POST', '/api/auth/api-keys', { name, role: 'operator', allowedSessions: [sessionId] });
    const raw = await response.json() as Record<string, unknown>;
    const apiKey = text(raw.apiKey);
    const id = text(raw.id);
    if (!apiKey || !id) throw new OpenwaGatewayError('OpenWA não retornou a chave escopada da sessão', 502, 'INVALID_KEY_RESPONSE');
    return { id, apiKey };
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.request('POST', `/api/auth/api-keys/${encodeURIComponent(id)}/revoke`);
  }

  async deleteSession(id: string): Promise<void> {
    await this.request('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  }

  async getSession(): Promise<OpenwaSessionSnapshot> {
    const response = await this.request('GET', this.sessionPath());
    return normalizeSession(await response.json() as Record<string, unknown>);
  }

  async startSession(): Promise<OpenwaSessionSnapshot> {
    const response = await this.request('POST', this.sessionPath('/start'));
    return normalizeSession(await response.json() as Record<string, unknown>);
  }

  /**
   * O POST /start do OpenWA só responde quando o Chromium e o WhatsApp Web
   * terminam de subir — 30 s a 2 min num VPS. Quem pede a conexão não pode
   * esperar isso: o OpenWA continua subindo o engine mesmo que o cliente
   * desista da resposta, e o QR aparece pelo status da sessão. Por isso aqui
   * a espera é curta e "ainda subindo" (timeout) ou "já está subindo" (400)
   * contam como sucesso; o resto é erro de verdade.
   */
  async requestStart(waitMs = 4_000): Promise<'started' | 'starting'> {
    try {
      await this.request('POST', this.sessionPath('/start'), undefined, {}, waitMs);
      return 'started';
    } catch (error) {
      if (error instanceof OpenwaGatewayError && error.code === 'NETWORK' && /abort/i.test(error.message)) return 'starting';
      if (error instanceof OpenwaGatewayError && error.status === 400 && /already (started|starting)/i.test(error.message)) return 'starting';
      throw error;
    }
  }

  async stopSession(): Promise<OpenwaSessionSnapshot> {
    const response = await this.request('POST', this.sessionPath('/stop'));
    return normalizeSession(await response.json() as Record<string, unknown>);
  }

  async logoutSession(): Promise<OpenwaSessionSnapshot> {
    const response = await this.request('POST', this.sessionPath('/logout'));
    return normalizeSession(await response.json() as Record<string, unknown>);
  }

  async getQr(): Promise<{ qrCode: string; status: string }> {
    const response = await this.request('GET', this.sessionPath('/qr'));
    const raw = await response.json() as Record<string, unknown>;
    const qrCode = text(raw.qrCode);
    if (!qrCode?.startsWith('data:image/png;base64,')) throw new OpenwaGatewayError('OpenWA não retornou um QR Code PNG válido', 502, 'INVALID_QR');
    return { qrCode, status: text(raw.status) ?? 'qr_ready' };
  }

  async listWebhooks(): Promise<Array<{ id: string; url: string; events: string[]; active: boolean }>> {
    const response = await this.request('GET', this.sessionPath('/webhooks'));
    return await response.json() as Array<{ id: string; url: string; events: string[]; active: boolean }>;
  }

  async createWebhook(input: { url: string; secret: string }): Promise<{ id: string }> {
    const response = await this.request('POST', this.sessionPath('/webhooks'), {
      url: input.url,
      secret: input.secret,
      events: ['message.received', 'message.sent', 'message.ack', 'message.failed', 'message.edited', 'message.revoked', 'session.status', 'session.authenticated', 'session.disconnected', 'session.reconnect_loop', 'group.update'],
      retryCount: 5,
    });
    const raw = await response.json() as Record<string, unknown>;
    const id = text(raw.id);
    if (!id) throw new OpenwaGatewayError('OpenWA não retornou o id do webhook', 502, 'INVALID_WEBHOOK_RESPONSE');
    return { id };
  }

  async updateWebhook(webhookId: string, input: { url: string; secret: string }): Promise<void> {
    await this.request('PUT', this.sessionPath(`/webhooks/${encodeURIComponent(webhookId)}`), input);
  }

  /**
   * Lenta de propósito no OpenWA: monta no navegador o modelo de cada conversa
   * (grupo busca metadados no WhatsApp). Logo após conectar, com o celular
   * ainda enviando o histórico, uma conta grande passa de minutos — medido em
   * produção em 19/10/2026: >170 s. Por isso o limite próprio, bem maior.
   */
  async chats(): Promise<OpenwaChat[]> {
    const response = await this.request('GET', this.sessionPath('/chats?limit=1000'), undefined, {}, 10 * 60_000);
    const rows = await response.json() as Array<Record<string, unknown>>;
    return rows.map((raw) => ({
      id: String(raw.id ?? ''),
      name: text(raw.name),
      kind: text(raw.kind) ?? (raw.isGroup === true ? 'group' : 'individual'),
      isGroup: raw.isGroup === true || raw.kind === 'group',
      unreadCount: typeof raw.unreadCount === 'number' ? raw.unreadCount : 0,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : null,
      lastMessage: text(raw.lastMessage),
      lastMessageType: text(raw.lastMessageType),
      archived: raw.archived === true,
      pinned: raw.pinned === true,
    }));
  }

  /** Pagina a agenda inteira (o OpenWA entrega no máximo 1000 por chamada). */
  async contacts(maxContacts = 5000): Promise<OpenwaContact[]> {
    const pageSize = 1000;
    const all: OpenwaContact[] = [];
    for (let offset = 0; offset < maxContacts; offset += pageSize) {
      const response = await this.request('GET', this.sessionPath(`/contacts?limit=${pageSize}&offset=${offset}`));
      const rows = await response.json() as Array<Record<string, unknown>>;
      for (const raw of rows) {
        all.push({
          id: String(raw.id ?? ''),
          name: text(raw.name),
          pushName: text(raw.pushName),
          number: text(raw.number),
          profilePicUrl: text(raw.profilePicUrl),
          isMyContact: raw.isMyContact === true,
        });
      }
      if (rows.length < pageSize) break;
    }
    return all;
  }

  /**
   * Fotos de perfil em lote (até 50 ids por chamada). O whatsapp-web.js nunca
   * preenche `profilePicUrl` na lista de contatos, então sem isto ninguém tem
   * foto. Id sem foto, ou que o WhatsApp não respondeu, volta null.
   */
  async profilePictures(ids: string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const response = await this.request('GET', this.sessionPath(`/contacts/profile-pictures?ids=${batch.map(encodeURIComponent).join(',')}`), undefined, {}, 60_000);
      const raw = await response.json() as { pictures?: Record<string, unknown> };
      for (const id of batch) result[id] = text(raw.pictures?.[id]);
    }
    return result;
  }

  async group(groupId: string): Promise<{ id: string; name: string; participants: Array<Record<string, unknown>> }> {
    const response = await this.request('GET', this.sessionPath(`/groups/${encodeURIComponent(groupId)}`));
    const raw = await response.json() as Record<string, unknown>;
    return {
      id: String(raw.id ?? groupId),
      name: text(raw.name) ?? 'Grupo WhatsApp',
      participants: Array.isArray(raw.participants) ? raw.participants as Array<Record<string, unknown>> : [],
    };
  }

  async history(chatId: string, limit = 10): Promise<OpenwaMessage[]> {
    try {
      const response = await this.request('GET', this.sessionPath(`/messages/${encodeURIComponent(chatId)}/history?limit=${limit}&includeMedia=false`), undefined, {}, 90_000);
      const rows = await response.json() as Array<Record<string, unknown>>;
      return rows.map(normalizeMessage);
    } catch (error) {
      if (!(error instanceof OpenwaGatewayError) || error.status !== 501) throw error;
      const response = await this.request('GET', this.sessionPath(`/messages?chatId=${encodeURIComponent(chatId)}&limit=${limit}&orderBy=timestamp&inlineMedia=false`));
      const raw = await response.json() as { messages?: Array<Record<string, unknown>> };
      return (raw.messages ?? []).map(normalizeMessage).reverse();
    }
  }

  async downloadMedia(chatId: string, messageId: string, maxBytes: number): Promise<{ bytes: Buffer; mimetype: string }> {
    const response = await this.request('GET', this.sessionPath(`/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/media`));
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) throw new OpenwaGatewayError('Mídia acima do limite permitido', 413, 'MEDIA_TOO_LARGE');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new OpenwaGatewayError('Mídia acima do limite permitido', 413, 'MEDIA_TOO_LARGE');
    return { bytes, mimetype: response.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async convertVoice(base64: string): Promise<{ base64: string; mimetype: string }> {
    const response = await this.request('POST', this.sessionPath('/media/convert/voice'), { base64 });
    const raw = await response.json() as Record<string, unknown>;
    const converted = text(raw.base64);
    if (!converted) throw new OpenwaGatewayError('OpenWA não retornou o áudio convertido', 502, 'INVALID_CONVERSION_RESPONSE');
    return { base64: converted, mimetype: text(raw.mimetype) ?? 'audio/ogg; codecs=opus' };
  }

  async markRead(chatId: string, messageIds: string[] = []): Promise<void> {
    await this.request('POST', this.sessionPath('/chats/read'), { chatId, ...(messageIds.length ? { messageIds } : {}) });
  }
}

export function normalizeOpenwaMessage(raw: Record<string, unknown>): OpenwaMessage {
  return normalizeMessage(raw);
}
