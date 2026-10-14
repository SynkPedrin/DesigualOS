/**
 * proatividade.mts — prova da varredura proativa do Bento no ambiente isolado.
 * Bento 3.1, P0, 14/10/2026.
 *
 *   node apps/worker/scripts/isolado/ambiente.mjs -- \
 *     pnpm --filter @desigual-os/worker exec tsx scripts/isolado/proatividade.mts
 *
 * Roda a varredura DE VERDADE (Postgres, trava no Redis, ClickUp simulado com
 * paginação real, emitSignal, notifications) — só a configuração das flags é
 * passada direto, para cada estágio ser provado na mesma execução.
 * Apaga e recria sinais e avisos das duas empresas de QA: recusa rodar fora
 * do ambiente isolado.
 */
import '../../src/env.js';
import { db } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { sql } from 'drizzle-orm';
import { varrerEmpresa, type ConfigDaProatividade } from '../../src/scheduler/bento-varredura.js';
import { briefingOperacional } from '../../src/scheduler/bento-briefing.js';

if (process.env.BENTO_ISOLADO !== '1' || !/@127\.0\.0\.1:55433\//.test(process.env.DATABASE_URL ?? '')) {
  console.error('recusado: proatividade.mts só roda no ambiente isolado (ambiente.mjs).');
  process.exit(2);
}

const ORG_A = '0a000000-0000-4000-8000-00000000000a';
const ORG_B = '0b000000-0000-4000-8000-00000000000b';
const ANA = '0a000000-0000-4000-8000-0000000000a1';
const BRUNO = '0a000000-0000-4000-8000-0000000000b2';
const CARLA = '0b000000-0000-4000-8000-0000000000c3';
const SIM = process.env.SUPABASE_URL!;
const logger = createLogger({ service: 'prova-proatividade' });

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const shadow: ConfigDaProatividade = { monitoramento: 'shadow', notificacoes: true, empresasLiberadas: null };
const live: ConfigDaProatividade = { monitoramento: 'on', notificacoes: true, empresasLiberadas: null };

