/**
 * golden.mjs — cenários de ouro do Bento, de ponta a ponta, no ambiente isolado.
 * Bento 3.1, 14/10/2026.
 *
 *   node apps/worker/scripts/isolado/golden.mjs [--rotulo loop|direto]
 *
 * Pré-requisito: simuladores + API + worker no ar com ambiente.mjs, fixtures
 * semeadas (semear.mts). Cada cenário passa pelo caminho real: POST /chat →
 * fila → worker → contexto → GPT simulado → resposta gravada.
 *
 * O GPT é simulado, então o teste NÃO julga a qualidade do texto. Ele julga o
 * que o pipeline controla e o modelo não: quem o sistema acha que pergunta,
 * quais dados chegaram ao modelo (e quais não podiam chegar), o que foi
 * escrito no ClickUp, se houve releitura, o que ficou registrado no banco.
 * O que depende do modelo de verdade (não inventar diante da lacuna) fica na
 * amostra com GPT real, separada.
 */
import { execFileSync } from 'node:child_process';
import { turno, api, SIM } from './turno.mjs';

const rotulo = process.argv.includes('--rotulo') ? process.argv[process.argv.indexOf('--rotulo') + 1] : 'sem-rotulo';
const resultados = [];

async function logDesde(servico, desde) {
  return (await fetch(`${SIM}/__log?servico=${servico}&desde=${desde}`)).json();
}
function psql(sql) {
  return execFileSync('docker', ['exec', 'bento31-pg', 'psql', '-U', 'postgres', '-d', 'bento31', '-tAc', sql], { encoding: 'utf8' }).trim();
}
/**
 * Só as chamadas de leitura DESTE turno. O log por janela de tempo também pega
 * trabalho de fundo de outro cenário (a leitura sênior de uma task criada
 * antes roda depois, sozinha), então a chamada é casada pela própria pergunta.
 */
const leituraDe = (r) =>
  r.llm
    .filter((e) => e.chamada === 'leitura' && (e.input ?? '').includes(`PERGUNTA:\n${r.mensagem}`))
    .map((e) => e.input)
    .join('\n');
const contextoDe = (r) => {
  const t = leituraDe(r);
  return t.slice(t.lastIndexOf('PERGUNTA:'));
};
const respostaDe = (r) => (r.exec?.steps ?? []).map((s) => s.output?.answer ?? '').join('\n');

async function cenario(nome, fn) {
  const verificacoes = [];
  const checa = (descricao, ok, detalhe = '') => verificacoes.push({ descricao, ok: Boolean(ok), detalhe });
  const inicio = Date.now();
  try {
    await fn(checa);
  } catch (error) {
    checa('cenário rodou sem exceção', false, String(error?.stack ?? error).slice(0, 400));
  }
  const ok = verificacoes.length > 0 && verificacoes.every((v) => v.ok);
  resultados.push({ nome, ok, ms: Date.now() - inicio, verificacoes });
  console.log(`${ok ? 'PASSA' : 'FALHA'}  ${nome}  (${Date.now() - inicio} ms)`);
  for (const v of verificacoes) if (!v.ok || process.env.VERBOSO) console.log(`   ${v.ok ? '✓' : '✗'} ${v.descricao}${v.detalhe ? ` — ${v.detalhe}` : ''}`);
}

// ------------------------------------------------------------------ 1
await cenario('G1 minhas tarefas atrasadas (Ana, org A)', async (checa) => {
  const r = await turno('ana', 'Quais são minhas tarefas atrasadas?');
  const ctx = contextoDe(r);
  checa('execução concluída', r.status === 'completed', r.status);
  checa('identidade: Ana é quem pergunta', /QUEM ESTÁ PERGUNTANDO: Ana QA/.test(ctx) || /QUEM ESTÁ FALANDO COM VOCÊ: Ana QA/.test(ctx));
  checa('tarefa atrasada da Ana chegou ao modelo, com responsável', /Carrossel de lançamento.*resp: Ana QA.*ATRASADA/.test(ctx));
  checa('tarefa concluída não conta como atrasada', !/Peça concluída/.test(ctx));
  checa('nada da organização B', !/Beta|Carla/.test(ctx));
  checa('fonte é o ClickUp ao vivo', /DADOS AO VIVO DO CLICKUP/.test(ctx));
});

