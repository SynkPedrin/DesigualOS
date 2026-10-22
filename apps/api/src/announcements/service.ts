import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * ANÚNCIOS DE FUNCIONALIDADE — quem é elegível e o que cada pessoa já fez com
 * cada anúncio. A tela só pergunta; quem decide é aqui. Ver o schema
 * (packages/database/src/schema/announcements.ts) para o modelo.
 */

export type Anuncio = typeof schema.featureAnnouncements.$inferSelect;
export type EstadoDoAnuncio = typeof schema.featureAnnouncementStates.$inferSelect;

export const ESTADOS = ['not_seen', 'dismissed', 'in_progress', 'completed'] as const;
export const ROLLOUTS = ['off', 'qa', 'all'] as const;
export type Evento = 'shown' | 'dismissed' | 'started' | 'step' | 'completed';

export interface Pessoa {
  id: string;
  roles: string[];
  /** Módulos do workspace desta pessoa (requireModule usa a mesma fonte). */
  modulos: Set<string>;
  organizationId: string | null;
}

/** A regra de elegibilidade, pura (testada sozinha). Ativo, no ar, no rollout e no público. */
export function elegivel(a: Pick<Anuncio, 'active' | 'rollout' | 'qaUserIds' | 'publishedAt' | 'expiresAt' | 'audience'>, p: Pessoa, agora = new Date()): boolean {
  if (!a.active || a.rollout === 'off') return false;
  if (a.publishedAt.getTime() > agora.getTime()) return false;
  if (a.expiresAt && a.expiresAt.getTime() <= agora.getTime()) return false;
  if (a.rollout === 'qa' && !a.qaUserIds.includes(p.id)) return false;
  if (a.rollout !== 'qa' && a.rollout !== 'all') return false;
  const publico = a.audience ?? {};
  if (publico.modules?.some((m) => !p.modulos.has(m))) return false;
  if (publico.roles?.length && !publico.roles.some((r) => p.roles.includes(r))) return false;
  if (publico.organization_ids?.length && (!p.organizationId || !publico.organization_ids.includes(p.organizationId))) return false;
  return true;
}

/** Abre sozinho? Só uma vez (auto_shown_at), e nunca depois de dispensado ou concluído. */
export function deveAbrirSozinho(a: Pick<Anuncio, 'display'>, e: Pick<EstadoDoAnuncio, 'autoShownAt' | 'state'> | null): boolean {
  if (!a.display?.auto_open) return false;
  if (!e) return true;
  return !e.autoShownAt && e.state !== 'dismissed' && e.state !== 'completed';
}

/** Anúncios elegíveis para a pessoa, com o estado dela, do mais prioritário ao menos. Uma consulta. */
export async function anunciosDaPessoa(p: Pessoa): Promise<Array<{ anuncio: Anuncio; estado: EstadoDoAnuncio | null }>> {
  const linhas = await db.select({ anuncio: schema.featureAnnouncements, estado: schema.featureAnnouncementStates })
    .from(schema.featureAnnouncements)
    .leftJoin(schema.featureAnnouncementStates, and(
      eq(schema.featureAnnouncementStates.announcementId, schema.featureAnnouncements.id),
      eq(schema.featureAnnouncementStates.userId, p.id),
    ))
    .where(and(eq(schema.featureAnnouncements.active, true), sql`${schema.featureAnnouncements.rollout} <> 'off'`));
  return linhas
    .filter((l) => elegivel(l.anuncio, p))
    .sort((x, y) => y.anuncio.priority - x.anuncio.priority || y.anuncio.publishedAt.getTime() - x.anuncio.publishedAt.getTime());
}

export async function anuncioElegivel(p: Pessoa, chave: string) {
  return (await anunciosDaPessoa(p)).find((l) => l.anuncio.key === chave) ?? null;
}

/**
 * Registra o que a pessoa fez. Tudo é upsert na linha única (anúncio, pessoa):
 * repetir o mesmo evento — outra aba, outro aparelho, clique duplo — dá o mesmo
 * resultado. `completed` nunca volta atrás.
 *
 * 'shown' é diferente: é a REIVINDICAÇÃO da apresentação automática. Só uma
 * chamada por pessoa ganha (`auto_shown_at` passa de nulo para agora); as outras
 * recebem `primeira: false` e a tela não abre o modal. É isso que impede duas
 * abas abertas de mostrarem o anúncio duas vezes.
 */
