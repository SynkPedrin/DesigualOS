/**
 * Dublês do canal para testes: armazém em memória, transporte OpenWA falso e
 * Brain falso. Nenhum deles é usado em produção.
 */
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/middleware';
import type { BentoWhatsappConfig } from './config';
import { hashDoCodigo } from './identity';
import type { MensagemRecebida } from './inbound';
import type { BrainDoBento, Despacho, PedidoAoBrain, RespostaDoBrain } from './brain';
import { OpenwaError } from './openwa/client';
import type { BentoWhatsappTransport, OpenwaWebhookEnvelope } from './openwa/contract';
import type { ArmazemDoCanal, AtualizacaoDoRecebido, RegistroRecebido, ResultadoDoCodigo, Vinculo } from './store';

export const SESSAO = '6f1c2b8e-0000-4000-8000-00000000b3e7';
export const BOT = '5518997987295';

export function configDeTeste(extra: Partial<BentoWhatsappConfig> = {}): BentoWhatsappConfig {
  return {
    enabled: true,
    openwaBaseUrl: 'http://openwa.test',
    openwaApiKey: 'owa_k1_test',
    sessionId: SESSAO,
    webhookSecret: 'segredo-de-teste-com-16+',
    botPhone: BOT,
    botExtraIds: [],
    allowedGroups: [],
    transcriptionProvider: 'none',
    documentsEnabled: false,
    agentHint: 'AUTO',
    modoAberto: null,
    aquecimentoMs: 120_000,
    replyTimeoutMs: 1_000,
    progressNoticeMs: 60_000,
    coalesceWindowMs: 5,
    maxTurnsPerHour: 60,
    maxConcurrentTurns: 4,
    maxEventAgeMs: 10 * 60_000,
    conversationIdleHours: 12,
    ...extra,
  };
}

export function usuario(id: string, nome = 'Jamille Teste'): AuthenticatedUser {
  return {
    id,
    email: `${id}@desigual.test`,
    name: nome,
    avatarUrl: null,
    language: 'pt-BR',
    theme: 'system',
    dashboardWidgets: [],
    clickupEmail: null,
    jobTitle: null,
    roles: ['colaborador'],
    permissions: [{ resource: 'chat', action: 'write' }],
  };
}

let seq = 0;
export function envelope(
  data: Record<string, unknown>,
  extra: Partial<OpenwaWebhookEnvelope> = {},
): OpenwaWebhookEnvelope {
  seq += 1;
  return {
    event: 'message.received',
    timestamp: new Date().toISOString(),
    sessionId: SESSAO,
    idempotencyKey: `msg_${SESSAO}_${String(data.id)}_wh1`,
    deliveryId: `dlv_${seq}`,
    data: {
      from: data.chatId,
      to: `${BOT}@c.us`,
      type: 'text',
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: false,
      isGroup: false,
      kind: 'individual',
      ...data,
    },
    ...extra,
  };
}

export function texto(de: string, corpo: string, id = `wamid-${randomUUID()}`): OpenwaWebhookEnvelope {
  return envelope({ id, chatId: `${de}@c.us`, body: corpo });
}

interface LinhaRecebida extends RegistroRecebido {
  reason: string | null;
  replyMessageIds: string[];
  error: string | null;
  attempts: number;
  latencyMs: number | null;
}

interface CodigoEmMemoria {
  userId: string;
  hash: string;
  status: string;
  expiresAt: Date;
}

export class ArmazemEmMemoria implements ArmazemDoCanal {
  recebidas: LinhaRecebida[] = [];
  vinculos: Array<Vinculo & { status: string }> = [];
  codigos: CodigoEmMemoria[] = [];

  vincular(userId: string, telefone: string, extra: Partial<Vinculo> = {}): Vinculo {
    const v = {
      id: randomUUID(),
      userId,
      organizationId: 'org-desigual',
      phone: telefone,
      chatId: `${telefone}@c.us`,
      conversationId: null,
      lastInboundAt: null,
      status: 'active',
      ...extra,
    };
    this.vinculos.push(v);
    return v;
  }

  criarCodigo(userId: string, codigo: string, expiraEmMs = 60_000): void {
    this.codigos.push({ userId, hash: hashDoCodigo(codigo), status: 'pending', expiresAt: new Date(Date.now() + expiraEmMs) });
  }

  async registrar(m: MensagemRecebida) {
    const existente = this.recebidas.find((r) => (r as unknown as { dedupeKey: string }).dedupeKey === m.dedupeKey);
    if (existente) return { id: existente.id, nova: false };
    const linha = {
      id: randomUUID(),
      dedupeKey: m.dedupeKey,
      status: 'received',
      createdAt: new Date(),
      updatedAt: new Date(),
      chatId: m.chatId,
      senderPhone: m.telefone,
      waMessageId: m.waMessageId,
      text: m.texto || null,
      linkId: null,
      userId: null,
      conversationId: null,
      executionId: null,
      reason: null,
      replyMessageIds: [],
      error: null,
      attempts: 0,
      latencyMs: null,
    };
    this.recebidas.push(linha);
    return { id: linha.id, nova: true };
  }

  async atualizar(id: string, patch: AtualizacaoDoRecebido) {
    const linha = this.recebidas.find((r) => r.id === id);
    if (!linha) return;
    const { incrementarTentativas, ...campos } = patch;
    const ignorados = new Set(['processedAt', 'repliedAt', 'organizationId']);
    Object.assign(linha, Object.fromEntries(Object.entries(campos).filter(([k, v]) => v !== undefined && !ignorados.has(k))), {
      updatedAt: new Date(),
    });
    if (incrementarTentativas) linha.attempts += 1;
  }

  async vinculoAtivoPorTelefone(telefone: string) {
    return this.vinculos.find((v) => v.phone === telefone && v.status === 'active') ?? null;
  }

