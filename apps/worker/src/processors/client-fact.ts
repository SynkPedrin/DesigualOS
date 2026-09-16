import {
  clientFactSubject,
  extractClientFacts,
  rememberFact,
  type ExtractedClientFact,
  type RememberOutcome,
} from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';
import { resolveClientByName } from './preference-memory';

/**
 * client-fact.ts — fecha o ciclo do conhecimento de cliente.
 *
 * O dossiê e o brain entram por importação e congelam ali. Toda ficha tem
 * lacuna declarada ("público-alvo a coletar", "decisor a coletar"), e essas
 * lacunas são preenchidas em conversa. Sem isto, a equipe responde a mesma
 * pergunta toda semana e o agente nunca aprende — foi exatamente o que o Yak
 * Sushibar mostrou ao vivo: o agente listou as três lacunas que tinha, e não
 * havia caminho nenhum pra resposta virar conhecimento.
 *
 * O fato gravado entra como `client.profile`, então o turno seguinte o lê junto
 * do brain e do dossiê (ver client-context.ts), rotulado como registro
 * APRENDIDO — a procedência fica visível, e o agente não confunde o que veio
 * da ficha curada com o que a equipe contou no chat.
 */

/** Terceira fonte de perfil, ao lado de brain e dossiê. */
export const CLIENT_FACT_KIND = 'client.profile';

export interface StoredClientFact {
  subject: string;
  clientId: string;
  aspect: string;
  outcome: RememberOutcome;
}

/**
 * Grava os fatos duráveis ditos no turno. Só grava com cliente RESOLVIDO: fato
 * no cliente errado é pior que fato nenhum, e aqui não há como desfazer em
 * silêncio depois — o dado passa a moldar toda peça futura daquela marca.
 */
export async function captureClientFacts(
  message: string,
  ctx: { clientId: string | null; userId: string | null; executionId: string; environment?: string },
  logger: Logger,
): Promise<StoredClientFact[]> {
  const extraidos = extractClientFacts(message);
  if (extraidos.length === 0) return [];

  const gravados: StoredClientFact[] = [];
  for (const fato of extraidos) {
    const clientId = await resolverDono(fato, ctx.clientId);
    if (!clientId) {
      logger.info(
        { clientName: fato.clientName, aspect: fato.aspect },
        '[memoria] fato de cliente ignorado: cliente não resolvido',
      );
      continue;
    }

    const subject = clientFactSubject(clientId, fato);
    const outcome = await rememberFact({
      kind: CLIENT_FACT_KIND,
      content: fato.value,
      subject,
      clientId,
      userId: ctx.userId,
      sourceType: 'chat_message',
      sourceId: ctx.executionId,
      // Abaixo do dossiê curado (0.9): veio de conversa, não de ficha revisada.
      confidence: 0.85,
      importance: 0.9,
      environment: ctx.environment ?? 'production',
      metadata: { aspect: fato.aspect, source_text: fato.source.slice(0, 300), origem: 'aprendizado' },
    });
    logger.info({ subject, status: outcome.status, aspect: fato.aspect }, '[memoria] fato de cliente capturado');
    gravados.push({ subject, clientId, aspect: fato.aspect, outcome });
  }
  return gravados;
}

/**
 * Dono do fato. Nome citado VENCE o cliente da execução: quem escreve "anota no
 * brain da Colormaq" enquanto o seletor do chat está na Cosentino está falando
 * da Colormaq, e gravar na Cosentino contaminaria a ficha errada.
 */
async function resolverDono(fato: ExtractedClientFact, clienteDaExecucao: string | null): Promise<string | null> {
  if (fato.clientName) {
    const resolvido = await resolveClientByName(fato.clientName).catch(() => null);
    // Nome citado que NÃO resolve não cai de volta no cliente da execução:
    // seria gravar na ficha errada justamente quando há dúvida de dono.
    return resolvido?.id ?? null;
  }
  return clienteDaExecucao;
}
