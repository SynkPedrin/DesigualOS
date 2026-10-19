/**
 * amostra-gpt-real.mjs — amostra PEQUENA com o GPT de verdade (Bento 3.1, P3).
 *
 * Autorizada como "amostra funcional pequena", sem estresse pago. O resto
 * continua isolado: banco local, ClickUp simulado. Mede latência, chamadas
 * por turno, tokens e custo (do ai_usage_ledger) e guarda as respostas para
 * leitura humana — é o único teste que julga o TEXTO do modelo.
 *
 * Subir o worker com: ISOLADO_OPENAI_API_KEY=<chave> ISOLADO_OPENAI_BASE_URL= bash subir.sh
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { turno } from './turno.mjs';

const psql = (q) => execFileSync('docker', ['exec', 'bento31-pg', 'psql', '-U', 'postgres', '-d', 'bento31', '-tAc', q], { encoding: 'utf8' }).trim();
const CASOS = [
  ['ana', 'Quais são minhas tarefas atrasadas?'],
  ['bruno', 'Quem é o responsável pela tarefa "Alfa - Legenda do Reels"?'],
  ['ana', 'Qual é o orçamento de mídia da Gama Engenharia para 2027?'],
  ['ana', 'Me fala da Alfa Cosméticos'],
  ['carla', 'Me fala da Alfa Cosméticos'],
  ['bruno', 'Quem é você?'],
];
const saida = [];
for (const [quem, msg] of CASOS) {
  const r = await turno(quem, msg, { timeoutMs: 240_000 });
  const exec = r.exec ?? {};
  const passo = (exec.steps ?? []).at(-1)?.output ?? {};
  const id = r.execucao;
  const ledger = psql(`select count(*)||'|'||coalesce(sum(input_tokens),0)||'|'||coalesce(sum(output_tokens),0)||'|'||coalesce(sum(cost_usd),0) from ai_usage_ledger where metadata->>'execution_id'='${id}'`).split('|');
  const item = {
    quem, msg, status: r.status, ms: r.ms,
    camada: passo.metadata?.bento_cascade_tier, tempos: passo.metadata?.bento_tempos,
    chamadas_gpt: Number(ledger[0]), tokens_in: Number(ledger[1]), tokens_out: Number(ledger[2]), custo_usd: Number(ledger[3]),
    resposta: passo.answer,
  };
  saida.push(item);
  console.log(`\n### ${quem}: ${msg}\n${item.status} ${item.ms}ms camada=${item.camada} chamadas=${item.chamadas_gpt} in=${item.tokens_in} out=${item.tokens_out} US$${item.custo_usd.toFixed(4)} tempos=${JSON.stringify(item.tempos)}\n${(item.resposta ?? '').slice(0, 700)}`);
}
if (process.env.AMOSTRA_SAIDA) writeFileSync(process.env.AMOSTRA_SAIDA, JSON.stringify(saida, null, 2));
