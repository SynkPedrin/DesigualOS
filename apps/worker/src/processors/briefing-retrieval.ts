import { db, schema } from '@desigual-os/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getTaskComments, type ClickUpConfig } from '@desigual-os/tool-gateway';
import { extractLabeledFacts, mergeFacts, type BriefingFact } from './briefing-facts';

/**
 * briefing-retrieval.ts — busca o contexto REAL antes de escrever o briefing.
 *
 * "Recuperar antes de perguntar" (§4 do gate): só vira pendência o que não
 * existe em NENHUMA fonte. As fontes entram por ordem de autoridade, e a
 * ordem importa — dado dito agora no pedido vale mais que dossiê de meses
 * atrás, e oferta escrita num comentário da task vale mais que a do dossiê.
 */

export interface RetrievedBriefingContext {
  facts: BriefingFact[];
  references: string[];
  /** Fontes efetivamente consultadas, pro relatório de QA. */
  sourcesConsulted: string[];
}

export interface RetrievalDeps {
  readComments: (config: ClickUpConfig, taskId: string) => Promise<Array<{ id: string; text: string }>>;
}

export const defaultRetrievalDeps: RetrievalDeps = {
  readComments: async (config, taskId) => getTaskComments(config, taskId),
};

export async function retrieveBriefingContext(
  params: {
    clientId: string | null;
    requestText: string;
    taskId: string | null;
    config: ClickUpConfig | null;
  },
  deps: RetrievalDeps = defaultRetrievalDeps,
): Promise<RetrievedBriefingContext> {
  const sourcesConsulted: string[] = [];
  const references: string[] = [];

  // 1. PEDIDO do humano — o que ele disse agora manda em tudo.
  const doPedido = extractLabeledFacts(params.requestText, 'pedido do usuário');
  sourcesConsulted.push('pedido do usuário');

  // 2. COMENTÁRIOS da task (quando ela já existe): é onde a agência escreve
  //    oferta, prazo e ajuste de última hora.
  let dosComentarios: BriefingFact[] = [];
  if (params.taskId && params.config) {
    const comentarios = await deps.readComments(params.config, params.taskId).catch(() => []);
    if (comentarios.length > 0) sourcesConsulted.push(`comentários da task (${comentarios.length})`);
    for (const c of comentarios) {
      dosComentarios.push(...extractLabeledFacts(c.text, 'comentário da task', c.id));
      const links = c.text.match(/https?:\/\/\S+/g) ?? [];
      references.push(...links);
    }
    dosComentarios = mergeFacts(dosComentarios);
  }

  // 3. MEMÓRIA do cliente (preferência ensinada + perfil consolidado).
  let daMemoria: BriefingFact[] = [];
  let doDossie: BriefingFact[] = [];
  if (params.clientId) {
    const memorias = await db
      .select({ kind: schema.memories.kind, content: schema.memories.content, id: schema.memories.id })
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.clientId, params.clientId),
          eq(schema.memories.status, 'active'),
          inArray(schema.memories.kind, ['client.preference', 'client.profile', 'client.fact']),
        ),
      )
      .orderBy(desc(schema.memories.importance))
      .limit(12)
      .catch(() => []);

    for (const m of memorias) {
      if (m.kind === 'client.preference') {
        // Preferência é restrição de execução: "sem emojis" é ponto proibido.
        daMemoria.push({ field: 'proibidos', value: m.content, source: 'memória do cliente', sourceId: m.id });
        daMemoria.push(...extractLabeledFacts(m.content, 'memória do cliente', m.id));
      } else {
        doDossie.push(...extractLabeledFacts(m.content, 'dossiê do cliente', m.id));
      }
    }
    if (memorias.length > 0) sourcesConsulted.push(`memória do cliente (${memorias.length})`);
    daMemoria = mergeFacts(daMemoria);
    doDossie = mergeFacts(doDossie);

    // 4. BRAND KIT: tom de voz e paleta são fato de marca, não opinião.
    const [kit] = await db
      .select()
      .from(schema.clientBrandKits)
      .where(eq(schema.clientBrandKits.clientId, params.clientId))
      .catch(() => []);
    if (kit) {
      sourcesConsulted.push('brand kit');
      if (kit.toneOfVoice) doDossie.push({ field: 'tom', value: kit.toneOfVoice, source: 'brand kit' });
      if (kit.colors?.length) doDossie.push({ field: 'cores', value: kit.colors.join(', '), source: 'brand kit' });
    }
  }

  return {
    facts: mergeFacts(doPedido, dosComentarios, daMemoria, doDossie),
    references,
    sourcesConsulted,
  };
}
