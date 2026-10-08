import { db, schema } from '@desigual-os/database';
import { buildMeetingBrief, proximasReunioesDeCliente } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

/**
 * meeting-prep.ts — Meeting Prep (Parte L do prompt "CALENDAR + AUTOMATIONS
 * + BENTO V2", §51-53, 06/10/2026): quem vai numa reunião de cliente recebe
 * o contexto (demandas abertas, aprovação pendente, última conversa) ~15
 * minutos antes, sem precisar ir caçar em quatro telas.
 *
 * DEDUP POR EXISTÊNCIA (mesmo padrão de aviso-de-conexao-mcp.ts): nenhuma
 * marca d'água em memória, que reiniciaria com o worker e reavisaria tudo —
 * `proximasReunioesDeCliente` já exclui eventos que JÁ têm uma notificação
 * `meeting_prep` apontando pra eles.
 *
 * SÓ QUEM VAI é avisado: participantes INTERNOS do evento (calendar_event_
 * participants.member_id), nunca toda a organização — a mesma régua de
 * privacidade do Calendar Core (quem não participa não devia nem ver que a
 * reunião existe).
 */
export const JANELA_DE_AVISO_MINUTOS = 15;
export const TIPO_DE_AVISO = 'meeting_prep';

export async function prepararReunioesDeCliente(logger: Logger, agora = new Date()): Promise<number> {
  const candidatos = await proximasReunioesDeCliente(agora, JANELA_DE_AVISO_MINUTOS);
  if (candidatos.length === 0) return 0;

  let notificacoes = 0;
  for (const candidato of candidatos) {
    try {
      const brief = await buildMeetingBrief(candidato.id, candidato.organizationId);
      if (!brief) continue;

      const destinatarios = brief.participants.internal.map((p) => p.user_id);
      if (destinatarios.length === 0) continue;

      const pendencias: string[] = [];
      if (brief.demands.open_count > 0) pendencias.push(`${brief.demands.open_count} demanda(s) aberta(s)`);
      if (brief.approvals.pending_count > 0) pendencias.push(`${brief.approvals.pending_count} aprovação(ões) pendente(s)`);
      const body = pendencias.length > 0 ? pendencias.join(' · ') : 'Sem pendências abertas no momento.';

      await db.insert(schema.notifications).values(
        destinatarios.map((userId) => ({
          userId,
          type: TIPO_DE_AVISO,
          title: `Reunião com ${brief.client.name} em instantes`,
          body,
          link: `/calendar?evento=${brief.event.id}`,
        })),
      );
      notificacoes += destinatarios.length;
    } catch (error) {
      logger.error({ error, eventId: candidato.id }, 'Falha ao preparar Meeting Brief de uma reunião — seguindo pras próximas');
    }
  }

  if (notificacoes > 0) logger.info({ reunioes: candidatos.length, notificacoes }, 'Meeting Prep avisou reunião(ões) de cliente');
  return notificacoes;
}
