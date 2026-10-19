/**
 * PROVA DE RUNTIME do webhook do ClickUp enriquecido (02/10/2026).
 *
 * Teste de unidade prova a função; isto prova o CAMINHO: assina um corpo igual
 * ao do ClickUp, manda para a API que está no ar e lê do BANCO o que ficou
 * gravado — não o que a rota respondeu.
 *
 * ESCREVE NUMA TABELA REAL. O evento que ele cria afirma uma transição de
 * status que não aconteceu, e por isso é APAGADO no fim. Se o script morrer no
 * meio, apague à mão o evento cujo external_id contém 'wh-prova-'; deixá-lo
 * falsifica o histórico da operação para provar que a tela não falsifica nada.
 */
import '../src/env.js';
import crypto from 'node:crypto';
import { db, schema } from '@desigual-os/database';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

// Uma tarefa que EXISTE de verdade no ClickUp, tirada do que já foi gravado.
const [ref] = await db.select({ taskId: schema.operationalEvents.taskId, clientId: schema.operationalEvents.clientId })
  .from(schema.operationalEvents)
  .where(and(eq(schema.operationalEvents.source, 'clickup'), isNotNull(schema.operationalEvents.taskId),
             sql`${schema.operationalEvents.taskId} not like 'prova-%'`))
  .orderBy(desc(schema.operationalEvents.occurredAt)).limit(1);
if (!ref?.taskId) { console.log('nenhuma task real gravada ainda'); process.exit(1); }

const [cli] = await db.select().from(schema.clients).where(eq(schema.clients.id, ref.clientId!));
const corpo = JSON.stringify({
  event: 'taskUpdated', task_id: ref.taskId, webhook_id: `wh-prova-${Date.now()}`, list_id: cli?.clickupListId,
  history_items: [{ date: String(Date.now()), field: 'status',
    user: { id: 12345678, username: 'Prova' },
    before: { status: 'em producao' }, after: { status: 'em aprovacao' } }],
});
const r = await fetch('http://127.0.0.1:3001/clickup/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-signature': crypto.createHmac('sha256', process.env.CLICKUP_WEBHOOK_SECRET!).update(corpo).digest('hex') },
  body: corpo,
});
console.log('HTTP', r.status, 'task real:', ref.taskId);
await new Promise((s) => setTimeout(s, 6000));

const [ev] = await db.select().from(schema.operationalEvents)
  .where(and(eq(schema.operationalEvents.source, 'clickup'), eq(schema.operationalEvents.taskId, ref.taskId)))
  .orderBy(desc(schema.operationalEvents.createdAt)).limit(1);
console.log('  summary  :', ev?.summary);
console.log('  task_name:', (ev?.payload as Record<string, unknown> | null)?.['task_name']);

// LIMPEZA OBRIGATORIA: o evento acima afirma uma mudanca de status que nao
// aconteceu. A prova termina removendo a propria sujeira.
if (ev) {
  await db.delete(schema.operationalEvents).where(eq(schema.operationalEvents.id, ev.id));
  console.log('  evento de prova removido');
}
process.exit(0);
