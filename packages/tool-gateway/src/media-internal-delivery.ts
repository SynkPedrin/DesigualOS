import { buildInternalAlertMessage, type InternalAlertInput } from './media-internal-messages';
import type { EnvioInterno, ResultadoDoEnvio } from './bento-channel';

/**
 * media-internal-delivery.ts — a entrega dos avisos internos de mídia, com
 * estado, para que "o Bento estava desconectado" não signifique "a Alicia nunca
 * soube que o saldo acabou".
 *
 * O motor de alertas deduplica por regra + cooldown: depois que o evento nasce,
 * ele NÃO dispara de novo por 24 h. Se a mensagem interna falhasse uma vez e o
 * estado não ficasse registrado, o aviso se perderia. Por isso o estado de cada
 * destinatário vive no próprio evento (`detail.internal`) e o worker reenvia o
 * que ficou pendente, dentro do horário permitido, por até 12 h.
 *
 * O estado é puro dado (JSON) e as funções recebem o sender e o relógio de
 * fora: testável sem banco e sem WhatsApp.
 */

export const MAX_TENTATIVAS = 5;
/** Aviso velho não vale mais mensagem: passadas 12 h, o evento fica só na Central. */
export const VALIDADE_DO_AVISO_MS = 12 * 3_600_000;

export type PayloadDoAviso = Omit<InternalAlertInput, 'recipientName' | 'now'>;

export interface EntregaInterna {
  name: string;
  phone: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  error?: string;
  sentAt?: string;
}

export interface EstadoInterno {
  /** Há alguma entrega que ainda pode acontecer? É o que o reenvio consulta. */
  open: boolean;
  payload: PayloadDoAviso;
  deliveries: EntregaInterna[];
  expired?: boolean;
}

export type EnviadorInterno = (envio: EnvioInterno) => Promise<ResultadoDoEnvio>;

/** Falhas de INFRAESTRUTURA (Bento fora, canal desligado, limite) não gastam tentativa: o aviso espera. */
const NAO_GASTA_TENTATIVA = new Set(['canal_desligado', 'sem_sessao', 'sessao_nao_pronta', 'limite_de_envio']);

function aindaPodeEntregar(entregas: EntregaInterna[]): boolean {
  return entregas.some((e) => e.status !== 'sent' && e.attempts < MAX_TENTATIVAS);
}

export function novoEstadoInterno(payload: PayloadDoAviso, destinatarios: Array<{ name: string; phone: string }>): EstadoInterno {
  const deliveries: EntregaInterna[] = destinatarios.map((d) => ({ name: d.name, phone: d.phone, status: 'pending', attempts: 0 }));
  return { open: deliveries.length > 0, payload, deliveries };
}

export interface ResultadoDaRodada {
  estado: EstadoInterno;
  enviadas: number;
  falhas: number;
  adiadas: number;
}

/**
 * Uma rodada de tentativas. `dentroDaJanela=false` adia tudo sem gastar
 * tentativa (não se acorda ninguém de madrugada por um aviso de mídia).
 */
export async function tentarEntregas(
  estadoAtual: EstadoInterno,
  contexto: { eventId: string; now: Date; sender: EnviadorInterno; dentroDaJanela: boolean },
): Promise<ResultadoDaRodada> {
  const estado: EstadoInterno = { ...estadoAtual, deliveries: estadoAtual.deliveries.map((d) => ({ ...d })) };
  let enviadas = 0;
  let falhas = 0;
  let adiadas = 0;

  for (const entrega of estado.deliveries) {
    if (entrega.status === 'sent' || entrega.attempts >= MAX_TENTATIVAS) continue;
    if (!contexto.dentroDaJanela) {
      adiadas += 1;
      continue;
    }
    const texto = buildInternalAlertMessage({ ...estado.payload, recipientName: entrega.name, now: contexto.now });
    const resultado = await contexto.sender({
      phone: entrega.phone,
      text: texto,
      // Estável por evento+pessoa: um retry depois de timeout devolve a mesma mensagem.
      idempotencyKey: `media-alert-internal:${contexto.eventId}:${entrega.phone}`,
    });
    if (resultado.ok) {
      entrega.status = 'sent';
      entrega.sentAt = contexto.now.toISOString();
      delete entrega.error;
      enviadas += 1;
      continue;
    }
    falhas += 1;
    entrega.status = 'failed';
    entrega.error = `${resultado.motivo}: ${resultado.erro}`.slice(0, 300);
    if (!NAO_GASTA_TENTATIVA.has(resultado.motivo)) entrega.attempts += 1;
    if (!resultado.repetivel) entrega.attempts = MAX_TENTATIVAS;
  }

  estado.open = aindaPodeEntregar(estado.deliveries);
  return { estado, enviadas, falhas, adiadas };
}

/** Passada a validade, fecha o aviso: não há o que reenviar de um alerta de ontem. */
export function expirarSeVelho(estado: EstadoInterno, firedAt: Date, now: Date): EstadoInterno {
  if (!estado.open || now.getTime() - firedAt.getTime() <= VALIDADE_DO_AVISO_MS) return estado;
  return { ...estado, open: false, expired: true };
}