const resultados: Array<{ nome: string; ok: boolean; detalhe: string }> = [];
function checa(nome: string, ok: boolean, detalhe = '') {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

async function sinais(org: string) {
  return rows<{ rule: string; status: string; dedupe_key: string; entity_id: string | null; severity: string }>(
    sql`select rule, status, dedupe_key, entity_id, severity from proactive_signals where organization_id = ${org}::uuid order by dedupe_key`,
  );
}
async function avisos(userId: string) {
  return rows<{ title: string; body: string; organization_id: string; dedupe_key: string }>(
    sql`select title, body, organization_id, dedupe_key from notifications where user_id = ${userId}::uuid and type = 'bento_alerta' order by created_at`,
  );
}

// ---------------------------------------------------------------- preparação
await db.execute(sql`delete from notifications where user_id in (${ANA}::uuid, ${BRUNO}::uuid, ${CARLA}::uuid)`);
await db.execute(sql`delete from proactive_signals where organization_id in (${ORG_A}::uuid, ${ORG_B}::uuid)`);

// ---------------------------------------------------------------- 1. shadow
const rA1 = await varrerEmpresa(ORG_A, logger, { config: shadow });
const rB1 = await varrerEmpresa(ORG_B, logger, { config: shadow });
const sA = await sinais(ORG_A);
const sB = await sinais(ORG_B);
checa('shadow: detecta e registra na empresa A', sA.length > 0 && sA.every((s) => s.status === 'shadow'), `${sA.length} sinais, ${rA1.tarefasLidas} tarefas lidas`);
checa('shadow: nenhum aviso entregue', (await avisos(ANA)).length + (await avisos(BRUNO)).length + (await avisos(CARLA)).length === 0);
checa('shadow: a empresa B também é varrida', sB.length > 0 && rB1.criados === sB.length, `${sB.length} sinais`);

// ---------------------------------------------------------------- 2. isolamento
const regrasA = sA.map((s) => `${s.rule}:${s.severity}`).sort();
const regrasB = sB.map((s) => `${s.rule}:${s.severity}`).filter((r) => regrasA.includes(r));
checa('empresas com eventos equivalentes geram sinais equivalentes, cada uma o seu', regrasB.length > 0, regrasB.join(', '));
const chavesA = new Set(sA.map((s) => s.dedupe_key));
checa('nenhuma chave da empresa B colide com a da empresa A', sB.every((s) => !chavesA.has(s.dedupe_key)));
checa('toda chave leva a própria empresa', sA.every((s) => s.dedupe_key.startsWith(ORG_A)) && sB.every((s) => s.dedupe_key.startsWith(ORG_B)));
checa('nenhum sinal da empresa A aponta tarefa da B', sA.every((s) => !s.entity_id || !s.entity_id.startsWith('qabeta')));

// ---------------------------------------------------------------- 3. repetição
const rA2 = await varrerEmpresa(ORG_A, logger, { config: shadow });
checa('repetir a varredura não cria sinal novo', rA2.criados === 0 && (await sinais(ORG_A)).length === sA.length, `criados ${rA2.criados}, suprimidos ${rA2.suprimidos}`);

// ---------------------------------------------------------------- 4. entrega
const rA3 = await varrerEmpresa(ORG_A, logger, { config: live });
const rB3 = await varrerEmpresa(ORG_B, logger, { config: live });
const avAna = await avisos(ANA);
const avBruno = await avisos(BRUNO);
const avCarla = await avisos(CARLA);
checa('o que nasceu em shadow e continua valendo é entregue ao ligar', rA3.avisosEnviados > 0, `${rA3.avisosEnviados} aviso(s) A, ${rB3.avisosEnviados} B`);
checa('Ana recebe UM aviso agrupado', avAna.length === 1, avAna.map((a) => a.title).join(' | '));
checa('o aviso da Ana traz a atrasada e a que vence, com o porquê', /Carrossel de lançamento.*venceu há/.test(avAna[0]?.body ?? '') && /Legenda do Reels.*vence amanhã/.test(avAna[0]?.body ?? ''), (avAna[0]?.body ?? '').replace(/\n/g, ' / '));
checa('o aviso da Ana não traz tarefa de outra pessoa', !/Relatório mensal/.test(avAna[0]?.body ?? ''));
checa('Bruno (gestor) recebe a tarefa sem dono que vence logo', /Briefing sem dono.*sem responsável/.test(avBruno[0]?.body ?? ''), (avBruno[0]?.body ?? '').replace(/\n/g, ' / '));
checa('Bruno (gestor) recebe a visão agregada da empresa', /entrega\(s\) prioritária\(s\)/.test(avBruno[0]?.body ?? ''));
// Piso de ruído, por desenho: prioridade baixa atrasada há 1 dia pontua 20
// (< 25) e não avisa ninguém; passa a avisar com 3 dias de atraso.
checa('baixa prioridade atrasada há 1 dia não vira aviso (piso de ruído)', !/Relatório mensal/.test([...avAna, ...avBruno].map((a) => a.body).join('\n')));
checa('Carla recebe só o da empresa B', avCarla.length === 1 && avCarla.every((a) => a.organization_id === ORG_B && !/Alfa|Gama/.test(a.body)));
checa('avisos carimbados com a empresa certa', [...avAna, ...avBruno].every((a) => a.organization_id === ORG_A));
checa('sinais entregues ficam "delivered"', (await sinais(ORG_A)).every((s) => s.status === 'delivered'));

// ---------------------------------------------------------------- 5. sem repetir
await varrerEmpresa(ORG_A, logger, { config: live });
checa('varrer de novo não reenvia (cooldown + delivered)', (await avisos(ANA)).length === 1 && (await avisos(BRUNO)).length === avBruno.length);

// ---------------------------------------------------------------- 6. reprocesso depois de falha
// Simula o worker morrendo entre gravar o aviso e marcar o sinal como entregue.
await db.execute(sql`update proactive_signals set status = 'pending', cooldown_until = now() - interval '1 minute' where organization_id = ${ORG_A}::uuid`);
await varrerEmpresa(ORG_A, logger, { config: live });
checa('reprocesso depois de falha não duplica o aviso (índice único)', (await avisos(ANA)).length === 1, `${(await avisos(ANA)).length} aviso(s)`);

// ---------------------------------------------------------------- 7. concorrência
await db.execute(sql`update proactive_signals set status = 'pending', cooldown_until = now() - interval '1 minute' where organization_id = ${ORG_A}::uuid`);
await db.execute(sql`delete from notifications where user_id in (${ANA}::uuid, ${BRUNO}::uuid)`);
const [c1, c2] = await Promise.all([varrerEmpresa(ORG_A, logger, { config: live }), varrerEmpresa(ORG_A, logger, { config: live })]);
checa('duas varreduras simultâneas: uma roda, a outra respeita a trava', [c1.pulado, c2.pulado].filter((p) => p === 'outra varredura em andamento').length === 1, `${c1.pulado ?? 'rodou'} / ${c2.pulado ?? 'rodou'}`);
checa('e a Ana continua com um aviso só', (await avisos(ANA)).length === 1);

// ---------------------------------------------------------------- 8. resolução
await fetch(`${SIM}/api/v2/task/qaalfa01`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'concluído' }) });
const r8 = await varrerEmpresa(ORG_A, logger, { config: live });
const resolvidos = await rows<{ status: string }>(sql`select status from proactive_signals where organization_id = ${ORG_A}::uuid and entity_id = 'qaalfa01'`);
checa('tarefa concluída: o sinal dela é resolvido sozinho', resolvidos.length > 0 && resolvidos.every((s) => s.status === 'resolved'), `${r8.resolvidos} resolvido(s)`);

