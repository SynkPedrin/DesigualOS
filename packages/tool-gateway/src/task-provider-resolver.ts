import { z } from 'zod';
import { createClickUpTaskProvider } from './clickup-task-provider-adapter';
import type { TaskProvider } from './task-provider';
import { ConnectorConfigError, loadConnectorRows, type ConnectorRow } from './organization-connector-store';

export { ConnectorConfigError, __setConnectorConfigLoaderForTest, type ConnectorRow, type ConnectorConfigLoader } from './organization-connector-store';

/**
 * task-provider-resolver.ts — de qual empresa é a plataforma, e com que chave.
 *
 * É o único ponto que decide isso. A pergunta "que credencial o ClickUp deste
 * turno usa?" tinha ~15 respostas espalhadas pelo repo (todas: as envs
 * globais CLICKUP_API_KEY/CLICKUP_TEAM_ID). No white label cada empresa traz a
 * plataforma DELA, gravada em `organization_connectors`, e esta função é a
 * fronteira:
 *
 *   org TEM config  → adapter montado com a credencial dela;
 *   org NÃO tem     → fallback para as envs globais, exatamente o comportamento
 *                     de sempre da Desigual;
 *   config quebrada → ConnectorConfigError com a razão, nunca crash de turno
 *                     (quem chama decide o fallback; o consumidor de leitura
 *                     de campanha, por exemplo, responde "sem dados" em vez de
 *                     derrubar a execução).
 *
 * UMA CONFIG EXISTENTE NUNCA CAI NO FALLBACK. Se a empresa gravou um conector
 * e ele está desativado ou inválido, usar a chave da agência no lugar dela
 * misturaria a operação de dois tenants — o erro certo é "seu conector está
 * desativado", não ler o ClickUp dos outros.
 *
 * `CLICKUP_BOT_API_KEY` NÃO entra aqui de propósito: ela é a identidade de
 * ESCRITA do Bento (bento-action-guard.ts:1175), não credencial de leitura.
 * Misturar as duas faria a leitura de uma subconta sair assinada pelo bot.
 */

/**
 * O shape que o provider 'clickup' exige no jsonb. É a validação que impede o
 * jsonb de aceitar qualquer chave em silêncio — ver o comentário da tabela.
 */
const clickupCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1),
  teamId: z.string().trim().min(1),
});

const PROVIDERS_SUPORTADOS = new Set(['clickup']);

function buildProviderFromConfig(row: ConnectorRow, organizationId: string): TaskProvider {
  if (row.status !== 'ativa') {
    throw new ConnectorConfigError(
      `O conector ${row.provider} desta empresa está ${row.status}. Reative-o nas configurações da empresa.`,
      organizationId,
      row.provider,
    );
  }
  if (row.provider === 'clickup') {
    const parsed = clickupCredentialsSchema.safeParse(row.credentials);
    if (!parsed.success) {
      throw new ConnectorConfigError(
        'A configuração do ClickUp desta empresa está incompleta (apiKey/teamId). Refaça a conexão nas configurações da empresa.',
        organizationId,
        row.provider,
      );
    }
    return createClickUpTaskProvider({ apiKey: parsed.data.apiKey, teamId: parsed.data.teamId });
  }
  throw new ConnectorConfigError(
    `A plataforma "${row.provider}" ainda não é suportada. Hoje só ClickUp; Jira/Monday/Trello entram quando o adapter deles existir (ver task-provider.ts).`,
    organizationId,
    row.provider,
  );
}

function providerDoFallbackDeEnv(env: NodeJS.ProcessEnv): TaskProvider {
  const apiKey = env.CLICKUP_API_KEY?.trim();
  const teamId = env.CLICKUP_TEAM_ID?.trim();
  if (!apiKey || !teamId) {
    throw new ConnectorConfigError(
      'Nenhum conector configurado para esta empresa e o fallback global está sem CLICKUP_API_KEY/CLICKUP_TEAM_ID.',
      null,
      'clickup',
    );
  }
  return createClickUpTaskProvider({ apiKey, teamId });
}

/**
 * O provider de tarefas da empresa do turno.
 *
 * `organizationId` nulo/indefinido pula direto pro fallback de env: execução
 * sem empresa é execução da própria Desigual, que é quem a chave global
 * representa. Com mais de um conector gravado, o primeiro ATIVO vence — a
 * tabela hoje só permite um por provider, e "duas plataformas ao mesmo tempo"
 * é decisão de produto que ainda não foi tomada.
 */
