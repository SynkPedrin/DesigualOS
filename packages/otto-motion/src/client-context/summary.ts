import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * RESUMO BARATO do contexto do cliente, pro card de briefing do chat.
 *
 * Diferente do `resolveClientContext` (que monta o dossiê inteiro e copia
 * assets pro workspace), isto aqui é só LEITURA DE CONTAGEM: nenhum asset é
 * baixado, nenhum brain é parseado. Ele existe pra UMA frase — "encontrei os
 * materiais da <cliente>: ✓ logo ✓ N imagens" — que o guard usa quando o
 * pedido de motion chega sem briefing, pra pessoa saber o que já existe antes
 * de preencher o card.
 */
export interface ClientContextSummary {
  /** Null quando o clientId não existe no banco (o chamador degrada pra texto genérico). */
  clientName: string | null;
  hasBrandKit: boolean;
  logoUrl: string | null;
  colors: string[];
  fonts: string[];
  /** studio_assets type 'image'/'carousel'. */
  images: number;
  /** studio_assets type 'video'/'reels'. */
  videos: number;
  totalAssets: number;
  /** memories kind client.profile com subject terminando em ':brain'. */
  hasBrain: boolean;
}

export async function summarizeClientContext(clientId: string): Promise<ClientContextSummary> {
  const [client] = await db
    .select({ name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  const [kit] = await db
    .select({
      logoUrl: schema.clientBrandKits.logoUrl,
      colors: schema.clientBrandKits.colors,
      fonts: schema.clientBrandKits.fonts,
    })
    .from(schema.clientBrandKits)
    .where(eq(schema.clientBrandKits.clientId, clientId))
    .limit(1);

  // COUNT por type, não SELECT de linhas: o acervo pode ter centenas de peças
  // e aqui só interessa o número.
  const assetCounts = await db
    .select({ type: schema.studioAssets.type, count: sql<number>`count(*)::int` })
    .from(schema.studioAssets)
    .where(eq(schema.studioAssets.clientId, clientId))
    .groupBy(schema.studioAssets.type);

  // `subject` mora em metadata->>'subject', não em coluna — mesmo padrão do
  // resolver (resolver.ts:53-64). O LIMIT é cinto de segurança: um cliente
  // tem poucos profiles, mas o brain é reconhecido por sufixo, não por id.
  const profiles = await db
    .select({ subject: sql<string | null>`${schema.memories.metadata}->>'subject'` })
    .from(schema.memories)
    .where(
      and(
        eq(schema.memories.clientId, clientId),
        eq(schema.memories.kind, 'client.profile'),
        eq(schema.memories.status, 'active'),
      ),
    )
    .limit(8);

  let images = 0;
  let videos = 0;
  let totalAssets = 0;
  for (const row of assetCounts) {
    totalAssets += row.count;
    if (row.type === 'image' || row.type === 'carousel') images += row.count;
    else if (row.type === 'video' || row.type === 'reels') videos += row.count;
  }

  return {
    clientName: client?.name ?? null,
    hasBrandKit: Boolean(kit && (kit.logoUrl || kit.colors.length > 0 || kit.fonts.length > 0)),
    logoUrl: kit?.logoUrl ?? null,
    colors: kit?.colors ?? [],
    fonts: kit?.fonts ?? [],
    images,
    videos,
    totalAssets,
    hasBrain: profiles.some((row) => row.subject?.endsWith(':brain')),
  };
}
