import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';

/**
 * _guard-producao.ts — nenhum teste ensina fato em produção.
 *
 * Em 17/09/2026 um script de TRACE meu mandou "Anota que o decisor da Colpar é
 * Marcelo Ribeiro" contra a conta real. O episódio virou o registro mais
 * recente e inverteu a verdade corrente do cliente: a correção para Fernanda,
 * feita horas antes, passou a ser o fato antigo. Só descobri porque fui
 * investigar outra coisa.
 *
 * Um diagnóstico que altera o sistema que investiga não é diagnóstico. E o
 * estrago aqui não fica no teste: fica no que o agente vai responder pra
 * equipe amanhã.
 *
 * A regra: turno que ENSINA só roda em cliente de QA. Perguntar em produção
 * continua livre — ler não muda nada.
 */

/** Verbos que fazem o turno virar registro permanente (ver knowledge-statement). */
const ENSINA = /\b(anot[ae]|registr[ae]|guard[ae]|grav[ae]|corrig[ei]|fica registrado|para constar|decidimos|ficou (definido|decidido))\b/i;

export function ensinaFato(mensagem: string): boolean {
  return ENSINA.test(mensagem ?? '');
}

/**
 * Derruba o script ANTES de despachar. Falhar alto é o ponto: um aviso no log
 * seria lido depois do estrago.
 */
export async function recusarEnsinoEmProducao(mensagem: string, clientId: string | null): Promise<void> {
  if (!ensinaFato(mensagem)) return;
  if (!clientId) {
    throw new Error(
      `[guard] "${mensagem.slice(0, 60)}..." ensina um fato e o turno não tem cliente de QA. ` +
        'Rode contra um cliente com environment=qa.',
    );
  }
  const [c] = await db
    .select({ environment: schema.clients.environment, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (c?.environment !== 'qa') {
    throw new Error(
      `[guard] "${mensagem.slice(0, 60)}..." ensina um fato e ${c?.name ?? clientId} é PRODUÇÃO. ` +
        'Teste que escreve memória roda só em QA — foi assim que um trace inverteu o decisor de um cliente real.',
    );
  }
}