// ---------------------------------------------------------------- 9. liberação por empresa
await db.execute(sql`delete from notifications where user_id = ${CARLA}::uuid`);
await db.execute(sql`update proactive_signals set status = 'pending', cooldown_until = now() - interval '1 minute' where organization_id = ${ORG_B}::uuid`);
await varrerEmpresa(ORG_B, logger, { config: { ...live, empresasLiberadas: new Set([ORG_A]) } });
checa('empresa fora da lista de liberação não recebe aviso', (await avisos(CARLA)).length === 0);
await varrerEmpresa(ORG_B, logger, { config: { ...live, empresasLiberadas: new Set([ORG_B]) } });
checa('incluída na lista, recebe', (await avisos(CARLA)).length === 1);

// ---------------------------------------------------------------- 10. briefing da manhã
const briefings = async (u: string) =>
  rows<{ title: string; body: string; organization_id: string }>(sql`select title, body, organization_id from notifications where user_id = ${u}::uuid and type = 'bento_briefing'`);
await db.execute(sql`delete from notifications where type = 'bento_briefing' and user_id in (${ANA}::uuid, ${BRUNO}::uuid, ${CARLA}::uuid)`);
await briefingOperacional(logger, { config: shadow });
checa('briefing em shadow: monta e não envia', (await briefings(ANA)).length === 0);
const relBriefing = await briefingOperacional(logger, { config: live });
const bAna = await briefings(ANA);
const bBruno = await briefings(BRUNO);
const bCarla = await briefings(CARLA);
checa('briefing: Ana recebe o dela', bAna.length === 1 && /Vencem hoje|Próximos dias|atrasadas/i.test(bAna[0]!.body), (bAna[0]?.title ?? '') + ' / ' + (bAna[0]?.body ?? '').replace(/\n/g, ' / '));
checa('briefing: gestão recebe a visão da equipe', bBruno.length === 1 && /Equipe:/.test(bBruno[0]!.body) && /Sem responsável: \d/.test(bBruno[0]!.body), (bBruno[0]?.body ?? '').replace(/\n/g, ' / '));
checa('briefing: a colaboradora não recebe a visão da equipe', !/Equipe:/.test(bAna[0]?.body ?? ''));
checa('briefing: empresa B só com o que é da B', bCarla.every((b) => b.organization_id === ORG_B && !/Alfa|Gama|Ana|Bruno/.test(b.body)), (bCarla[0]?.body ?? '').replace(/\n/g, ' / '));
await briefingOperacional(logger, { config: live });
checa('briefing: rodar de novo no mesmo dia não duplica', (await briefings(ANA)).length === 1 && (await briefings(BRUNO)).length === 1);

const passou = resultados.filter((r) => r.ok).length;
console.log(`\n${passou}/${resultados.length} verificações passaram`);
if (process.env.PROVA_SAIDA) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.PROVA_SAIDA, JSON.stringify({ em: new Date().toISOString(), resultados, relatorios: { rA1, rB1, rA2, rA3, rB3, c1, c2, r8, relBriefing } }, null, 2));
}
process.exit(passou === resultados.length ? 0 : 1);