// ------------------------------------------------------------------ 2
await cenario('G2 quem é responsável por uma tarefa (Bruno)', async (checa) => {
  const r = await turno('bruno', 'Quem é o responsável pela tarefa "Alfa - Legenda do Reels"?');
  const ctx = contextoDe(r);
  checa('execução concluída', r.status === 'completed', r.status);
  checa('a tarefa certa chegou com o responsável real', /Legenda do Reels.*resp: Ana QA/.test(ctx), ctx.match(/.*Legenda do Reels.*/)?.[0] ?? 'linha ausente');
  checa('nenhuma escrita no ClickUp numa pergunta', (await logDesde('clickup', Date.now() - r.ms - 50)).every((e) => e.method === 'GET'));
});

// ------------------------------------------------------------------ 3 e 4
let idCriada = null;
await cenario('G3 cria tarefa de teste (lista de QA) com releitura', async (checa) => {
  const antes = Date.now();
  const r = await turno('ana', 'Bento, cria uma task "Golden 3.1 criada" na Alfa Cosméticos');
  const cu = await logDesde('clickup', antes);
  const posts = cu.filter((e) => e.method === 'POST' && /\/list\/.+\/task$/.test(e.path));
  idCriada = r.exec?.steps?.at(-1)?.output?.metadata?.execucao?.taskIds?.[0] ?? null;
  checa('execução concluída', r.status === 'completed', r.status);
  checa('exatamente uma criação', posts.length === 1, `${posts.length} POST`);
  checa('criou só na lista de QA', posts.every((p) => p.path.includes('/list/list-qa-alfa/')));
  checa('id devolvido', Boolean(idCriada), String(idCriada));
  checa('releitura depois de escrever (GET da task criada)', cu.some((e) => e.method === 'GET' && e.path.endsWith(`/task/${idCriada}`)));
  const estado = await (await fetch(`${SIM}/__clickup/state`)).json();
  checa('persistida no ClickUp', estado.tasks.some((t) => t.id === idCriada && t.name === 'Golden 3.1 criada'));
  checa('resposta cita a task criada', respostaDe(r).includes(idCriada ?? '∅'));
  checa('auditoria gravada (actor e empresa)', psql(`select count(*) from audit_logs where action='clickup.task_created' and resource_id='${idCriada}' and source='agent' and user_id is not null and organization_id is not null`) === '1');
});

await cenario('G4 atualiza prioridade sem duplicar', async (checa) => {
  if (!idCriada) return checa('depende do G3', false, 'sem id criado');
  const antes = Date.now();
  const estadoAntes = await (await fetch(`${SIM}/__clickup/state`)).json();
  const r = await turno('ana', `Bento, muda a prioridade da task ${idCriada} para urgente`);
  const cu = await logDesde('clickup', antes);
  const estado = await (await fetch(`${SIM}/__clickup/state`)).json();
  const t = estado.tasks.find((x) => x.id === idCriada);
  checa('execução concluída', r.status === 'completed', r.status);
  checa('PUT na task certa', cu.some((e) => e.method === 'PUT' && e.path.endsWith(`/task/${idCriada}`)));
  checa('prioridade persistida como urgente', t?.priority?.priority === 'urgent', JSON.stringify(t?.priority));
  checa('nenhuma task nova criada', estado.tasks.length === estadoAntes.tasks.length);
  checa('releitura depois de atualizar', cu.filter((e) => e.method === 'GET' && e.path.endsWith(`/task/${idCriada}`)).length >= 1);
});

