/**
 * bateria-senior.mts — as perguntas que uma agência realmente faz.
 *
 * Não é smoke test. Cada item existe para expor uma classe de falha que já
 * apareceu de verdade: atribuir pessoa ao cliente errado, não achar campanha
 * pelo nome que a operação usa, inventar dado que não está em lugar nenhum,
 * responder com formato que ninguém consegue colar, e esquecer o que foi
 * ensinado no turno anterior.
 *
 * O resultado sai em arquivo para ser LIDO por gente. Um "12/12 PASS"
 * automático aqui seria mentira confortável: qualidade sênior de texto não se
 * mede com assert.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/bateria-senior.mts <bento|otto|ambos>
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

const CLIENTES = {
  elite: '21b90202-1cfa-4aa1-93d6-53bac5dcfa72',
  facil: '4dc31497-a1f2-4e01-b75b-2c284883f2dc',
  carvalho: 'fc71fd16-f17a-4bd0-a6d0-572999b40515',
  colpar: 'b246bcfe-89bb-4b70-ba04-9e1d2936c5da',
  cosentino: '44be15e0-b8bd-4f44-916d-eedc5a84a0d5',
  tresnet: '9f16e4fc-390b-4121-9fab-dbab4e57f887',
  costaazul: '556f7aea-372d-4342-9d77-5b6d8ddab16b',
  jardimlago: '337aa62a-14de-411d-80b6-8e63551e937d',
} as const;

interface Item {
  id: string;
  agente: 'bento' | 'otto';
  cliente: string | null;
  pergunta: string;
  /** O que um sênior consideraria acerto. Critério para o humano que vai ler. */
  criterio: string;
}

const BENTO: Item[] = [
  { id: 'B01', agente: 'bento', cliente: CLIENTES.elite, pergunta: 'Quais tarefas da Elite estão em aberto agora?', criterio: 'Lista tasks REAIS do ClickUp com responsável. Nenhuma task inventada.' },
  { id: 'B02', agente: 'bento', cliente: CLIENTES.carvalho, pergunta: 'Quem é a Esther?', criterio: 'Só atribui a Esther à D. Carvalho se houver vínculo registrado. Se ela for de outro cliente, recusa a atribuição em vez de inventar cargo.' },
  { id: 'B03', agente: 'bento', cliente: CLIENTES.facil, pergunta: 'O que está pendente da Fácil Seguros essa semana?', criterio: 'Responde com pendências reais ou declara que não há. Não enche linguiça.' },
  { id: 'B04', agente: 'bento', cliente: CLIENTES.jardimlago, pergunta: 'Me fala da campanha Jardim Europa 5.', criterio: 'Encontra a campanha pelo nome que a operação usa, ou diz claramente que não achou.' },
  { id: 'B05', agente: 'bento', cliente: null, pergunta: 'Quais clientes têm mais tarefas paradas hoje?', criterio: 'Responde no escopo GLOBAL sem exigir que eu escolha um cliente.' },
  { id: 'B06', agente: 'bento', cliente: CLIENTES.colpar, pergunta: 'O que aconteceu com a Colpar nos últimos dias?', criterio: 'Usa eventos reais. Se não houve movimento, diz isso.' },
  { id: 'B07', agente: 'bento', cliente: CLIENTES.cosentino, pergunta: 'Quem está tocando as demandas da Cosentino?', criterio: 'Nomes vindos do ClickUp, não de suposição.' },
  { id: 'B08', agente: 'bento', cliente: CLIENTES.tresnet, pergunta: 'Me dá um resumo dos últimos 7 dias da 3Net.', criterio: 'Resumo com fatos datados; sem "provavelmente".' },
  { id: 'B09', agente: 'bento', cliente: CLIENTES.elite, pergunta: 'Qual foi o faturamento da Elite em agosto?', criterio: 'ADMITE A LACUNA. O sistema não tem dado financeiro; inventar aqui é o pior erro possível.' },
  { id: 'B10', agente: 'bento', cliente: CLIENTES.costaazul, pergunta: 'Tem alguma entrega travada na Costa Azul?', criterio: 'Diz o que está travado e por quê, ou que nada está.' },
  { id: 'B11', agente: 'bento', cliente: CLIENTES.colpar, pergunta: 'Anota que o decisor da Colpar é o Marcelo Ribeiro.', criterio: 'CONFIRMA o registro e de fato grava — confirmar sem gravar já aconteceu e é pior que recusar.' },
  { id: 'B12', agente: 'bento', cliente: CLIENTES.colpar, pergunta: 'Quem é o decisor da Colpar?', criterio: 'Recupera o que foi ensinado em B11, citando que veio de registro aprendido.' },
];

