import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * organization-connector-store.ts — a ÚNICA leitura de `organization_connectors`.
 *
 * Extraído de `task-provider-resolver.ts` (P1-A, 06/10/2026) quando o
 * CommunicationProvider (WhatsApp) passou a precisar da mesma tabela pra um
 * provider diferente ('whatsapp', não 'clickup'). Antes disso o carregamento
 * e o cache viviam dentro do resolver de task, nomeado como se fosse
 * exclusivo de ClickUp — generalizar aqui evita a MESMA pergunta
 * ("que credencial esta empresa tem pra este provider?") ganhar uma segunda
 * implementação, que foi exatamente o defeito que o resolver de task já
 * tinha corrigido uma vez (~15 lugares lendo env global direto).
 *
 * `resolveTaskProvider`/`resolveClickUpCredentials` continuam em
 * `task-provider-resolver.ts`, reexportando `ConnectorConfigError`/
 * `ConnectorRow`/`__setConnectorConfigLoaderForTest` daqui pra não quebrar
 * import existente.
 */

export class ConnectorConfigError extends Error {
  constructor(
    message: string,
    readonly organizationId: string | null,
    readonly provider: string | null,
  ) {
    super(message);
    this.name = 'ConnectorConfigError';
  }
}

/** A linha como ela sai do banco (credentials ainda não validadas). */
export interface ConnectorRow {
  provider: string;
  credentials: unknown;
  status: string;
}

/**
 * Leitura da tabela, injetável em teste (padrão do repo: `__setXForTest`).
 * O default bate no banco; `null` restaura o default e limpa o cache.
 */
export type ConnectorConfigLoader = (organizationId: string) => Promise<ConnectorRow[]>;

const loadConnectorRowsDefault: ConnectorConfigLoader = async (organizationId) => {
  const rows = await db
    .select({
      provider: schema.organizationConnectors.provider,
      credentials: schema.organizationConnectors.credentials,
      status: schema.organizationConnectors.status,
    })
    .from(schema.organizationConnectors)
    .where(eq(schema.organizationConnectors.organizationId, organizationId))
    .catch(() => [] as ConnectorRow[]);
  return rows;
};

let loaderForTest: ConnectorConfigLoader | null = null;

export function __setConnectorConfigLoaderForTest(loader: ConnectorConfigLoader | null): void {
  loaderForTest = loader;
  connectorCache.clear();
}

/**
 * Cache curto por org (padrão de agent-sync.ts): cada turno de chat pode
 * resolver o provider mais de uma vez, e uma ida ao Postgres remoto custa
 * ~300ms neste banco. 60s é o compromisso: troca de credencial na tela demora
 * no máximo um minuto pra valer no worker, sem derrubar o pool de conexões.
 */
const CONNECTOR_CACHE_TTL_MS = 60_000;
const connectorCache = new Map<string, { rows: ConnectorRow[]; expiresAt: number }>();

export async function loadConnectorRows(organizationId: string): Promise<ConnectorRow[]> {
  if (loaderForTest) return loaderForTest(organizationId);
  const cached = connectorCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await loadConnectorRowsDefault(organizationId);
  connectorCache.set(organizationId, { rows, expiresAt: Date.now() + CONNECTOR_CACHE_TTL_MS });
  return rows;
}