// ------------------------------------------------------------------ 5
await cenario('G5 "anota" grava no cliente certo e volta no turno seguinte', async (checa) => {
  const r = await turno('bruno', 'Anota que a Alfa Cosméticos prefere briefings objetivos, em tópicos curtos.');
  checa('execução concluída', r.status === 'completed', r.status);
  const linha = psql(
    `select o.slug||'|'||c.name||'|'||m.status from memories m join clients c on c.id=m.client_id left join organizations o on o.id=m.organization_id where m.content ilike '%briefings objetivos%' order by m.created_at desc limit 1`,
  );
  checa('registrado no cliente Alfa, na organização A', /^qa-agencia\|Alfa Cosméticos\|active$/.test(linha), linha || 'nenhuma linha');
  const r2 = await turno('ana', 'Como prefere receber briefing a Alfa Cosméticos?');
  checa('recuperado no turno seguinte (outra pessoa da mesma empresa)', /briefings objetivos/.test(contextoDe(r2)));
  const r3 = await turno('carla', 'Como prefere receber briefing a Alfa Cosméticos?');
  checa('não chega à organização B', !/briefings objetivos/.test(leituraDe(r3)));
});

// ------------------------------------------------------------------ 6
await cenario('G6 pergunta sem dado disponível: o pipeline não fabrica', async (checa) => {
  const r = await turno('ana', 'Qual é o orçamento de mídia da Gama Engenharia para 2027?');
  const ctx = contextoDe(r);
  checa('execução concluída', r.status === 'completed', r.status);
  // "R$ 0,00" aparece na própria regra do prompt ("nunca escreva R$ 0,00").
  checa('nenhum valor monetário chegou ao modelo', !/R\$\s?(?!0,00)\d/.test(ctx));
  checa('o modelo recebe a regra de ausência de dado', /AUSÊNCIA DE DADO NÃO É ZERO/.test(ctx));
});

// ------------------------------------------------------------------ 7, 8, 9 — fronteira de empresa
await cenario('G7 cliente de outra empresa citado no texto não entra', async (checa) => {
  const r = await turno('ana', 'Me fala da Beta Imóveis');
  const ctx = contextoDe(r);
  checa('dossiê do tenant B fora do turno', !/SEGREDO-DO-TENANT-B/.test(leituraDe(r)));
  checa('cliente do turno não é o Beta', !/CLIENTE DO TURNO: Beta/.test(ctx));
  checa('carga da Carla fora do turno', !/Carla/.test(ctx));
  const org = psql(`select o.slug from executions e join organizations o on o.id=e.organization_id where e.id=(select id from executions order by created_at desc limit 1)`);
  checa('execução gravada na organização da Ana', org === 'qa-agencia', org);
});

await cenario('G8 client_id explícito de outra empresa é recusado', async (checa) => {
  const r = await api('ana', 'POST', '/chat', { message: 'como está?', agent_hint: 'BENTO', client_id: '0b000000-0000-4000-8000-00000000c0b1' });
  checa('404, sem execução', r.status === 404, `HTTP ${r.status}`);
});

await cenario('G9 Carla (org B) vê só a própria operação', async (checa) => {
  const r = await turno('carla', 'Quais são minhas tarefas atrasadas?');
  const ctx = contextoDe(r);
  checa('execução concluída', r.status === 'completed', r.status);
  checa('vê a tarefa atrasada dela', /Beta - Carrossel de lançamento.*resp: Carla QA/.test(ctx));
  checa('nada da organização A', !/Alfa|Gama|Ana QA|Bruno QA/.test(ctx));
});

// ------------------------------------------------------------------ 10-14 — colaboradores (P1)
const memoria = (cond) => psql(`select coalesce(string_agg(metadata->>'subject' || '|' || (metadata->>'classe'), ',' order by created_at), '') from memories where kind='collaborator.profile' and ${cond}`);
psql(`update memories set status='superseded' where kind='collaborator.profile' and status='active'`);