export async function resolveTaskProvider(
  organizationId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskProvider> {
  if (organizationId) {
    const rows = await loadConnectorRows(organizationId);
    const ativo = rows.find((r) => r.status === 'ativa') ?? rows[0];
    if (ativo) return buildProviderFromConfig(ativo, organizationId);
  }
  return providerDoFallbackDeEnv(env);
}

export interface ClickUpCredentials {
  apiKey: string;
  teamId: string;
}

/**
 * Credenciais CRUAS de ClickUp da empresa, pro código que ainda não fala a
 * interface `TaskProvider` (listar membros do workspace, comentários, anexo —
 * fora dela hoje, ver task-provider.ts). Mesma fonte de `resolveTaskProvider`
 * (`loadConnectorRows`), nunca uma segunda leitura de `organization_connectors`.
 *
 * `null` SÓ quando a empresa não tem conector próprio — aí quem chama decide
 * o fallback (ver `resolveClickUpAccess` em apps/api/src/integrations/access.ts).
 * Quando a empresa TEM um conector mas ele está inativo ou malformado, lança
 * `ConnectorConfigError` em vez de devolver `null` — a mesma regra de
 * `resolveTaskProvider`: config própria quebrada nunca vira "não configurei,
 * pode usar a global", porque as duas respostas levam o chamador a decisões
 * diferentes (uma cai no fallback de propósito, a outra não pode cair).
 */
export async function resolveClickUpCredentials(
  organizationId: string | null | undefined,
): Promise<ClickUpCredentials | null> {
  if (!organizationId) return null;
  const rows = await loadConnectorRows(organizationId);
  const clickup = rows.find((r) => r.provider === 'clickup');
  if (!clickup) return null;
  if (clickup.status !== 'ativa') {
    throw new ConnectorConfigError(
      `O conector clickup desta empresa está ${clickup.status}. Reative-o nas configurações da empresa.`,
      organizationId,
      'clickup',
    );
  }
  const parsed = clickupCredentialsSchema.safeParse(clickup.credentials);
  if (!parsed.success) {
    throw new ConnectorConfigError(
      'A configuração do ClickUp desta empresa está incompleta (apiKey/teamId). Refaça a conexão nas configurações da empresa.',
      organizationId,
      'clickup',
    );
  }
  return { apiKey: parsed.data.apiKey, teamId: parsed.data.teamId };
}

export interface ClickUpCredentialsResolution {
  organizationId: string;
  credentials: ClickUpCredentials | null;
  /** Preenchido só quando a empresa TEM um conector e ele está quebrado —
   *  nunca quando ela simplesmente não configurou um (`credentials: null`
   *  sem `error` é "sem conector ainda", estado normal). */
  error: string | null;
}

/**
 * A MESMA pergunta de `resolveClickUpCredentials`, para VÁRIAS empresas de
 * uma vez — a peça que faltava para qualquer consulta agregada (ex.:
 * `GET /clickup/tasks/agency`, que antes resolvia UMA credencial para
 * clientes de organizações potencialmente diferentes, documentado como
 * MULTI-TENANT RELEASE GATE: PARTIAL).
 *
 * Nunca lança: uma empresa com conector quebrado não pode derrubar a
 * consulta de todas as outras — ela aparece como `error` preenchido, e quem
 * chama decide (normalmente: incluir as demais organizações no resultado,
 * avisar que esta ficou de fora). "Credencial errada never cruza tenant":
 * cada organização só é consultada com a credencial DELA, nunca a de outra
 * nem a global como substituta de uma config quebrada (mesma regra de
 * `resolveClickUpCredentials` — config existente nunca cai no fallback).
 */
export async function resolveClickUpCredentialsForOrganizations(
  organizationIds: readonly string[],
): Promise<Map<string, ClickUpCredentialsResolution>> {
  const unicas = [...new Set(organizationIds)];
  const resolvidas = await Promise.all(
    unicas.map(async (organizationId): Promise<ClickUpCredentialsResolution> => {
      try {
        const credentials = await resolveClickUpCredentials(organizationId);
        return { organizationId, credentials, error: null };
      } catch (erro) {
        const mensagem = erro instanceof ConnectorConfigError ? erro.message : erro instanceof Error ? erro.message : String(erro);
        return { organizationId, credentials: null, error: mensagem };
      }
    }),
  );
  return new Map(resolvidas.map((r) => [r.organizationId, r]));
}
