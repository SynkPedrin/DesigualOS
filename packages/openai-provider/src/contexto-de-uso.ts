/**
 * contexto-de-uso.ts — de quem é cada chamada ao GPT (Bento 3.1, P3, 14/10/2026).
 *
 * `recordOpenAIUsage` existia e ninguém chamava: `ai_usage_ledger` estava com
 * ZERO linhas em produção (contagem somente leitura em 14/10/2026), então o
 * gasto com GPT não era medido e o rebaixamento de modelo por orçamento
 * (`currentBudgetTier`, que soma o ledger) nunca podia disparar. As execuções
 * do Bento gravavam "9 tokens de entrada" porque a via de leitura devolvia
 * uso zero e o worker estimava só pela pergunta e pela resposta.
 *
 * Registrar em `callResponses` cobre TODA chamada, inclusive as que ainda
 * não existem. Quem é o dono (empresa, pessoa, agente) vem deste contexto,
 * aberto pelo worker em volta de cada job — sem mudar a assinatura de cada
 * chamador. O acumulado do job é o que vai para a execução.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentName } from '@desigual-os/types';

export interface UsoAcumulado {
  chamadas: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  custoUsd: number;
}

export interface ContextoDeUso {
  organizationId?: string | null;
  userId?: string | null;
  agent?: AgentName | null;
  conversationId?: string | null;
  executionId?: string | null;
  acumulado: UsoAcumulado;
}

const armazem = new AsyncLocalStorage<ContextoDeUso>();

export function novoContextoDeUso(dados: Omit<ContextoDeUso, 'acumulado'> = {}): ContextoDeUso {
  return { ...dados, acumulado: { chamadas: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, custoUsd: 0 } };
}

/** Roda `fn` com este contexto: toda chamada ao GPT dentro dela é atribuída a ele. */
export function comContextoDeUso<T>(contexto: ContextoDeUso, fn: () => Promise<T>): Promise<T> {
  return armazem.run(contexto, fn);
}

export function contextoDeUsoAtual(): ContextoDeUso | undefined {
  return armazem.getStore();
}
