import type { Logger } from '@desigual-os/logging';
import { detectSelectionReference, resolveSelectionReference, type SelectedTaskRef } from '@desigual-os/context-engine';
import type { SelectedResourceRef } from '@desigual-os/bento-core';
import { loadSelectionSnapshot } from './bento-action-guard.js';

/**
 * bento-legacy-selection-bridge.ts — P0 de produção (25/09/2026, incidente
 * D. Carvalho item 11).
 *
 * CAUSA RAIZ: existem HOJE dois mecanismos de estado de conversa que não se
 * falam. O antigo (`context-engine/selection.ts` + `SelectionSnapshot`,
 * gravado em `metadata.selecao` da mensagem por
 * `apps/api/src/lib/operational-context.ts`) já funciona — provado contra o
 * banco real: a listagem "D. Carvalho (42 tarefas em aberto)" gravou os 42
 * ids reais do ClickUp corretamente, item 11 incluído. O novo
 * (`ConversationResourceState`, `packages/bento-core` +
 * `bento-resource-state.ts`, tabela `conversation_context`) é o que
 * `bento-openai-core.ts` consulta pra resolver "item 11" numa escrita — e
 * ele nunca tinha ouvido falar dos 42 tasks, porque a LISTAGEM saiu pelo
 * caminho antigo (`callBento`/remoto), que não escreve na tabela nova.
 * Resultado: politica.resolveTargetResourceId via bento-core não achava
 * nada, mesmo com o dado certo gravado a poucos turnos de distância.
 *
 * CORREÇÃO (sem reescrever nenhum dos dois mecanismos): quando o estado
 * novo está vazio, esta ponte consulta o snapshot ANTIGO (que já é
 * confiável e testado) e traduz a referência ("item 11", "a décima
 * primeira", nome da task) pro mesmo formato que o resto do bento-core já
 * entende (`SelectedResourceRef`). Zero mudança de schema, zero segundo
 * pipeline — só uma leitura a mais quando a primeira está vazia.
 */
export interface LegacyBridgeResult {
  resource: SelectedResourceRef;
  /** Só pra log/observabilidade — nunca pra decisão. */
  matchedVia: 'ordinal' | 'name' | 'attribute' | 'focus' | 'other';
}

function taskToResourceRef(task: SelectedTaskRef): SelectedResourceRef {
  return { resourceType: 'CLICKUP_TASK', resourceId: task.id, title: task.title };
}

/**
 * Tenta resolver a referência da mensagem contra o snapshot ANTIGO da
 * conversa (metadata.selecao da mensagem mais recente que o tiver). Só
 * devolve resultado quando resolve pra EXATAMENTE uma task — ambiguidade
 * (mais de uma) não é resolução, é pedido de esclarecimento, e quem chama
 * decide isso, não esta função.
 */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * TÍTULO INTEIRO MENCIONADO NA FRASE ("altere a data da
 * DC_Agrishow_Edições_Pacotes Pós-Vendas"). `ATTRIBUTE_RE` (compartilhado em
 * selection.ts, usado por outros consumidores) só captura UMA palavra depois
 * de "da/do" — não serve pra título de task, que tem espaço. Em vez de
 * alargar aquele regex genérico (arriscaria outros usos dele), esta é uma
 * checagem própria e self-contained: o título aparece como SUBSTRING da
 * mensagem, ponto final. Piso de 12 caracteres evita casar título curto
 * demais por acidente ("Ajuste", "Revisão") dentro de uma frase qualquer.
 */
const TITULO_MENCIONADO_MIN_LEN = 12;

function resolveByTaskNameMention(snapshot: { tasks: SelectedTaskRef[] }, message: string): SelectedTaskRef | null {
  const msgNorm = normalizar(message);
  const casam = snapshot.tasks.filter((t) => t.title.length >= TITULO_MENCIONADO_MIN_LEN && msgNorm.includes(normalizar(t.title)));
  return casam.length === 1 ? casam[0]! : null;
}

export async function resolveFromLegacySelectionSnapshot(
  conversationId: string,
  message: string,
  logger: Logger,
): Promise<LegacyBridgeResult | null> {
  const ref = detectSelectionReference(message);

  // Sem referência ESTRUTURAL (ordinal/foco/dêitico) — última tentativa
  // determinística antes de desistir: o título da task, por extenso, dentro
  // da própria frase. Só carrega o snapshot se valer a pena.
  if (!ref) {
    const snapshotSemRef = await loadSelectionSnapshot(conversationId).catch((error: unknown) => {
      logger.warn({ error }, '[bento-legacy-selection-bridge] falha ao carregar snapshot antigo');
      return null;
    });
    if (!snapshotSemRef) return null;
    const porNome = resolveByTaskNameMention(snapshotSemRef, message);
    if (!porNome) return null;
    logger.info(
      { reference_type: 'name_mention', resolved_resource_id: porNome.id, resolved_resource_name: porNome.title, state_source: 'legacy_selection_snapshot' },
      '[bento-legacy-selection-bridge] referência resolvida por título mencionado (determinístico, sem LLM)',
    );
    return { resource: taskToResourceRef(porNome), matchedVia: 'name' };
  }

  const snapshot = await loadSelectionSnapshot(conversationId).catch((error: unknown) => {
    logger.warn({ error }, '[bento-legacy-selection-bridge] falha ao carregar snapshot antigo');
    return null;
  });
  if (!snapshot) return null;

  const resolved = resolveSelectionReference(snapshot, ref);
  if (!resolved || resolved.tasks.length !== 1) return null;

  const task = resolved.tasks[0]!;
  logger.info(
    { reference_type: ref.kind, resolved_resource_id: task.id, resolved_resource_name: task.title, state_source: 'legacy_selection_snapshot' },
    '[bento-legacy-selection-bridge] referência resolvida contra o snapshot antigo (determinístico, sem LLM)',
  );
  return { resource: taskToResourceRef(task), matchedVia: ref.kind === 'ordinal' ? 'ordinal' : ref.kind === 'name' ? 'name' : ref.kind === 'attribute' ? 'attribute' : ref.kind === 'focus' ? 'focus' : 'other' };
}