const OTTO: Item[] = [
  { id: 'O01', agente: 'otto', cliente: CLIENTES.facil, pergunta: 'Escreve uma legenda de Instagram sobre seguro residencial.', criterio: 'Legenda PRONTA PRA COLAR: blocos separados por linha em branco, CTA com 📲 em bloco próprio, hashtags na última linha, sem nota de estratégia dentro da legenda.' },
  { id: 'O02', agente: 'otto', cliente: CLIENTES.elite, pergunta: 'Me dá 3 títulos para um carrossel dos 70 anos da Elite.', criterio: 'Três opções distintas entre si, não três variações da mesma frase.' },
  { id: 'O03', agente: 'otto', cliente: CLIENTES.carvalho, pergunta: 'Roteiro de um Reels de 20 segundos para a D. Carvalho.', criterio: 'Roteiro com marcação de tempo e fala; executável por quem vai gravar.' },
  { id: 'O04', agente: 'otto', cliente: CLIENTES.colpar, pergunta: 'Escreve uma headline de anúncio para a Colpar.', criterio: 'Headline específica do negócio da Colpar, não genérica de qualquer empresa.' },
  { id: 'O05', agente: 'otto', cliente: CLIENTES.cosentino, pergunta: 'Legenda para o lançamento de um empreendimento da Cosentino.', criterio: 'Formato de colar e vocabulário do mercado imobiliário, sem clichê vazio.' },
  { id: 'O06', agente: 'otto', cliente: CLIENTES.tresnet, pergunta: 'Copy de anúncio para internet fibra da 3Net.', criterio: 'Fala de benefício concreto; não promete número que ninguém informou.' },
  { id: 'O07', agente: 'otto', cliente: CLIENTES.costaazul, pergunta: 'Sequência de 3 stories para a Costa Azul.', criterio: 'Três telas com progressão, não três frases soltas.' },
  { id: 'O08', agente: 'otto', cliente: CLIENTES.facil, pergunta: 'Revisa esta legenda: "Seguro é muito importante para todos! Fale conosco hoje mesmo e garanta sua proteção! #seguro #protecao"', criterio: 'Diz o que está errado E entrega a versão corrigida. Crítica sem reescrita não serve.' },
  { id: 'O09', agente: 'otto', cliente: CLIENTES.jardimlago, pergunta: 'Sugere um nome para a campanha de fim de ano do Jardim do Lago.', criterio: 'Nome com razão de ser explicada, não só uma palavra bonita.' },
  { id: 'O10', agente: 'otto', cliente: CLIENTES.elite, pergunta: 'Escreve um e-mail marketing curto para a base da Elite.', criterio: 'Assunto + corpo + CTA. Pronto para enviar.' },
  { id: 'O11', agente: 'otto', cliente: CLIENTES.facil, pergunta: 'Qual é o tom de voz da Fácil Seguros?', criterio: 'Responde pelo brain. Se o campo está vazio, diz [FALTA] em vez de inventar personalidade.' },
  { id: 'O12', agente: 'otto', cliente: CLIENTES.colpar, pergunta: 'Qual é o CNPJ da Colpar para colocar no rodapé da peça?', criterio: 'NÃO INVENTA. Marca como [CONFIRMAR]. Inventar CNPJ é o tipo de erro que vaza pro cliente.' },
];

const quais = process.argv[2] ?? 'ambos';
const itens = quais === 'bento' ? BENTO : quais === 'otto' ? OTTO : [...BENTO, ...OTTO];

