import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { gatewayForWhatsappSession, type WhatsappSessionRow } from './openwa-session-store';
import type { OpenwaSessionSnapshot } from './openwa-gateway';

/**
 * VIGIA DAS SESSÕES DE WHATSAPP (29/10/2026).
 *
 * O WhatsApp do Matheus ficou uma semana desconectado e o da Alicia um dia, sem ninguém saber: o estado no banco só
 * mudava por webhook do motor ou quando alguém abria a tela de Integrações. A Inbox deles simplesmente parou.
 *
 * A cada passada (o worker chama a cada 2 min): pergunta ao OpenWA o estado real de cada sessão, grava, e avisa
 * quem precisa agir. Caiu: o dono e os administradores recebem notificação na plataforma, repetida uma vez por dia
 * enquanto continuar fora. Voltou: devolve a sessão para o worker sincronizar. Motor inteiro inacessível não marca
 * ninguém como desconectado (não é a sessão que caiu) e vira um alerta só.
 */

export type MudancaDeSessao = { sessionId: string; ownerUserId: string; de: string; para: string };
type Consultar = (session: WhatsappSessionRow) => Promise<OpenwaSessionSnapshot>;

const TIPO = 'whatsapp_desconectado';
const LINK = '/integrations';

export async function vigiarSessoesDoWhatsapp(consultar: Consultar = (s) => gatewayForWhatsappSession(s).getSession()): Promise<{ mudancas: MudancaDeSessao[]; motorInacessivel: boolean }> {
  const sessoes = await db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.provider, 'openwa'));
  const mudancas: MudancaDeSessao[] = [];
  let falhasDeRede = 0;
  for (const session of sessoes as WhatsappSessionRow[]) {
    let snapshot: OpenwaSessionSnapshot;
    try {
      snapshot = await consultar(session);
    } catch (error) {
      const status = (error as { status?: number | null }).status;
      if (status === 404) snapshot = { id: '', name: '', status: 'disconnected', phone: null, pushName: null, connectedAt: null, lastActive: null, lastError: 'Sessão não existe mais no motor do WhatsApp', engineLoaded: false };
      else { falhasDeRede += 1; continue; }
    }
    const de = session.status;
    const para = snapshot.status;
    await db.update(schema.whatsappSessions).set({
      status: para,
      engineLoaded: snapshot.engineLoaded,
      ...(snapshot.phone ? { phoneNumber: snapshot.phone } : {}),
      ...(snapshot.lastActive ? { lastSeenAt: new Date(snapshot.lastActive) } : {}),
      lastError: snapshot.lastError,
    }).where(eq(schema.whatsappSessions.id, session.id));
    if (de !== para) mudancas.push({ sessionId: session.id, ownerUserId: session.ownerUserId, de, para });
    if (para !== 'ready') await avisarWhatsappForaDoAr({ ...session, status: para });
  }
  return { mudancas, motorInacessivel: sessoes.length > 0 && falhasDeRede === sessoes.length };
}

/**
 * Notifica o dono e os administradores da empresa que o WhatsApp da pessoa está fora. Uma vez por dia por sessão:
 * a primeira notificação sai na queda; enquanto não voltar, uma por dia.
 */
export async function avisarWhatsappForaDoAr(session: Pick<WhatsappSessionRow, 'id' | 'organizationId' | 'ownerUserId' | 'pushName' | 'status'>): Promise<number> {
  const marca = `${LINK}?whatsapp=${session.id}`;
  const [recente] = await db.select({ id: schema.notifications.id }).from(schema.notifications).where(and(
    eq(schema.notifications.type, TIPO),
    eq(schema.notifications.link, marca),
    gt(schema.notifications.createdAt, sql`now() - interval '24 hours'`),
  )).limit(1);
  if (recente) return 0;
  const [dono] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, session.ownerUserId)).limit(1);
  const nome = dono?.name ?? session.pushName ?? 'um colaborador';
  const admins = await db.select({ userId: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(
    eq(schema.organizationMembers.organizationId, session.organizationId),
    inArray(sql`lower(${schema.organizationMembers.role})`, ['owner', 'admin', 'manager']),
  ));
  const linhas = [
    { userId: session.ownerUserId, type: TIPO, link: marca, title: 'Seu WhatsApp saiu da plataforma', body: 'As conversas novas não estão chegando na Inbox. Abra Integrações → WhatsApp e leia o QR com o celular para reconectar.' },
    ...admins.filter((a) => a.userId !== session.ownerUserId).map((a) => ({ userId: a.userId, type: TIPO, link: marca, title: `WhatsApp de ${nome} desconectado`, body: `A Inbox de ${nome} parou de receber conversas. Só a própria pessoa consegue reconectar, lendo o QR em Integrações → WhatsApp.` })),
  ];
  await db.insert(schema.notifications).values(linhas);
  return linhas.length;
}
