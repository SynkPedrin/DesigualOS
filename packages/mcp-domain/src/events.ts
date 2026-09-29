/**
 * events.ts — o vocabulário de acontecimento da agência (§5-D).
 *
 * `operational_events` já existe e já é idempotente por `(source, external_id)`.
 * O que não existe é NEGÓCIO nele: em 29/09/2026 a tabela tinha 633 linhas e
 * exatamente dois tipos, `task.created` e `task.updated`, os dois vindos do
 * webhook do ClickUp. Nenhum evento jamais foi registrado por uma pessoa nem
 * por um agente.
 *
 * Os tipos abaixo são o que o Claude de cada funcionário poderá registrar
 * enquanto trabalha — e é isso que transforma o chat individual em memória da
 * empresa.
 */

export const MCP_EVENT_TYPES = [
  'TASK_CREATED', 'TASK_UPDATED', 'TASK_COMPLETED', 'TASK_DELETED',
  'CLIENT_FEEDBACK', 'CLIENT_DECISION',
  'CREATIVE_CREATED', 'CREATIVE_APPROVED', 'CREATIVE_REJECTED',
  'COPY_CREATED', 'COPY_APPROVED',
  'CAMPAIGN_INSIGHT', 'CAMPAIGN_CHANGE',
  'PROCESS_LEARNING', 'STRATEGY_CHANGED',
  'ERROR_FOUND', 'QA_FAILED', 'QA_PASSED',
  'PREFERENCE_LEARNED',
  'ASSET_CREATED', 'ASSET_UPDATED',
  'WORK_LOGGED',
] as const;

export type McpEventType = (typeof MCP_EVENT_TYPES)[number];

export function isMcpEventType(value: string): value is McpEventType {
  return (MCP_EVENT_TYPES as readonly string[]).includes(value);
}

/** Quanto o acontecimento pesa. Governa o que entra num resumo curto. */
export const IMPORTANCIAS = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type Importancia = (typeof IMPORTANCIAS)[number];

/**
 * Quem pode ver. `PRIVATE` é do autor; `TEAM` é da organização; `CLIENT_SCOPED`
 * segue a fronteira de quem tem acesso àquele cliente.
 */
export const VISIBILIDADES = ['PRIVATE', 'TEAM', 'CLIENT_SCOPED'] as const;
export type Visibilidade = (typeof VISIBILIDADES)[number];

export interface RegistrarEventoInput {
  eventType: McpEventType;
  summary: string;
  clientId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  structuredPayload?: Record<string, unknown>;
  importance?: Importancia;
  visibility?: Visibilidade;
  /** Chave de deduplicação vinda do cliente. Sem ela, deriva do conteúdo. */
  idempotencyKey?: string;
}

/**
 * ── O FILTRO DO §10: o que NÃO vira memória ───────────────────────────────
 *
 * A missão é explícita: não registrar brainstorm, conversa casual, hipótese não
 * aprovada nem pensamento temporário. O risco não é encher a tabela — é
 * envenenar a memória institucional com coisa que ninguém decidiu, e um colega
 * recuperar isso meses depois como se fosse fato.
 *
 * A defesa aqui é deliberadamente CONSERVADORA e mora no domínio, não no
 * prompt: instrução de organização é conselho, código é regra.
 */
const MARCA_DE_HIPOTESE =
  /\b(talvez|acho que|se a gente|poderia(mos)?|e se|que tal|ideia:|brainstorm|rascunho|pensando em|cogitando|hipotese|hip[óo]tese|provavelmente|imagino que|seria legal|vamos supor|em tese)\b/i;

const MARCA_DE_CONVERSA =
  /^(oi|ol[áa]|bom dia|boa tarde|boa noite|obrigad|valeu|beleza|tudo bem|kkk|haha|ok|certo|entendi)\b/i;

export type VeredictoDeRegistro =
  | { registrar: true }
  | { registrar: false; motivo: string };

/**
 * Vale a pena gravar isto para sempre?
 *
 * Assimetria proposital: na dúvida, NÃO grava. Um aprendizado perdido é pedido
 * de novo na próxima vez; um "talvez a gente mude a estratégia" gravado como
 * decisão vira a estratégia da agência aos olhos do próximo funcionário que
 * perguntar.
 */
export function deveRegistrar(input: { eventType: McpEventType; summary: string }): VeredictoDeRegistro {
  const texto = (input.summary ?? '').trim();
  if (texto.length < 12) {
    return { registrar: false, motivo: 'resumo curto demais para significar alguma coisa depois' };
  }
  if (MARCA_DE_CONVERSA.test(texto)) {
    return { registrar: false, motivo: 'parece conversa, não conhecimento operacional' };
  }
  /**
   * A marca de hipótese não bloqueia os tipos que JÁ SÃO um ato consumado. Uma
   * aprovação é uma aprovação mesmo escrita como "acho que ficou ótimo,
   * aprovado" — o tipo do evento carrega a certeza que o texto não carrega.
   */
  const TIPOS_DE_ATO_CONSUMADO: readonly McpEventType[] = [
    'TASK_CREATED', 'TASK_UPDATED', 'TASK_COMPLETED', 'TASK_DELETED',
    'CREATIVE_APPROVED', 'CREATIVE_REJECTED', 'COPY_APPROVED',
    'CLIENT_DECISION', 'QA_PASSED', 'QA_FAILED',
    'ASSET_CREATED', 'ASSET_UPDATED', 'WORK_LOGGED',
  ];
  if (!TIPOS_DE_ATO_CONSUMADO.includes(input.eventType) && MARCA_DE_HIPOTESE.test(texto)) {
    return { registrar: false, motivo: 'texto marcado como hipótese; registre depois de confirmado' };
  }
  return { registrar: true };
}

/** Importância padrão por tipo, quando quem registra não diz. */
export function importanciaPadrao(eventType: McpEventType): Importancia {
  switch (eventType) {
    case 'CLIENT_DECISION':
    case 'STRATEGY_CHANGED':
    case 'CREATIVE_REJECTED':
    case 'QA_FAILED':
    case 'ERROR_FOUND':
      return 'HIGH';
    case 'CLIENT_FEEDBACK':
    case 'PREFERENCE_LEARNED':
    case 'PROCESS_LEARNING':
    case 'CAMPAIGN_CHANGE':
      return 'NORMAL';
    default:
      return 'LOW';
  }
}
