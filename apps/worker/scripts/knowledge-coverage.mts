/**
 * knowledge-coverage.mts — a matriz de cobertura por cliente.
 *
 * Existe para responder "esse cliente está com conhecimento atualizado?", que é
 * a pergunta que a operação faz, em vez de "a busca devolveu alguma coisa?", que
 * é a única que o sistema sabia responder antes — e que respondeu "sim" enquanto
 * entregava a campanha do cliente errado.
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { eq, isNull, sql } from 'drizzle-orm';

const DIAS_PARA_STALE = 7;
const agora = Date.now();

const clientes = await db
  .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
  .from(schema.clients)
  .where(isNull(schema.clients.deletedAt));

const campanhas = await db
  .select({
    clientId: schema.campaigns.clientId,
    n: sql<number>`count(*)::int`,
    ativas: sql<number>`count(*) filter (where ${schema.campaigns.status} = 'active')::int`,
    comContexto: sql<number>`count(*) filter (where jsonb_array_length(${schema.campaigns.recentTasks}) > 0)::int`,
    ultima: sql<Date | null>`max(${schema.campaigns.lastSourceUpdateAt})`,
  })
  .from(schema.campaigns)
  .groupBy(schema.campaigns.clientId);

const relacoes = await db
  .select({ clientId: schema.personClientRelations.clientId, n: sql<number>`count(*)::int` })
  .from(schema.personClientRelations)
  .groupBy(schema.personClientRelations.clientId);

const perfis = await db
  .select({ clientId: schema.memories.clientId, n: sql<number>`count(*)::int` })
  .from(schema.memories)
  .where(sql`${schema.memories.kind} = 'client.profile' and ${schema.memories.status} = 'active'`)
  .groupBy(schema.memories.clientId);

const syncs = await db
  .select({ clientId: schema.clientKnowledgeSync.clientId, source: schema.clientKnowledgeSync.source, status: schema.clientKnowledgeSync.status, lastSyncAt: schema.clientKnowledgeSync.lastSyncAt })
  .from(schema.clientKnowledgeSync);

const porId = <T extends { clientId: string | null }>(xs: T[]) => new Map(xs.filter((x) => x.clientId).map((x) => [x.clientId!, x]));
const mapaCampanhas = porId(campanhas);
const mapaRelacoes = porId(relacoes);
const mapaPerfis = porId(perfis);

let comTudo = 0, semLista = 0, semCampanha = 0, semPerfil = 0, stale = 0;
const problemas: string[] = [];

for (const c of clientes) {
  const camp = mapaCampanhas.get(c.id);
  const rel = mapaRelacoes.get(c.id);
  const perfil = mapaPerfis.get(c.id);
  const sync = syncs.find((s) => s.clientId === c.id && s.source === 'campaigns');
  const desatualizado = sync?.lastSyncAt ? agora - sync.lastSyncAt.getTime() > DIAS_PARA_STALE * 86_400_000 : true;

  if (!c.listId) { semLista += 1; problemas.push(`${c.name}: sem lista no ClickUp`); }
  if (!camp || camp.n === 0) semCampanha += 1;
  if (!perfil || perfil.n === 0) semPerfil += 1;
  if (desatualizado) stale += 1;
  if (c.listId && camp?.n && perfil?.n && !desatualizado) comTudo += 1;

  if (process.argv.includes('--detalhe')) {
    console.log(
      [
        c.name.padEnd(38).slice(0, 38),
        `lista:${c.listId ? 'ok ' : 'NAO'}`,
        `campanhas:${String(camp?.n ?? 0).padStart(3)}`,
        `ativas:${String(camp?.ativas ?? 0).padStart(3)}`,
        `ctx:${String(camp?.comContexto ?? 0).padStart(3)}`,
        `pessoas:${String(rel?.n ?? 0).padStart(3)}`,
        `perfil:${perfil?.n ?? 0}`,
        `sync:${sync?.lastSyncAt ? sync.lastSyncAt.toISOString().slice(0, 10) : 'nunca'}`,
      ].join(' | '),
    );
  }
}

const totalCampanhas = campanhas.reduce((s, c) => s + c.n, 0);
const comContexto = campanhas.reduce((s, c) => s + c.comContexto, 0);

console.log('\n================ COBERTURA DE CONHECIMENTO ================');
console.log(`clientes ativos ................ ${clientes.length}`);
console.log(`com lista no ClickUp ........... ${clientes.length - semLista}`);
console.log(`com campanhas no registro ...... ${clientes.length - semCampanha}`);
console.log(`com dossiê/perfil .............. ${clientes.length - semPerfil}`);
console.log(`reconciliados nos últimos ${DIAS_PARA_STALE}d ... ${clientes.length - stale}`);
console.log(`campanhas totais ............... ${totalCampanhas} (${comContexto} com contexto de tasks)`);
console.log(`relações pessoa<->cliente ...... ${relacoes.reduce((s, r) => s + r.n, 0)}`);
if (problemas.length > 0) {
  console.log('\nlacunas:');
  for (const p of problemas.slice(0, 20)) console.log('  -', p);
}
process.exit(0);
