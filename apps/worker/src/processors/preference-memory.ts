import { db, schema } from '@desigual-os/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  extractPreferences,
  preferenceContent,
  preferenceSubject,
  rememberFact,
  recallMemories,
  type RememberOutcome,
} from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';

/**
 * preference-memory.ts — grava e recupera PREFERÊNCIA como memória semântica.
 *
 * Fecha o ciclo que faltava: extração (orchestrator, determinística) ->
 * resolução do cliente -> gravação com subject (que dá supersessão de graça)
 * -> recuperação escopada -> aplicação no prompt.
 *
 * O escopo é o ponto sensível: preferência do Cliente A não pode vazar pro
 * Cliente B. O isolamento não é "cuidado ao escrever o prompt", é filtro de
 * consulta por clientId no recall — e o subject carrega o id, então nem a
 * supersessão cruza clientes.
 */

export const PREFERENCE_KIND_CLIENT = 'client.preference';
export const PREFERENCE_KIND_USER = 'user.preference';

/** Resolve o nome falado pro cliente real. Tolerante a caixa/acento/parcial. */
/** Remove acento pra comparar nome sem depender de extensão do Postgres. */
function dobra(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export async function resolveClientByName(nome: string): Promise<{ id: string; name: string } | null> {
  const alvo = nome.trim();
  if (alvo.length < 2) return null;
  const rows = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(
      and(
        isNull(schema.clients.deletedAt),
        // lower() puro: `unaccent` é extensão e NÃO está instalada neste banco —
        // a consulta estourava e o catch devolvia vazio, fazendo toda resolução
        // de cliente falhar em silêncio. Acento é dobrado no lado do Node abaixo.
        sql`lower(${schema.clients.name}) = lower(${alvo})`,
      ),
    )
    .catch(() => [] as Array<{ id: string; name: string }>);
  if (rows[0]) return rows[0];

  // Sem match exato: tenta conter. Consulta separada de propósito — match
  // exato SEMPRE vence, senão "Costa" casaria "Costa Azul" antes do cliente
  // chamado "Costa".
  const parciais = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(
      and(
        isNull(schema.clients.deletedAt),
        sql`lower(${schema.clients.name}) like lower(${`%${alvo}%`})`,
      ),
    )
    .catch(() => [] as Array<{ id: string; name: string }>);
  if (parciais.length === 1) return parciais[0]!;

  // Último recurso: compara sem acento em memória (o banco não tem unaccent).
  const todos = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(isNull(schema.clients.deletedAt))
    .catch(() => [] as Array<{ id: string; name: string }>);
  const alvoDobrado = dobra(alvo);
  const exatos = todos.filter((c) => dobra(c.name) === alvoDobrado);
  if (exatos.length === 1) return exatos[0]!;
  const contidos = todos.filter((c) => dobra(c.name).includes(alvoDobrado));
  // Ambíguo NÃO resolve: preferir errado é pior que não gravar.
  return contidos.length === 1 ? contidos[0]! : null;
}

export interface StoredPreference {
  subject: string;
  content: string;
  clientId: string | null;
  outcome: RememberOutcome;
}

/**
 * Extrai e grava as preferências da mensagem. Devolve o que foi gravado (vazio
 * na esmagadora maioria dos turnos — não salvar é o default).
 */
export async function capturePreferences(
  message: string,
  ctx: { userId: string | null; clientId: string | null; executionId: string; environment?: string },
  logger: Logger,
): Promise<StoredPreference[]> {
  const extraidas = extractPreferences(message);
  if (extraidas.length === 0) return [];

  const gravadas: StoredPreference[] = [];
  for (const pref of extraidas) {
    let clientId = ctx.clientId;
    if (pref.scope === 'client' && pref.clientName) {
      const cliente = await resolveClientByName(pref.clientName);
      if (!cliente) {
        // Cliente não resolvido: NÃO grava num escopo chutado. Preferência sem
        // dono certo contaminaria outro cliente.
        logger.info({ clientName: pref.clientName }, '[memoria] preferência ignorada: cliente não resolvido');
        continue;
      }
      clientId = cliente.id;
    }

    const escopoId = pref.scope === 'client' ? clientId : ctx.userId;
    if (!escopoId) continue;

    const subject = preferenceSubject(escopoId, pref.aspect, pref.scope);
    const content = preferenceContent(pref);
    const outcome = await rememberFact({
      kind: pref.scope === 'client' ? PREFERENCE_KIND_CLIENT : PREFERENCE_KIND_USER,
      content,
      subject,
      clientId: pref.scope === 'client' ? clientId : null,
      userId: ctx.userId,
      sourceType: 'chat_message',
      sourceId: ctx.executionId,
      // Instrução explícita de quem manda na marca: confiança alta.
      confidence: 0.95,
      importance: 0.9,
      environment: ctx.environment ?? 'production',
      metadata: { aspect: pref.aspect, source_text: pref.source.slice(0, 300) },
    });
    logger.info({ subject, status: outcome.status, aspect: pref.aspect }, '[memoria] preferência capturada');
    gravadas.push({ subject, content, clientId: clientId ?? null, outcome });
  }
  return gravadas;
}

export interface AppliedPreference {
  content: string;
  subject: string | null;
}

/**
 * Recupera as preferências ATIVAS do escopo. O memory-engine já filtra
 * aposentadas/expiradas, então o que volta aqui é a verdade corrente — a
 * supersessão aparece sozinha.
 */
export async function recallPreferences(scope: {
  clientId: string | null;
  userId: string | null;
  /** Ambiente da execução. Preferência de QA não pode reger turno real. */
  environment?: string;
}): Promise<AppliedPreference[]> {
  const environment = scope.environment ?? 'production';
  const [doCliente, doUsuario] = await Promise.all([
    scope.clientId
      ? recallMemories({ clientId: scope.clientId, kinds: [PREFERENCE_KIND_CLIENT], limit: 8, environment }).catch(() => [])
      : Promise.resolve([]),
    scope.userId
      ? recallMemories({ userId: scope.userId, kinds: [PREFERENCE_KIND_USER], limit: 5, environment }).catch(() => [])
      : Promise.resolve([]),
  ]);
  // Não existe coluna subject: ela vira dedupeKey no memory-engine. O aspecto
  // fica na metadata e é o que identifica a preferência no trace.
  return [...doCliente, ...doUsuario].map((m) => {
    const aspecto = (m.metadata as { aspect?: unknown } | undefined)?.aspect;
    return { content: m.content, subject: typeof aspecto === 'string' ? aspecto : null };
  });
}

/** Bloco pro prompt. Vazio quando não há preferência — nada de seção fantasma. */
export function formatPreferenceBlock(prefs: AppliedPreference[]): string {
  if (prefs.length === 0) return '';
  return [
    'PREFERÊNCIAS JÁ REGISTRADAS PARA ESTE CLIENTE (obrigatórias, valem mais que seu padrão):',
    ...prefs.map((p) => `- ${p.content}`),
  ].join('\n');
}
