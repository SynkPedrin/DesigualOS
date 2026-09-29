/**
 * intelligence-benchmark-context.mts — DESIGUAL INTELLIGENCE BENCHMARK, camada de CONTEXTO.
 *
 * Mede, para cada pergunta do benchmark, o que o pipeline REALMENTE entrega ao
 * LLM antes de qualquer geração: escopo resolvido, se o ClickUp foi consultado,
 * quantas tasks entraram, quantos caracteres. Leitura pura, nenhuma escrita.
 */
import '../src/env.js';
import { isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildOperationalBriefing,
  buildOperationalContext,
  formatBriefingForPrompt,
  resolveOperationalScope,
} from '@desigual-os/context-engine';
import { queryOperationTasks } from '@desigual-os/tool-gateway';

const PERGUNTAS: Array<[string, string]> = [
  ['Q01', 'Me explique tudo que você sabe sobre a Agência Desigual.'],
  ['Q02', 'Quem trabalha aqui e qual é a função de cada pessoa?'],
  ['Q03', 'Quais clientes precisam de atenção hoje?'],
  ['Q04', 'Quais são os maiores riscos operacionais neste momento?'],
  ['Q05', 'O que mudou na agência nos últimos 7 dias?'],
  ['Q06', 'Quais clientes estão com entregas atrasadas?'],
  ['Q07', 'Quais projetos internos parecem abandonados?'],
  ['Q08', 'Quem está sobrecarregado?'],
  ['Q09', 'Quais tarefas dependem do Endrigo?'],
  ['Q10', 'Quais clientes entraram recentemente?'],
  ['Q11', 'Quais clientes saíram recentemente?'],
  ['Q12', 'O que pode dar problema esta semana?'],
  ['Q13', 'Qual é o estado atual do Desigual OS?'],
  ['Q14', 'Qual é o estado do Citável?'],
  ['Q15', 'O que a agência deveria priorizar hoje?'],
  ['Q16', 'O que aconteceu ontem?'],
  ['Q17', 'Quais ações os agentes realizaram recentemente?'],
  ['Q18', 'Quais informações estão inconsistentes no ClickUp?'],
  ['Q19', 'O que está parado há mais tempo?'],
  ['Q20', 'Faça um briefing executivo completo da agência.'],
  ['GOLD', 'Analise todo o ClickUp da agência e me entregue um briefing completo de tudo que você sabe sobre a agência.'],
];

const config = { apiKey: process.env.CLICKUP_API_KEY!, teamId: process.env.CLICKUP_TEAM_ID! };
const clientes = await db
  .select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
  .from(schema.clients)
  .where(isNull(schema.clients.deletedAt));

console.log(`clientes autorizados: ${clientes.length} | com lista: ${clientes.filter(c=>c.clickupListId).length}\n`);
console.log('ID   | escopo      | oper | brief | tasks | ctx chars | brief chars | falha');
console.log('-----+-------------+------+-------+-------+-----------+-------------+------');

const now = new Date();
for (const [id, pergunta] of PERGUNTAS) {
  const scope = await resolveOperationalScope(pergunta, now, null);
  let tasks: any[] = [];
  let ctxChars = 0, briefChars = 0, falha = '';
  if (scope.operational && scope.kind !== 'NONE' && scope.kind !== 'AMBIGUOUS') {
    const ctx = await buildOperationalContext(scope, {
      listAuthorizedClients: async () => clientes,
      queryTasks: async (q) => { const r = await queryOperationTasks(config, q); tasks = r.tasks; return { tasks: r.tasks, truncated: r.truncated }; },
    }, now).catch((e) => { falha = 'THROW ' + (e as Error).message; return null; });
    if (ctx) {
      ctxChars = ctx.block?.length ?? 0;
      falha = ctx.failure ?? '';
      if ((scope as any).briefing && !ctx.failure) {
        const b = buildOperationalBriefing({ tasks: tasks as any, clientNameByListId: new Map(clientes.filter(c=>c.clickupListId).map(c=>[c.clickupListId!, c.name])), now } as any);
        briefChars = formatBriefingForPrompt(b).length;
      }
    }
  }
  console.log(
    `${id.padEnd(4)} | ${String(scope.kind).padEnd(11)} | ${scope.operational ? ' sim' : ' NAO'} | ${(scope as any).briefing ? '  sim' : '  nao'} | ${String(tasks.length).padStart(5)} | ${String(ctxChars).padStart(9)} | ${String(briefChars).padStart(11)} | ${falha.slice(0,40)}`,
  );
}
process.exit(0);
