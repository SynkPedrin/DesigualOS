import { openwaIncomingMessageSchema, type OpenwaWebhookEnvelope } from './openwa/contract';
import { telefoneDoJid } from './identity';

/**
 * Do envelope do OpenWA para a mensagem que o gateway entende.
 *
 * Também é aqui que se decide o que NEM ENTRA: evento que não é mensagem
 * recebida, eco das mensagens do próprio Bento, status/broadcast/canal. Isso
 * acontece antes de qualquer gravação, porque o OpenWA manda `message.sent`
 * para tudo que o número envia — inclusive as respostas do Bento — e tratar
 * isso como pedido é o loop clássico de bot.
 */

export type TipoDeMensagem = 'text' | 'audio' | 'image' | 'document' | 'other';

export interface MidiaRecebida {
  mimetype: string;
  filename: string | null;
  /** base64 quando o OpenWA mandou inline (até ~768 KiB). */
  base64: string | null;
  sizeBytes: number | null;
}

export interface MensagemRecebida {
  /** `<sessão>:<id da mensagem>` — igual para retries e para dois webhooks da mesma sessão. */
  dedupeKey: string;
  sessionId: string;
  waMessageId: string;
  /** Onde responder: o privado da pessoa, ou o grupo. */
  chatId: string;
  /** Quem escreveu: o próprio chatId no privado, o `author` no grupo. */
  remetenteJid: string;
  /** Telefone do remetente quando já dá para saber sem consultar o OpenWA. */
  telefone: string | null;
  isGroup: boolean;
  tipo: TipoDeMensagem;
  texto: string;
  midia: MidiaRecebida | null;
  mencoes: string[];
  citadaId: string | null;
  enviadaEm: Date | null;
}

export type ResultadoDaNormalizacao =
  | { tipo: 'mensagem'; mensagem: MensagemRecebida }
  | { tipo: 'ignorar'; motivo: string };

function tipoDaMensagem(tipoDoEngine: string, temMidia: boolean): TipoDeMensagem {
  switch (tipoDoEngine) {
    case 'text':
      return 'text';
    case 'audio':
    case 'voice':
      return 'audio';
    case 'image':
      return 'image';
    case 'document':
      return 'document';
    default:
      return temMidia ? 'other' : tipoDoEngine === 'unknown' ? 'text' : 'other';
  }
}

export function normalizarEvento(envelope: OpenwaWebhookEnvelope): ResultadoDaNormalizacao {
  if (envelope.event !== 'message.received') return { tipo: 'ignorar', motivo: `evento:${envelope.event}` };
  const parse = openwaIncomingMessageSchema.safeParse(envelope.data);
  if (!parse.success) return { tipo: 'ignorar', motivo: 'payload_invalido' };
  const dado = parse.data;

  // Anti-loop, primeira barreira: o que o próprio número mandou.
  if (dado.fromMe) return { tipo: 'ignorar', motivo: 'own_message' };
  if (dado.isStatusBroadcast || dado.chatId === 'status@broadcast') return { tipo: 'ignorar', motivo: 'status_broadcast' };
  if (dado.kind && !['individual', 'group'].includes(dado.kind)) return { tipo: 'ignorar', motivo: `kind:${dado.kind}` };

  const isGroup = dado.isGroup || dado.chatId.endsWith('@g.us');
  const remetenteJid = isGroup ? (dado.author ?? '') : dado.chatId;
  if (!remetenteJid) return { tipo: 'ignorar', motivo: 'sem_remetente' };

  const telefone =
    (dado.senderPhone ? dado.senderPhone.replace(/\D/g, '') : null) || telefoneDoJid(remetenteJid) || null;

  const midia = dado.media
    ? {
        mimetype: dado.media.mimetype,
        filename: dado.media.filename ?? null,
        base64: dado.media.data && !dado.media.omitted ? dado.media.data : null,
        sizeBytes: dado.media.sizeBytes ?? null,
      }
    : null;

  return {
    tipo: 'mensagem',
    mensagem: {
      dedupeKey: `${envelope.sessionId}:${dado.id}`,
      sessionId: envelope.sessionId,
      waMessageId: dado.id,
      chatId: dado.chatId,
      remetenteJid,
      telefone,
      isGroup,
      tipo: tipoDaMensagem(dado.type, Boolean(midia)),
      texto: (dado.body ?? '').trim(),
      midia,
      mencoes: dado.mentionedIds ?? [],
      citadaId: dado.quotedMessage?.id ?? null,
      enviadaEm: dado.timestamp ? new Date(dado.timestamp * 1000) : null,
    },
  };
}

/**
 * Em grupo, o Bento só responde quando chamado: menção ao número dele, ou a
 * mensagem começando por "Bento" / "@Bento". Responder a tudo num grupo é
 * ruído e é vazamento esperando acontecer.
 */
export function mencionaOBento(mensagem: MensagemRecebida, idsDoBento: string[]): boolean {
  const ids = new Set(idsDoBento.map((id) => id.toLowerCase()));
  if (mensagem.mencoes.some((id) => ids.has(id.toLowerCase()))) return true;
  return /^\s*@?bento\b/i.test(mensagem.texto);
}
