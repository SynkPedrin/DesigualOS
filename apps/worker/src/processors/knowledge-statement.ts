import { extractEpisodeCandidates, recordEpisodes, type CandidatoAEpisodio } from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';
import { resolveEnvironment } from './environment.js';

/**
 * knowledge-statement.ts — quando o turno ENSINA em vez de perguntar.
 *
 * Defeito medido em 16/09/2026: "Decidimos que a comunicação da Cosentino vai
 * priorizar legado e permanência, não preço." caía no loop operacional do
 * Bento e morria em replan_exhausted em 11 segundos. O agente tentava
 * responder operacionalmente uma frase que não perguntava nada, o avaliador
 * reprovava por não haver resposta, e o replan se esgotava.
 *
 * Isso não é detalhe: ENSINAR é o fluxo de que a memória inteira depende. Se a
 * frase que registra uma decisão devolve erro, ninguém ensina o sistema duas
 * vezes.
 *
 * Aqui a afirmação vira confirmação determinística do que ficou registrado. Sem
 * modelo, sem retrieval, sem GPU: o episódio já foi gravado pelo caminho de
 * memória, e a resposta apenas diz o que entrou e para quem — que é a única
 * coisa útil a dizer, e a única que não corre risco de inventar.
 */

export interface RegistroDeConhecimento {
  answer: string;
  tipos: string[];
  /** Quantos episódios FORAM DE FATO gravados. Zero aqui é bug, não caso feliz. */
  gravados: number;
}

/** Marca de pergunta: quem pergunta não está ensinando. */
const PERGUNTA = /\?\s*$|^\s*(o que|qual|quais|quem|quando|onde|como|por que|porque|quanto)\b/i;

/**
 * O turno é uma AFIRMAÇÃO que registra conhecimento? Devolve null na esmagadora
 * maioria dos casos — inclusive em qualquer coisa que pareça pedido.
 */
export function detectKnowledgeStatement(
  message: string,
  clientName: string | null,
): Omit<RegistroDeConhecimento, 'gravados'> | null {
  const texto = message.trim();
  if (texto.length === 0) return null;

  // Pergunta nunca é registro, mesmo contendo verbo de decisão.
  if (PERGUNTA.test(texto)) return null;
  // Pedido de entrega não é registro: "crie", "escreva", "monte", "liste".
  if (/\b(crie|cria|escrev[ae]|mont[ae]|list[ae]|faz|faça|gera|gere|analis[ae]|revis[ae]|me (d[êe]|manda|mostra))\b/i.test(texto)) {
    return null;
  }

  const candidatos: CandidatoAEpisodio[] = extractEpisodeCandidates(texto);
  if (candidatos.length === 0) return null;

  const tipos = [...new Set(candidatos.map((c) => c.eventType))];
  const alvo = clientName ? ` para ${clientName}` : '';

  const linhas = [`Registrado${alvo}:`];
  for (const c of candidatos) linhas.push(`- ${c.summary}`);
  linhas.push(
    '',
    'Fica valendo a partir de agora e volta nas próximas conversas, sem você precisar repetir.',
    'Se eu entendi errado alguma parte, me corrige que eu atualizo.',
  );

  return { answer: linhas.join('\n'), tipos };
}

/**
 * Detecta E GRAVA, nesta ordem, antes de confirmar.
 *
 * A primeira versão deste caminho respondia "Registrado:" e não gravava nada —
 * o atalho passava por fora do dispatch, que é onde a memória episódica vive.
 * Medido: zero episódios com o marcador do teste. Confirmar o que não foi
 * gravado é pior que o erro original, porque o usuário para de repetir a
 * informação achando que o sistema já sabe.
 */
export async function registrarConhecimentoDoTurno(params: {
  message: string;
  clientId: string | null;
  clientName: string | null;
  userId: string | null;
  agent: string;
  conversationId: string | null;
  executionId: string;
  logger: Logger;
}): Promise<RegistroDeConhecimento | null> {
  const detectado = detectKnowledgeStatement(params.message, params.clientName);
  if (!detectado) return null;

  const environment = await resolveEnvironment(params.clientId).catch(() => 'production' as const);
  const candidatos = extractEpisodeCandidates(params.message);
  const gravados = await recordEpisodes(candidatos, {
    clientId: params.clientId,
    userId: params.userId,
    agent: params.agent,
    conversationId: params.conversationId,
    executionId: params.executionId,
    sourceRefs: [`execution:${params.executionId}`],
    environment,
  }).catch((erro: unknown) => {
    params.logger.error({ erro }, '[registro] falha ao gravar episódio');
    return 0;
  });

  // Nada gravado: NÃO confirme. Deixa o turno seguir pelo caminho normal em vez
  // de afirmar um registro que não existe.
  if (gravados === 0) {
    params.logger.warn({ executionId: params.executionId }, '[registro] nada gravado; devolvendo ao fluxo normal');
    return null;
  }

  return { ...detectado, gravados };
}