await cenario('G10 preferência própria grava, volta para a pessoa, e a equipe vê rotulada', async (checa) => {
  const r = await turno('ana', 'Bento, quando eu receber um briefing de Reels, preciso do objetivo, público, referências e CTA.');
  checa('execução concluída', r.status === 'completed', r.status);
  checa('resposta confirma o registro como preferência dela', /Anotado como preferência sua/.test(respostaDe(r)), respostaDe(r).slice(0, 160));
  checa('gravada como CONFIRMED_PREFERENCE da Ana', memoria(`status='active' and user_id='0a000000-0000-4000-8000-0000000000a1'`).includes('colaborador:0a000000-0000-4000-8000-0000000000a1:briefing|CONFIRMED_PREFERENCE'));
  const r2 = await turno('ana', 'Monta pra mim a lista do que falta no briefing do Reels da Alfa Cosméticos');
  checa('volta no contexto da Ana como preferência dela', /COMO QUEM PERGUNTA PREFERE TRABALHAR[\s\S]*objetivo, público, referências e CTA/.test(contextoDe(r2)));
  const r3 = await turno('bruno', 'Como a Ana prefere receber briefing?');
  checa('o gestor vê, rotulada como confirmada pela própria pessoa', /objetivo, público, referências e CTA \[confirmado pela própria pessoa/.test(contextoDe(r3)));
});

await cenario('G11 gestão registra responsabilidade (FACT)', async (checa) => {
  const r = await turno('bruno', 'Anota que a Ana é responsável pelos carrosséis da Alfa Cosméticos');
  checa('execução concluída', r.status === 'completed', r.status);
  checa('FACT no perfil oficial da Ana', memoria(`status='active'`).includes('colaborador:0a000000-0000-4000-8000-0000000000a1:responsabilidade|FACT'));
});

await cenario('G12 colega falando de outro não reescreve o perfil', async (checa) => {
  await turno('bruno', 'Anota que eu prefiro receber briefing em tópicos curtos');
  await turno('ana', 'Anota que o Bruno prefere briefing em áudio');
  const ativas = memoria(`status='active' and user_id='0a000000-0000-4000-8000-0000000000b2'`);
  checa('a preferência do próprio Bruno continua de pé', ativas.includes('colaborador:0a000000-0000-4000-8000-0000000000b2:briefing|CONFIRMED_PREFERENCE'), ativas);
  checa('o que a Ana disse fica à parte, como INFERENCE', ativas.includes('colaborador:0a000000-0000-4000-8000-0000000000b2:briefing:por:0a000000-0000-4000-8000-0000000000a1|INFERENCE'), ativas);
  const r = await turno('ana', 'Como o Bruno prefere receber briefing?');
  checa('no contexto, a versão da Ana aparece como NÃO confirmada', /briefing em áudio \[NÃO confirmado; informado por Ana QA/.test(contextoDe(r)));
});

await cenario('G13 outra empresa não grava no cliente da A', async (checa) => {
  const antes = psql(`select count(*) from memories where client_id='0a000000-0000-4000-8000-00000000c0a1' and status='active'`);
  await turno('carla', 'Anota que a Alfa Cosméticos prefere briefings longos e detalhados.');
  const depois = psql(`select count(*) from memories where client_id='0a000000-0000-4000-8000-00000000c0a1' and status='active'`);
  checa('nenhuma memória nova no cliente da empresa A', antes === depois, `${antes} → ${depois}`);
});

await cenario('G14 pessoa de outra empresa não é alvo', async (checa) => {
  await turno('carla', 'Anota que a Ana prefere receber tudo por áudio');
  checa('nada gravado sobre a Ana vindo da Carla', !memoria(`user_id='0a000000-0000-4000-8000-0000000000a1'`).includes(':por:0b000000'));
  const r = await turno('carla', 'Como a Ana prefere receber briefing?');
  checa('a Carla não vê o perfil de quem é da empresa A', !/objetivo, público, referências e CTA/.test(leituraDe(r)));
});

const passou = resultados.filter((r) => r.ok).length;
console.log(`\n[${rotulo}] ${passou}/${resultados.length} cenários passaram`);
if (process.env.GOLDEN_SAIDA) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.GOLDEN_SAIDA, JSON.stringify({ rotulo, em: new Date().toISOString(), resultados }, null, 2));
}
process.exit(passou === resultados.length ? 0 : 1);
