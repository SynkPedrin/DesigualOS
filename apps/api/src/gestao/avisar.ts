import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { publishWsEvent } from '@desigual-os/orchestrator';

const logger = createLogger({ service: 'api:gestao' });

/**
 * "A EQUIPE MUDOU" AO VIVO. O painel da gestão (no Hoje de quem administra) é
 * atualizado na hora quando algo do trabalho muda — tarefa movida no ClickUp,
 * cache de tarefas relido. O evento não leva dado nenhum, só o aviso: cada tela
 * busca de novo com a própria permissão (mesmo princípio da Comunicação).
 *
 * Vai só para administradores ativos (recipient_ids, filtrado no servidor de
 * WebSocket). Uma rajada de webhooks (edição em lote no ClickUp) vira no
 * máximo um aviso a cada 5 s.
 */
const INTERVALO_MS = 5_000;
let ultimo = 0;
let pendente: NodeJS.Timeout | null = null;

async function administradores(): Promise<string[]> {
  const linhas = await db.execute<{ id: string }>(sql`
    select distinct u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
    where r.name = 'master' and u.active and u.deleted_at is null
  `);
  return linhas.map((l) => l.id);
}

async function enviar(motivo: string) {
  ultimo = Date.now();
  try {
    const recipient_ids = await administradores();
    if (recipient_ids.length) await publishWsEvent({ type: 'gestao.mudou', payload: { recipient_ids, motivo } });
  } catch (error) {
    logger.warn({ error }, 'Aviso ao vivo da gestão falhou (a tela recupera pelo refetch)');
  }
}

export function avisarGestao(motivo: string): void {
  if (process.env.VITEST) return;
  const espera = ultimo + INTERVALO_MS - Date.now();
  if (espera <= 0) { void enviar(motivo); return; }
  if (pendente) return;
  pendente = setTimeout(() => { pendente = null; void enviar(motivo); }, espera);
  pendente.unref?.();
}
