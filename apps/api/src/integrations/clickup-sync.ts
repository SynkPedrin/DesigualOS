import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getClientLists } from '@desigual-os/tool-gateway';
import { recordLearning } from '@desigual-os/orchestrator';
import type { ClickUpAccess } from './access';

export interface ClickUpSyncResult {
  found: number;
  created: number;
  updated: number;
}

/** Slug estável a partir do nome da lista, pra casar com clients.slug (kebab-case). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Importa os clientes do ClickUp. Vive fora da rota de propósito: a rota HTTP
 * e o script `pnpm clickup:import` chamam ESTA função, então não existe uma
 * segunda implementação do mapeamento pra divergir com o tempo.
 *
 * Idempotente por clients.clickup_list_id: reimportar atualiza nome/status
 * em vez de duplicar.
 */
export async function syncClickUpClients(access: ClickUpAccess): Promise<ClickUpSyncResult> {
  const clientLists = await getClientLists(access.token, access.teamId);
  let created = 0;
  let updated = 0;

  for (const entry of clientLists) {
    const [existing] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, entry.listId));
    if (existing) {
      if (existing.name !== entry.name || existing.status !== entry.status) {
        await db
          .update(schema.clients)
          .set({ name: entry.name, status: entry.status, updatedAt: new Date() })
          .where(eq(schema.clients.id, existing.id));
        updated += 1;
      }
      continue;
    }

    // Lista nova. Se já existe cliente com o mesmo slug, só adota quando
    // essa linha AINDA NÃO está amarrada a outra lista do ClickUp (ou seja,
    // foi criada à mão antes desta integração).
    //
    // Sem essa checagem, duas listas diferentes com nomes que geram o mesmo
    // slug ficam trocando de dono a cada sync — foi medido de verdade: as
    // listas 901414400351 ("🧪 CASE #0 — Endrigo Almada / CITÁVEL™") e
    // 901414400406 ("🧪 Case #0 — ...") só diferem em maiúsculas e faziam a
    // importação reportar 2 updates em TODA rodada, num vaivém infinito.
    // Duas listas distintas são dois clientes distintos, mesmo com nome igual.
    const baseSlug = slugify(entry.name);
    const [sameSlug] = await db.select().from(schema.clients).where(eq(schema.clients.slug, baseSlug));

    if (sameSlug && !sameSlug.clickupListId) {
      await db
        .update(schema.clients)
        .set({ clickupListId: entry.listId, status: entry.status, updatedAt: new Date() })
        .where(eq(schema.clients.id, sameSlug.id));
      updated += 1;
      continue;
    }

    // Slug tomado por outra lista: desambigua com o id da lista, que é único
    // e estável (em vez de um contador, que mudaria de posição entre syncs).
    const slug = sameSlug ? `${baseSlug}-${entry.listId}`.slice(0, 60) : baseSlug;
    await db.insert(schema.clients).values({ name: entry.name, slug, status: entry.status, clickupListId: entry.listId });
    created += 1;
  }

  await recordLearning({
    kind: 'clickup.clients_synced',
    agent: 'bento',
    content:
      `Base de clientes sincronizada do ClickUp: ${clientLists.length} clientes encontrados ` +
      `(${created} novos, ${updated} atualizados). O ClickUp é a fonte de verdade dos clientes da Desigual.`,
    metadata: { found: clientLists.length, created, updated },
  });

  return { found: clientLists.length, created, updated };
}