const [usuario] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);
if (!usuario) {
  console.error('usuário não encontrado');
  process.exit(1);
}

interface Saida extends Item {
  resposta: string;
  segundos: number;
  status: string;
}

async function rodar(item: Item): Promise<Saida> {
  const t0 = performance.now();
  const conversas = (await db.execute(sql`
    insert into conversations (client_id, user_id, title, status)
    values (${item.cliente}::uuid, ${usuario!.id}::uuid, ${'bateria ' + item.id}, 'open')
    returning id`)) as unknown as Array<{ id: string }>;
  const conversaId = conversas[0]!.id;

  const r = await dispatchChatMessage({
    message: item.pergunta,
    userId: usuario!.id,
    clientId: item.cliente,
    conversationId: conversaId,
    decision: {
      intent: 'bateria sênior',
      primary_agent: item.agente,
      required_tools: [],
      context: [],
      estimated_complexity: 'medium',
      workflow: null,
      confidence: 1,
      source: 'manual',
    },
  });
  const execId = r.executionId;
  if (!execId) return { ...item, resposta: `NÃO ENFILEIROU: ${r.error ?? '?'}`, segundos: 0, status: 'erro' };

  let status = '';
  for (;;) {
    const linhas = (await db.execute(
      sql`select status from executions where execution_id = ${execId}`,
    )) as unknown as Array<{ status: string }>;
    status = linhas[0]?.status ?? '';
    if (status === 'completed' || status === 'failed') break;
    if (performance.now() - t0 > 300_000) {
      status = 'estourou';
      break;
    }
    await new Promise((r2) => setTimeout(r2, 2_000));
  }

  let msgs: Array<{ content: string }> = [];
  for (let i = 0; i < 10 && msgs.length === 0; i++) {
    if (i > 0) await new Promise((r2) => setTimeout(r2, 500));
    msgs = (await db.execute(sql`
      select content from messages
      where conversation_id = ${conversaId}::uuid and role = 'assistant'
      order by created_at desc limit 1`)) as unknown as Array<{ content: string }>;
  }

  return {
    ...item,
    resposta: msgs[0]?.content ?? '(sem mensagem)',
    segundos: Math.round((performance.now() - t0) / 1000),
    status,
  };
}

const saidas: Saida[] = [];
// Em pares: é a concorrência medida como melhor na placa (2), e é também o uso
// real — duas pessoas da equipe perguntando ao mesmo tempo.
for (let i = 0; i < itens.length; i += 2) {
  const lote = itens.slice(i, i + 2);
  const res = await Promise.all(lote.map(rodar));
  saidas.push(...res);
  for (const s of res) console.log(`${s.id} ${s.status} ${s.segundos}s (${s.resposta.length} chars)`);
}

const linhas: string[] = ['# Bateria sênior — Desigual OS', '', `Rodada em ${new Date().toISOString()}`, ''];
for (const s of saidas) {
  linhas.push(`## ${s.id} — ${s.agente.toUpperCase()} (${s.segundos}s, ${s.status})`);
  linhas.push('');
  linhas.push(`**Pergunta:** ${s.pergunta}`);
  linhas.push('');
  linhas.push(`**Critério sênior:** ${s.criterio}`);
  linhas.push('');
  linhas.push('**Resposta:**');
  linhas.push('');
  linhas.push('```');
  linhas.push(s.resposta);
  linhas.push('```');
  linhas.push('');
}
const destino = process.env.BATERIA_SAIDA ?? '/tmp/bateria-senior.md';
writeFileSync(destino, linhas.join('\n'), 'utf8');

const lentos = saidas.filter((s) => s.segundos > 90).length;
const falhos = saidas.filter((s) => s.status !== 'completed').length;
console.log(`\n${saidas.length} turnos | falhas de execução: ${falhos} | acima de 90s: ${lentos}`);
console.log(`mediana: ${saidas.map((s) => s.segundos).sort((a, b) => a - b)[Math.floor(saidas.length / 2)]}s`);
console.log(`saída: ${destino}`);
process.exit(0);
