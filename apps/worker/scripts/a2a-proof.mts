/**
 * a2a-proof.mts — prova o A2A nos dois sentidos, o teto de salto e o escopo.
 *
 * O A2A daqui não é modelo conversando com modelo: é envelope tipado atendido
 * por PROVEDOR DE DOMÍNIO, com dado de fonte. A prova precisa mostrar isso:
 * que o conteúdo devolvido veio do ClickUp e da memória, não de geração.
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { desc, eq, sql } from 'drizzle-orm';
import { createLogger } from '@desigual-os/logging';
import { mensagensDaExecucao, MAX_SALTOS_A2A, enviarMensagemA2A } from '@desigual-os/orchestrator';
import { resolveCrossAgentContext } from '../src/processors/cross-agent-context.js';

const logger = createLogger({ service: 'qa' });
let falhas = 0;
const checa = (n: string, ok: boolean, d = '') => { console.log(ok ? `PASS  ${n}` : `FALHA ${n} ${d}`); if (!ok) falhas++; };

// Campanha real e ativa, com tasks: é o que o provedor operacional lê.
const [camp] = await db.select({
  id: schema.campaigns.id, nome: schema.campaigns.canonicalName,
  clientId: schema.campaigns.clientId, abertas: schema.campaigns.openTaskCount,
}).from(schema.campaigns).where(sql`${schema.campaigns.status} = 'active' and ${schema.campaigns.openTaskCount} > 0`)
  .orderBy(desc(schema.campaigns.taskCount)).limit(1);
if (!camp) { console.error('nenhuma campanha ativa'); process.exit(1); }
console.log(`campanha usada: ${camp.nome} (${camp.abertas} tarefas abertas)\n`);

// ---------- OTTO -> BENTO (operacional) ----------
const exec1 = `QA-A2A-${Date.now()}`;
const otto = await resolveCrossAgentContext({
  agent: 'otto',
  message: 'crie uma legenda considerando o status atual e o que ainda está pendente nessa campanha',
  executionId: exec1, clientId: camp.clientId, campaignId: camp.id, environment: 'production', logger,
});
checa('a2a_otto_para_bento_responde', otto.bloco.length > 0);
checa('a2a_traz_dado_de_fonte', /tarefas em aberto/i.test(otto.bloco), otto.bloco.slice(0, 80));
checa('a2a_proibe_inventar', /N[ÃA]O invente prazo/i.test(otto.bloco));
checa('a2a_registra_chamada', otto.chamadas.length === 1 && otto.chamadas[0]!.para === 'bento');

// ---------- BENTO -> OTTO (criativo) ----------
const exec2 = `QA-A2A-${Date.now()}-b`;
const bento = await resolveCrossAgentContext({
  agent: 'bento',
  message: 'o que mudou criativamente nessa campanha e qual foi o último direcionamento aprovado?',
  executionId: exec2, clientId: camp.clientId, campaignId: camp.id, environment: 'production', logger,
});
// Pode vir vazio se o cliente não tiver feedback/episódio registrado — e vazio
// é resposta honesta, não falha: o provedor não inventa direção criativa.
checa('a2a_bento_para_otto_nao_inventa', bento.bloco.length === 0 || /mem[óo]ria registrada/i.test(bento.bloco),
  bento.bloco.slice(0, 80) || '(sem direção criativa registrada — correto)');

// ---------- TETO DE SALTO ----------
const exec3 = `QA-A2A-${Date.now()}-hop`;
const enviados: boolean[] = [];
for (let i = 0; i < MAX_SALTOS_A2A + 2; i++) {
  const r = await enviarMensagemA2A({
    executionId: exec3, fromAgent: i % 2 ? 'otto' : 'bento', toAgent: i % 2 ? 'bento' : 'otto',
    type: 'CONTEXT_REQUEST', clientId: camp.clientId, campaignId: camp.id, environment: 'production',
  });
  enviados.push(r.ok);
}
checa('a2a_loop_is_bounded', enviados.filter(Boolean).length === MAX_SALTOS_A2A, `aceitos=${enviados.filter(Boolean).length}`);
const msgs = await mensagensDaExecucao(exec3);
checa('a2a_e_auditavel', msgs.length === MAX_SALTOS_A2A && msgs.every((m) => m.hop >= 1));

// ---------- ESCOPO ----------
const guardadas = await db.select({ env: schema.agentMessages.environment, client: schema.agentMessages.clientId })
  .from(schema.agentMessages).where(eq(schema.agentMessages.executionId, exec1));
checa('a2a_carrega_escopo', guardadas.every((g) => g.env === 'production' && g.client === camp.clientId));

await db.delete(schema.agentMessages).where(sql`execution_id like ${'QA-A2A-%'}`).catch(() => undefined);

console.log(falhas === 0 ? '\nA2A: OK' : `\nA2A: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
