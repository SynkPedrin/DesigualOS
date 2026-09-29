import { and, desc, eq, ilike } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AssetProvider, AssetRef } from '@desigual-os/mcp-domain';

/**
 * studio-asset-provider.ts — as peças já produzidas, vindas do Studio.
 *
 * O Studio do Desigual OS já guarda o que foi gerado (`studio_assets`). Este
 * adapter apenas expõe aquilo pela fronteira do MCP, recortado por organização
 * — nenhuma tabela nova, nenhum segundo lugar guardando a mesma coisa.
 */
export class StudioAssetProvider implements AssetProvider {
  readonly nome = 'studio';

  constructor(private readonly deps: { organizationId: string }) {}

  async searchAssets(query: { clientId?: string; text?: string; limit?: number }): Promise<AssetRef[]> {
    const condicoes = [eq(schema.clients.organizationId, this.deps.organizationId)];
    if (query.clientId) condicoes.push(eq(schema.studioAssets.clientId, query.clientId));
    if (query.text) condicoes.push(ilike(schema.studioAssets.filename, `%${query.text}%`));
    const linhas = await db
      .select({
        id: schema.studioAssets.id, type: schema.studioAssets.type,
        filename: schema.studioAssets.filename,
        clientId: schema.studioAssets.clientId, url: schema.studioAssets.storageUrl,
        createdAt: schema.studioAssets.createdAt,
      })
      .from(schema.studioAssets)
      // O join com clients é o que aplica a fronteira de organização: asset
      // órfão de cliente não aparece, e é o comportamento certo aqui.
      .innerJoin(schema.clients, eq(schema.clients.id, schema.studioAssets.clientId))
      .where(and(...condicoes))
      .orderBy(desc(schema.studioAssets.createdAt))
      .limit(Math.min(query.limit ?? 20, 50));
    return linhas.map((a) => ({
      id: a.id,
      name: a.filename,
      kind: a.type,
      clientId: a.clientId,
      url: a.url,
      createdAt: a.createdAt ? a.createdAt.getTime() : null,
    }));
  }

  async getAsset(assetId: string): Promise<AssetRef | null> {
    const [a] = await this.searchAssets({ limit: 50 }).then((r) => r.filter((x) => x.id === assetId));
    return a ?? null;
  }

  async registerAsset(): Promise<AssetRef> {
    /**
     * Registrar peça pelo MCP ainda não é suportado, e falhar alto é melhor que
     * gravar numa tabela que o Studio não lê: a peça apareceria no MCP e não no
     * app, e ninguém entenderia por quê.
     */
    throw new Error('Registro de peça pelo MCP ainda não está disponível — use o Studio do Desigual OS.');
  }
}
