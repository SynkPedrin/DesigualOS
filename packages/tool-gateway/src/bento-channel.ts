import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { OpenwaClient, OpenwaError } from './openwa-client';
import { OpenwaGatewayClient } from './openwa-gateway';
import { openwaBaseUrl } from './openwa-session-store';
import { decryptToken } from './token-crypto';

/**
 * bento-channel.ts — o Bento ENVIANDO, para o worker.
 *
 * O gateway que RESPONDE mora em apps/api/src/bento-whatsapp. Este é o outro
 * sentido: automações (alertas e avisos de mídia) mandando mensagem para a
 * equipe pelo número do Bento. Mora no tool-gateway porque o worker não importa
 * código de apps/api.
 *
 * AS TRAVAS EXISTEM PORQUE JÁ DEU ERRADO. Em 19/10/2026 o Bento mandou aviso a
 * 24 contatos em 1 minuto e o WhatsApp desconectou o aparelho. Por isso:
 *  1. só envia para quem a CONFIGURAÇÃO nomeou (o chamador passa o número; este
 *     módulo não tem lista nem aceita "todos");
 *  2. só envia com a sessão `ready` (nada de enfileirar para o aparelho acordar);
 *  3. o interruptor do painel (`organization_connectors.status`) e o
 *     `BENTO_WHATSAPP_ENABLED=false` do servidor desligam este canal também;
 *  4. LIMITE de envio por janela, no processo: se algo estiver em laço, trava.
 */

export const PROVIDER_DO_BENTO = 'bento_whatsapp';

export type MotivoDaFalha = 'canal_desligado' | 'sem_sessao' | 'sessao_nao_pronta' | 'limite_de_envio' | 'numero_invalido' | 'falha_de_envio';

export type ResultadoDoEnvio =
  | { ok: true; messageId: string }
  | { ok: false; motivo: MotivoDaFalha; erro: string; repetivel: boolean };

export interface EnvioInterno {
  /** Só dígitos, com DDI e DDD. */
  phone: string;
  text: string;
  /** A mesma chave devolve a MESMA mensagem (o OpenWA guarda por 24 h): retry não duplica. */
  idempotencyKey: string;
}

export interface CanalDoBento {
  status: string;
  sessionId: string;
  apiKey: string;
}

/** Limitador de janela deslizante. Em memória: protege contra laço dentro do processo. */
export function criarLimitador(opcoes: { max10min: number; maxPorHora: number }) {
  const envios: number[] = [];
  return {
    permitir(agora: number): boolean {
      while (envios.length > 0 && agora - envios[0]! > 3_600_000) envios.shift();
      const ultimos10 = envios.filter((t) => agora - t <= 600_000).length;
      if (ultimos10 >= opcoes.max10min || envios.length >= opcoes.maxPorHora) return false;
      envios.push(agora);
      return true;
    },
  };
}

const limitadorPadrao = criarLimitador({ max10min: 8, maxPorHora: 20 });

export interface DependenciasDoCanal {
  carregarCanal: () => Promise<CanalDoBento | null>;
  sessaoPronta: (canal: CanalDoBento) => Promise<boolean>;
  enviarTexto: (canal: CanalDoBento, chatId: string, text: string, idempotencyKey: string) => Promise<{ messageId: string }>;
  limitador: { permitir: (agora: number) => boolean };
  agora: () => number;
  /** `BENTO_WHATSAPP_ENABLED=false` no servidor é a chave geral. */
  chaveGeralDesligada: () => boolean;
}

async function carregarCanalDoBanco(): Promise<CanalDoBento | null> {
  const [linha] = await db
    .select()
    .from(schema.organizationConnectors)
    .where(eq(schema.organizationConnectors.provider, PROVIDER_DO_BENTO))
    .limit(1);
  const c = linha?.credentials as { sessionId?: string; apiKeyEncrypted?: string } | undefined;
  if (!linha || !c?.sessionId || !c.apiKeyEncrypted) return null;
  try {
    return { status: linha.status, sessionId: c.sessionId, apiKey: decryptToken(c.apiKeyEncrypted) };
  } catch {
    return null;
  }
}

const dependenciasReais: DependenciasDoCanal = {
  carregarCanal: carregarCanalDoBanco,
  sessaoPronta: async (canal) => {
    const sessao = await new OpenwaGatewayClient({ baseUrl: openwaBaseUrl(), apiKey: canal.apiKey, sessionId: canal.sessionId }).getSession();
    return sessao.status === 'ready';
  },
  enviarTexto: (canal, chatId, text, idempotencyKey) =>
    new OpenwaClient({ baseUrl: openwaBaseUrl(), apiKey: canal.apiKey, sessionId: canal.sessionId }).sendText({ chatId, text, idempotencyKey }),
  limitador: limitadorPadrao,
  agora: () => Date.now(),
  chaveGeralDesligada: () => process.env.BENTO_WHATSAPP_ENABLED === 'false',
};

export async function enviarPeloBento(envio: EnvioInterno, deps: DependenciasDoCanal = dependenciasReais): Promise<ResultadoDoEnvio> {
  if (!/^\d{10,15}$/.test(envio.phone)) {
    return { ok: false, motivo: 'numero_invalido', erro: 'Telefone precisa ter só dígitos, com DDI e DDD.', repetivel: false };
  }
  if (deps.chaveGeralDesligada()) {
    return { ok: false, motivo: 'canal_desligado', erro: 'O Bento no WhatsApp está desligado no servidor.', repetivel: true };
  }
  const canal = await deps.carregarCanal();
  if (!canal) return { ok: false, motivo: 'sem_sessao', erro: 'O número do Bento ainda não foi conectado.', repetivel: true };
  if (canal.status !== 'ativa') {
    return { ok: false, motivo: 'canal_desligado', erro: 'O canal do Bento está desligado no painel.', repetivel: true };
  }
  try {
    if (!(await deps.sessaoPronta(canal))) {
      return { ok: false, motivo: 'sessao_nao_pronta', erro: 'O WhatsApp do Bento não está conectado agora.', repetivel: true };
    }
  } catch (error) {
    return { ok: false, motivo: 'sessao_nao_pronta', erro: error instanceof Error ? error.message : String(error), repetivel: true };
  }
  if (!deps.limitador.permitir(deps.agora())) {
    return { ok: false, motivo: 'limite_de_envio', erro: 'Limite de envio do Bento atingido; tentando de novo mais tarde.', repetivel: true };
  }
  try {
    const enviado = await deps.enviarTexto(canal, `${envio.phone}@c.us`, envio.text, envio.idempotencyKey);
    return { ok: true, messageId: enviado.messageId };
  } catch (error) {
    const repetivel = error instanceof OpenwaError ? error.retryable : true;
    return { ok: false, motivo: 'falha_de_envio', erro: error instanceof Error ? error.message : String(error), repetivel };
  }
}
