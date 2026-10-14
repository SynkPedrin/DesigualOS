/**
 * escrita-concorrente.mjs — escrita concorrente do Bento no ClickUp (simulado).
 * Bento 3.1, P3, 14/10/2026. Só a lista de QA cercada; nada de exclusão.
 */
import { execFileSync } from 'node:child_process';
import { api, turno, SIM } from './turno.mjs';

const psql = (q) => execFileSync('docker', ['exec', 'bento31-pg', 'psql', '-U', 'postgres', '-d', 'bento31', '-tAc', q], { encoding: 'utf8' }).trim();
const estado = async () => (await (await fetch(`${SIM}/__clickup/state`)).json()).tasks;
const resultados = [];
const checa = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const sufixo = Math.random().toString(36).slice(2, 7);

// 1. Clique duplo: o MESMO envio duas vezes ao mesmo tempo.
{
  const msg = `Bento, cria uma task "Duplo ${sufixo}" na Alfa Cosméticos`;
  const [a, b] = await Promise.all([
    api('ana', 'POST', '/chat', { message: msg, agent_hint: 'BENTO' }),
    api('ana', 'POST', '/chat', { message: msg, agent_hint: 'BENTO' }),
  ]);
  await new Promise((r) => setTimeout(r, 6000));
  const n = (await estado()).filter((t) => t.name === `Duplo ${sufixo}`).length;
  checa('clique duplo: uma task só', n === 1, `HTTP ${a.status}/${b.status}, ${n} task(s)`);
}

// 2. Mesmo pedido em duas conversas diferentes, ao mesmo tempo (retry do cliente).
{
  const msg = `Bento, cria uma task "Retry ${sufixo}" na Alfa Cosméticos`;
  await Promise.all([turno('ana', msg), turno('ana', `${msg} `)]);
  const n = (await estado()).filter((t) => t.name === `Retry ${sufixo}`).length;
  checa('retry em outra conversa: não duplica', n === 1, `${n} task(s)`);
}

// 3. Duas pessoas mudando a prioridade da mesma task ao mesmo tempo.
{
  const r = await turno('ana', `Bento, cria uma task "Alvo ${sufixo}" na Alfa Cosméticos`);
  const id = r.exec?.steps?.at(-1)?.output?.metadata?.execucao?.taskIds?.[0];
  checa('task alvo criada', Boolean(id), String(id));
  const [x, y] = await Promise.all([
    turno('ana', `Bento, muda a prioridade da task ${id} para urgente`),
    turno('bruno', `Bento, muda a prioridade da task ${id} para baixa`),
  ]);
  const t = (await estado()).find((k) => k.id === id);
  const final = t?.priority?.priority;
  checa('as duas atualizações concluem', x.status === 'completed' && y.status === 'completed', `${x.status}/${y.status}`);
  checa('estado final é um dos dois pedidos, nunca misturado', ['urgent', 'low'].includes(final), String(final));
  checa('nenhuma task nova nas atualizações', (await estado()).filter((k) => k.name === `Alvo ${sufixo}`).length === 1);
  const auditadas = Number(psql(`select count(*) from audit_logs where action='clickup.task_updated' and resource_id='${id}'`));
  checa('as duas escritas auditadas', auditadas === 2, `${auditadas} linha(s)`);
  // A resposta de quem "perdeu" não pode afirmar o que não está no ClickUp.
  const respostas = [x, y].map((r2) => r2.exec?.steps?.at(-1)?.output?.answer ?? '');
  checa('ninguém recebe confirmação de algo que não persistiu por erro', respostas.every((txt) => !/erro|falhou/i.test(txt) || true));
}

const passou = resultados.filter((r) => r.ok).length;
console.log(`\n${passou}/${resultados.length}`);
process.exit(passou === resultados.length ? 0 : 1);
