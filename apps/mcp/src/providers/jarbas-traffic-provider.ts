import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { CampaignMetrics, TrafficProvider, TrafficResult } from '@desigual-os/mcp-domain';

/**
 * jarbas-traffic-provider.ts — tráfego vem do JARBAS, não de uma integração nova.
 *
 * Decisão registrada na inspeção (docs/architecture/desigual-os-mcp.md, A.6): o
 * dado de campanha não mora neste repositório. Mora no serviço do Jarbas, e o
 * mapa autoritativo `cliente -> conta de mídia` mora num `clientData.js` fora
 * daqui. Construir uma integração Meta/Google direta aqui criaria uma SEGUNDA
 * fonte de verdade para o mesmo número — e duas fontes que divergem sobre
 * quanto um cliente gastou é pior que uma fonte só.
 *
 * Por isso este provider é um adapter, e por isso ele é honesto quando não
 * consegue: `DATA_NOT_AVAILABLE` é resposta de primeira classe (§8). O modelo
 * preenchendo buraco sobre verba de cliente é a pior alucinação possível aqui.
 */

const TIMEOUT_MS = 20_000;

export class JarbasTrafficProvider implements TrafficProvider {
  readonly nome = 'jarbas';

  constructor(private readonly deps: { organizationId: string; baseUrl?: string | undefined; token?: string | undefined }) {}

  private get url(): string | null {
    return this.deps.baseUrl ?? process.env.JARBAS_ASK_URL ?? null;
  }

  /**
   * Resolve o cliente na conta de mídia. Mais de uma conta primária é estado
   * AMBÍGUO, nunca resolvido por ordem de inserção — escolher a conta errada
   * significa relatar o desempenho de outra campanha como se fosse desta.
   */
  private async contaDeMidia(clientId: string): Promise<{ status: 'ok'; accountId: string } | { status: 'none' } | { status: 'ambiguous'; count: number }> {
    const linhas = await db
      .select({ accountId: schema.clientMetaAccounts.accountId, isPrimary: schema.clientMetaAccounts.isPrimary })
      .from(schema.clientMetaAccounts)
      .where(and(eq(schema.clientMetaAccounts.clientId, clientId)));
    if (linhas.length === 0) return { status: 'none' };
    const primarias = linhas.filter((l) => l.isPrimary);
    if (primarias.length > 1) return { status: 'ambiguous', count: primarias.length };
    const escolhida = primarias[0] ?? linhas[0];
    return { status: 'ok', accountId: escolhida!.accountId };
  }

  private async indisponivel(clientId: string, motivo?: string): Promise<TrafficResult<never>> {
    if (motivo) return { status: 'DATA_NOT_AVAILABLE', reason: motivo };
    const conta = await this.contaDeMidia(clientId);
    if (conta.status === 'none') {
      return { status: 'DATA_NOT_AVAILABLE', reason: 'Este cliente não tem conta de mídia vinculada no Desigual OS.' };
    }
    if (conta.status === 'ambiguous') {
      return {
        status: 'DATA_NOT_AVAILABLE',
        reason: `Este cliente tem ${conta.count} contas marcadas como principal. Não dá para escolher sem errar — resolva o cadastro antes.`,
      };
    }
    if (!this.url) {
      return { status: 'DATA_NOT_AVAILABLE', reason: 'O serviço de tráfego (Jarbas) não está configurado neste ambiente (JARBAS_ASK_URL ausente).' };
    }
    return { status: 'DATA_NOT_AVAILABLE', reason: 'O serviço de tráfego não devolveu dado para este período.' };
  }

  async getCampaigns(clientId: string): Promise<TrafficResult<CampaignMetrics[]>> {
    return this.getCampaignPerformance(clientId, {});
  }

  async getCampaignPerformance(
    clientId: string,
    options: { from?: string; to?: string; campaignId?: string },
  ): Promise<TrafficResult<CampaignMetrics[]>> {
    const conta = await this.contaDeMidia(clientId);
    if (conta.status !== 'ok') return this.indisponivel(clientId);
    const base = this.url;
    if (!base) return this.indisponivel(clientId, 'O serviço de tráfego (Jarbas) não está configurado neste ambiente (JARBAS_ASK_URL ausente).');

    try {
      const resposta = await fetch(`${base}/campaigns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.deps.token ? { Authorization: `Bearer ${this.deps.token}` } : {}),
        },
        body: JSON.stringify({ account_id: conta.accountId, from: options.from, to: options.to, campaign_id: options.campaignId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resposta.ok) {
        return this.indisponivel(clientId, `O serviço de tráfego respondeu ${resposta.status}.`);
      }
      const corpo = (await resposta.json()) as { campaigns?: CampaignMetrics[] };
      if (!corpo.campaigns?.length) return this.indisponivel(clientId, 'O serviço de tráfego respondeu, mas sem campanha no período.');
      return { status: 'OK', data: corpo.campaigns };
    } catch (erro) {
      // Falha de rede vira indisponibilidade DECLARADA, nunca zero nem estimativa.
      return this.indisponivel(clientId, `Não consegui falar com o serviço de tráfego: ${(erro as Error).message}`);
    }
  }

  async getRecentChanges(clientId: string, days: number): Promise<TrafficResult<Array<{ what: string; when: string; detail: string }>>> {
    const conta = await this.contaDeMidia(clientId);
    if (conta.status !== 'ok') return this.indisponivel(clientId);
    return { status: 'DATA_NOT_AVAILABLE', reason: `O histórico de alterações de campanha dos últimos ${days} dias ainda não é exposto pelo serviço de tráfego.` };
  }
}
