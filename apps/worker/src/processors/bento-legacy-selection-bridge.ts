import type { Logger } from '@desigual-os/logging';
import { detectSelectionReference, resolveSelectionReference, type SelectedTaskRef } from '@desigual-os/context-engine';
import type { SelectedResourceRef } from '@desigual-os/bento-core';
import { loadSelectionSnapshotComFallback } from './bento-action-guard.js';

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

/**
 * O QUE PODE ATRAVESSAR UM CHAT NOVO — e o que não pode (28/09/2026).
 *
 * Herdar o conjunto de outra conversa resolve o caso real da Tammy (listou num
 * chat, pediu em outro citando o NOME da task). Mas a mesma herança aplicada a
 * um PRONOME seria perigosa: "apaga essa" num chat recém-aberto apagaria a task
 * em que ela mexeu horas antes, sem que nada nesta conversa tenha apontado pra
 * ela. Ninguém diz "essa" sobre algo que não está à vista.
 *
 * Então a referência DITA decide o alcance: nome, ordinal e atributo são
 * âncoras que a pessoa escreveu e conferem sozinhas; dêitico e foco dependem do
 * que estava na tela, e tela é por conversa.
 */
const ATRAVESSA_CONVERSA = new Set<LegacyBridgeResult['matchedVia']>(['name', 'ordinal', 'attribute']);

export async function resolveFromLegacySelectionSnapshot(
  conversationId: string,
  message: string,
  logger: Logger,
  userId?: string | null,
): Promise<LegacyBridgeResult | null> {
  const ref = detectSelectionReference(message);

  const carregado = await loadSelectionSnapshotComFallback(conversationId, userId ?? null).catch((error: unknown) => {
    logger.warn({ error }, '[bento-legacy-selection-bridge] falha ao carregar snapshot antigo');
    return null;
  });
  if (!carregado) return null;
  const { snapshot, origem } = carregado;

  function entregar(task: SelectedTaskRef, via: LegacyBridgeResult['matchedVia'], referencia: string): LegacyBridgeResult | null {
    if (origem === 'outra_conversa' && !ATRAVESSA_CONVERSA.has(via)) {
      logger.info(
        { reference_type: via, state_source: 'outra_conversa' },
        '[bento-legacy-selection-bridge] referência dêitica NÃO herda de outra conversa — pedindo esclarecimento',
      );
      return null;
    }
    logger.info(
      { reference_type: referencia, resolved_resource_id: task.id, resolved_resource_name: task.title, state_source: origem === 'conversa' ? 'legacy_selection_snapshot' : 'legacy_selection_snapshot_outra_conversa' },
      '[bento-legacy-selection-bridge] referência resolvida contra o snapshot antigo (determinístico, sem LLM)',
    );
    return { resource: taskToResourceRef(task), matchedVia: via };
  }

  // Sem referência ESTRUTURAL (ordinal/foco/dêitico) — última tentativa
  // determinística antes de desistir: o título da task, por extenso, dentro
  // da própria frase.
  if (!ref) {
    const porNome = resolveByTaskNameMention(snapshot, message);
    return porNome ? entregar(porNome, 'name', 'name_mention') : null;
  }

  const resolved = resolveSelectionReference(snapshot, ref);
  if (!resolved || resolved.tasks.length !== 1) return null;

  const via = ref.kind === 'ordinal' ? 'ordinal' : ref.kind === 'name' ? 'name' : ref.kind === 'attribute' ? 'attribute' : ref.kind === 'focus' ? 'focus' : 'other';
  return entregar(resolved.tasks[0]!, via, ref.kind);
}