  async definirConversa(linkId: string, conversationId: string | null) {
    const v = this.vinculos.find((x) => x.id === linkId);
    if (v) v.conversationId = conversationId;
  }

  async tocarVinculo(linkId: string, quando: Date) {
    const v = this.vinculos.find((x) => x.id === linkId);
    if (v) v.lastInboundAt = quando;
  }

  async reivindicarCodigo(codigo: string, telefone: string, _chatId: string, agora: Date): Promise<ResultadoDoCodigo> {
    if (this.vinculos.some((v) => v.phone === telefone && v.status === 'active')) return { tipo: 'numero_ja_vinculado' };
    const c = this.codigos.find((x) => x.hash === hashDoCodigo(codigo) && x.status === 'pending' && x.expiresAt >= agora);
    if (!c) return { tipo: 'invalido' };
    c.status = 'claimed';
    return { tipo: 'reivindicado', userId: c.userId };
  }

  async tentativasDeCodigo(telefone: string, desde: Date) {
    return this.recebidas.filter(
      (r) => r.senderPhone === telefone && r.createdAt >= desde && (r.reason ?? '').startsWith('link_code_'),
    ).length;
  }

  async turnosDoUsuario(userId: string, desde: Date) {
    return this.recebidas.filter((r) => r.userId === userId && r.createdAt >= desde && r.conversationId).length;
  }

  async aguardandoConfirmacao(linkId: string, desde: Date) {
    return (
      [...this.recebidas]
        .reverse()
        .find((r) => r.linkId === linkId && r.status === 'awaiting_confirmation' && r.createdAt >= desde) ?? null
    );
  }

  async inacabadas(desde: Date) {
    return this.recebidas.filter((r) => ['received', 'processing', 'dispatched'].includes(r.status) && r.createdAt >= desde);
  }

  linha(id: string) {
    return this.recebidas.find((r) => r.id === id)!;
  }
}

export class TransporteFalso implements BentoWhatsappTransport {
  enviados: Array<{ chatId: string; text: string; idempotencyKey: string; quotedMessageId?: string }> = [];
  digitando: string[] = [];
  lidos: string[] = [];
  /** Erros a lançar nas próximas chamadas de sendText, em ordem. */
  falhasDeEnvio: Error[] = [];
  midias = new Map<string, Buffer>();
  telefonesDeLid = new Map<string, string>();
  private porChave = new Map<string, string>();

  async sendText(input: { chatId: string; text: string; quotedMessageId?: string; idempotencyKey: string }) {
    const falha = this.falhasDeEnvio.shift();
    if (falha) throw falha;
    // Como o OpenWA: mesma chave de idempotência devolve a mesma mensagem.
    const repetida = this.porChave.get(input.idempotencyKey);
    if (repetida) return { messageId: repetida, timestamp: 0 };
    const messageId = `out-${this.enviados.length + 1}`;
    this.porChave.set(input.idempotencyKey, messageId);
    this.enviados.push(input);
    return { messageId, timestamp: Math.floor(Date.now() / 1000) };
  }
  async setTyping(input: { chatId: string; state: string }) {
    this.digitando.push(`${input.chatId}:${input.state}`);
  }
  async markRead(input: { chatId: string; messageIds: string[] }) {
    this.lidos.push(...input.messageIds);
  }
  async downloadMedia(input: { messageId: string }) {
    const m = this.midias.get(input.messageId);
    if (!m) throw new OpenwaError('not found', 404);
    return m;
  }
  async resolvePhone(contactId: string) {
    return this.telefonesDeLid.get(contactId) ?? null;
  }
  async getSession() {
    return { id: SESSAO, name: 'bento', status: 'ready', phone: BOT };
  }
  async startSession() {
    return { id: SESSAO, name: 'bento', status: 'initializing' };
  }
  pedidosDeCodigo: string[] = [];
  async requestPairingCode(phoneNumber: string) {
    this.pedidosDeCodigo.push(phoneNumber);
    return { pairingCode: 'ABCD1234', status: 'qr_ready' };
  }
  async getQr() {
    return { qrCode: 'data:image/png;base64,AAAA', status: 'qr_ready' };
  }
  textos(): string[] {
    return this.enviados.map((e) => e.text);
  }
}

type Roteiro = (pedido: PedidoAoBrain) => RespostaDoBrain | Promise<RespostaDoBrain>;

export class BrainFalso implements BrainDoBento {
  pedidos: PedidoAoBrain[] = [];
  esperas: Array<Despacho & { desde: Date }> = [];
  private contador = 0;
  constructor(public roteiro: Roteiro = (p) => ({ tipo: 'resposta', texto: `resposta para: ${p.mensagem}`, conversationId: p.conversationId ?? 'conv-nova', executionId: 'EXE-1' })) {}

  async perguntar(pedido: PedidoAoBrain, opcoes: { prazoMs: number; aoDespachar?: (d: Despacho) => Promise<void> | void }) {
    this.pedidos.push(pedido);
    this.contador += 1;
    const resposta = await this.roteiro(pedido);
    if (resposta.tipo === 'resposta' || resposta.tipo === 'falhou' || resposta.tipo === 'demorou') {
      if (resposta.conversationId) {
        await opcoes.aoDespachar?.({ conversationId: resposta.conversationId, executionId: `EXE-${this.contador}` });
      }
    }
    return resposta;
  }
  async aguardar(despacho: Despacho & { desde: Date }) {
    this.esperas.push(despacho);
    return { tipo: 'resposta', texto: 'resposta retomada', conversationId: despacho.conversationId, executionId: despacho.executionId } as const;
  }
}

export const logMudo = { info: () => undefined, warn: () => undefined, error: () => undefined };