export async function registrarEvento(anuncio: Anuncio, p: Pessoa, evento: Evento, etapa?: number | null): Promise<{ primeira: boolean; estado: EstadoDoAnuncio | null }> {
  const base = { announcementId: anuncio.id, userId: p.id, organizationId: p.organizationId };
  const alvo = [schema.featureAnnouncementStates.announcementId, schema.featureAnnouncementStates.userId];
  const t = schema.featureAnnouncementStates;
  if (evento === 'shown') {
    const [linha] = await db.insert(t)
      .values({ ...base, state: 'not_seen', firstSeenAt: sql`now()`, autoShownAt: sql`now()`, lastInteractionAt: sql`now()` })
      .onConflictDoUpdate({
        target: alvo,
        set: { autoShownAt: sql`now()`, firstSeenAt: sql`coalesce(${t.firstSeenAt}, now())`, lastInteractionAt: sql`now()`, updatedAt: sql`now()` },
        where: sql`${t.autoShownAt} is null and ${t.state} not in ('dismissed', 'completed')`,
      })
      .returning();
    return { primeira: Boolean(linha), estado: linha ?? null };
  }
  const naoDesconclui = (valor: string) => sql`case when ${t.state} = 'completed' then 'completed' else ${valor} end`;
  const novo = evento === 'dismissed' ? 'dismissed' : evento === 'completed' ? 'completed' : 'in_progress';
  const [linha] = await db.insert(t)
    .values({
      ...base,
      state: novo,
      firstSeenAt: sql`now()`,
      lastInteractionAt: sql`now()`,
      dismissedAt: evento === 'dismissed' ? sql`now()` : null,
      completedAt: evento === 'completed' ? sql`now()` : null,
      tutorialVersion: evento === 'dismissed' ? null : anuncio.tutorialVersion,
      tutorialStep: etapa ?? null,
    })
    .onConflictDoUpdate({
      target: alvo,
      set: {
        state: evento === 'completed' ? sql`'completed'` : naoDesconclui(novo),
        firstSeenAt: sql`coalesce(${t.firstSeenAt}, now())`,
        lastInteractionAt: sql`now()`,
        updatedAt: sql`now()`,
        ...(evento === 'dismissed' ? { dismissedAt: sql`coalesce(${t.dismissedAt}, now())` } : {}),
        ...(evento === 'completed' ? { completedAt: sql`coalesce(${t.completedAt}, now())`, tutorialStep: null } : {}),
        ...(evento === 'started' || evento === 'step' ? { tutorialVersion: anuncio.tutorialVersion, tutorialStep: etapa ?? null } : {}),
      },
    })
    .returning();
  return { primeira: false, estado: linha ?? null };
}

/**
 * O aviso persistente no sino, criado quando o anúncio é apresentado. A chave de
 * deduplicação (índice único por pessoa) faz a segunda tentativa virar nada.
 */
export async function criarNotificacao(anuncio: Anuncio, p: Pessoa): Promise<void> {
  const aviso = anuncio.display?.notification;
  if (!aviso) return;
  await db.insert(schema.notifications).values({
    userId: p.id,
    organizationId: p.organizationId,
    type: 'feature.announcement',
    title: aviso.title,
    body: aviso.body,
    link: aviso.link,
    dedupeKey: `announcement:${anuncio.key}`,
  }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------

/** Todos os anúncios com a contagem por estado (visualizações, dispensas, conclusões). */
export async function anunciosComNumeros() {
  const anuncios = await db.select().from(schema.featureAnnouncements).orderBy(sql`${schema.featureAnnouncements.priority} desc, ${schema.featureAnnouncements.createdAt} desc`);
  const numeros = await db.execute<{ announcement_id: string; vistos: number; apresentados: number; dispensados: number; em_andamento: number; concluidos: number }>(sql`
    select announcement_id,
      count(*) filter (where first_seen_at is not null)::int as vistos,
      count(*) filter (where auto_shown_at is not null)::int as apresentados,
      count(*) filter (where state = 'dismissed')::int as dispensados,
      count(*) filter (where state = 'in_progress')::int as em_andamento,
      count(*) filter (where state = 'completed')::int as concluidos
    from feature_announcement_states group by announcement_id`);
  return anuncios.map((a) => ({ anuncio: a, numeros: numeros.find((n) => n.announcement_id === a.id) ?? { vistos: 0, apresentados: 0, dispensados: 0, em_andamento: 0, concluidos: 0 } }));
}

export async function alterarAnuncio(chave: string, mudanca: Partial<Pick<Anuncio, 'active' | 'rollout' | 'priority' | 'qaUserIds' | 'audience' | 'expiresAt'>>) {
  const [antes] = await db.select().from(schema.featureAnnouncements).where(eq(schema.featureAnnouncements.key, chave));
  if (!antes) return null;
  const [depois] = await db.update(schema.featureAnnouncements).set(mudanca).where(eq(schema.featureAnnouncements.key, chave)).returning();
  return { antes, depois: depois! };
}
