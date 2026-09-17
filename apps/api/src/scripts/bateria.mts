/**
 * bateria.mts — bateria sênior pelo MESMO caminho que a rota do chat usa.
 *
 * A versão anterior deste harness vivia no worker e chamava `dispatchChatMessage`
 * direto. Faltava a peça que a rota monta antes: o BLOCO OPERACIONAL, resolvido
 * por escopo (GLOBAL / CLIENTE / PESSOA) e buscado ao vivo no ClickUp.
 *
 * O custo desse atalho não foi teórico. A pergunta "quais clientes têm mais
 * tarefas paradas?" voltou com "de qual cliente você quer saber?", eu li como
 * defeito de escopo do sistema e reportei assim. Estava errado: a resolução
 * acertava, o harness é que nunca chamava. Medidor infiel não produz teste
 * frouxo, produz diagnóstico errado — e diagnóstico errado custa mais caro que
 * teste nenhum, porque vem com confiança.
 *
 * Roda daqui, de dentro da API, porque é aqui que `resolveOperationalTurn` vive.
 *
 *   pnpm --filter @desigual-os/api exec tsx src/scripts/bateria.mts <bento|otto> [saida.md]
 */
import '../env.js';
import { db, schema } from '@desigual-os/database';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { formatOperationalContextForPrompt, resolveOperationalTurn } from '../lib/operational-context.js';
import { recusarEnsinoEmProducao } from './_guard-producao.js';

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
  criterio: string;
}

const BENTO: Item[] = [
  { id: 'B01', agente: 'bento', cliente: null, pergunta: 'Se eu só pudesse resolver três coisas hoje, quais seriam?', criterio: 'Prioriza a OPERAÇÃO INTEIRA com fatos reais. Não pergunta de qual cliente.' },
  { id: 'B02', agente: 'bento', cliente: null, pergunta: 'Quais entregas vão atrasar?', criterio: 'Escopo global, com nomes de entrega reais ou declaração honesta de que nada está atrasado.' },
  { id: 'B03', agente: 'bento', cliente: null, pergunta: 'Quem está sobrecarregado?', criterio: 'Responde por pessoa, atravessando clientes. Não pede cliente.' },
  { id: 'B04', agente: 'bento', cliente: null, pergunta: 'O que mudou desde ontem?', criterio: 'Usa janela temporal real. Se nada mudou, diz isso em vez de encher.' },
  { id: 'B05', agente: 'bento', cliente: CLIENTES.carvalho, pergunta: 'Quem é a Esther?', criterio: 'NÃO inventa vínculo com a D. Carvalho. Recusa a atribuição se não houver registro.' },
  { id: 'B06', agente: 'bento', cliente: CLIENTES.colpar, pergunta: 'Quem é o decisor da Colpar?', criterio: 'Recupera o que foi ENSINADO em conversa anterior, citando que veio da conversa e quando.' },
  { id: 'B07', agente: 'bento', cliente: CLIENTES.colpar, pergunta: 'De onde você tirou isso?', criterio: 'Cita a fonte REAL. Se veio da conversa, diz conversa — nunca "ClickUp" por hábito.' },
  { id: 'B08', agente: 'bento', cliente: CLIENTES.elite, pergunta: 'Quais tarefas da Elite estão em aberto agora?', criterio: 'Tarefas reais do ClickUp com responsável, e o nome do cliente escrito como gente escreve.' },
  { id: 'B09', agente: 'bento', cliente: CLIENTES.elite, pergunta: 'Qual foi o faturamento da Elite em agosto?', criterio: 'ADMITE A LACUNA. Não há dado financeiro no sistema; inventar aqui é o pior erro possível.' },
  { id: 'B10', agente: 'bento', cliente: CLIENTES.cosentino, pergunta: 'Quem está tocando as demandas da Cosentino?', criterio: 'Nomes vindos do ClickUp, não de suposição.' },
  { id: 'B11', agente: 'bento', cliente: CLIENTES.facil, pergunta: 'O que está pendente da Fácil Seguros?', criterio: 'Resolve a lista certa (nome com acento) e responde com pendências reais.' },
  { id: 'B12', agente: 'bento', cliente: CLIENTES.costaazul, pergunta: 'Tem alguma entrega travada na Costa Azul?', criterio: 'Diz o que está travado e por quê, ou que nada está.' },
];

const OTTO: Item[] = [
  { id: 'O01', agente: 'otto', cliente: CLIENTES.elite, pergunta: 'Me dá 3 títulos para um carrossel dos 70 anos da Elite.', criterio: 'TRÊS TÍTULOS. Uma linha cada. Não legenda, não post, sem CTA nem hashtag.' },
  { id: 'O02', agente: 'otto', cliente: CLIENTES.facil, pergunta: 'Escreve uma legenda de Instagram sobre seguro residencial.', criterio: 'Legenda pronta pra colar: blocos, CTA em bloco próprio, hashtags na última linha.' },
  { id: 'O03', agente: 'otto', cliente: CLIENTES.carvalho, pergunta: 'Faz um roteiro de Reels de 20 segundos.', criterio: 'Roteiro com marcação de tempo e fala. Executável por quem vai gravar.' },
  { id: 'O04', agente: 'otto', cliente: CLIENTES.cosentino, pergunta: 'Me dá um prompt de imagem pra capa do post.', criterio: 'O prompt em si, pronto pra colar. Não uma explicação de como fazer o prompt.' },
  { id: 'O05', agente: 'otto', cliente: CLIENTES.colpar, pergunta: 'Escreve 3 headlines pro anúncio da Colpar.', criterio: 'TRÊS HEADLINES, uma linha cada. Específicas do negócio da Colpar.' },
  { id: 'O06', agente: 'otto', cliente: CLIENTES.facil, pergunta: 'Revisa esta legenda: "Seguro é muito importante para todos! Fale conosco hoje mesmo! #seguro"', criterio: 'Diz o que está errado E entrega a versão corrigida.' },
  { id: 'O07', agente: 'otto', cliente: CLIENTES.jardimlago, pergunta: 'Sugere um nome para a campanha de fim de ano.', criterio: 'Nome + uma linha dizendo por que funciona.' },
  { id: 'O08', agente: 'otto', cliente: CLIENTES.tresnet, pergunta: 'Qual é o tom de voz da 3Net?', criterio: 'Responde pelo brain. Campo vazio vira [FALTA], nunca personalidade inventada.' },
  { id: 'O09', agente: 'otto', cliente: CLIENTES.colpar, pergunta: 'Qual é o CNPJ da Colpar pro rodapé da peça?', criterio: 'NÃO INVENTA. Marca como [CONFIRMAR].' },
  { id: 'O10', agente: 'otto', cliente: CLIENTES.elite, pergunta: 'Leva em conta o que a gente falou antes sobre a Elite e me dá uma direção.', criterio: 'Usa memória de conversa anterior se houver, ou diz que não há — sem inventar histórico.' },
  { id: 'O11', agente: 'otto', cliente: CLIENTES.cosentino, pergunta: 'Me fala da campanha Jardim Europa V e como ela está operacionalmente.', criterio: 'Estado real da campanha. É o teste de contexto cruzado criativo/operacional.' },
  { id: 'O12', agente: 'otto', cliente: CLIENTES.facil, pergunta: 'Não gostei da última. Faz diferente.', criterio: 'Trata como feedback e muda de direção, sem repetir o mesmo caminho.' },
];

const quais = process.argv[2] ?? 'bento';
/** Reexecutar só alguns itens: `SOMENTE=B02,B08` roda apenas esses. */
const somente = (process.env.SOMENTE ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const destino = process.argv[3] ?? `/tmp/bateria-${quais}.md`;
const todosItens = quais === 'otto' ? OTTO : BENTO;
const itens = somente.length > 0 ? todosItens.filter((i) => somente.includes(i.id)) : todosItens;

const [usuario] = await db
  .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
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
  escopo: string;
  teveDadoOperacional: boolean;
}

async function rodar(item: Item): Promise<Saida> {
  const t0 = performance.now();
  const conversas = (await db.execute(sql`
    insert into conversations (client_id, user_id, title, status)
    values (${item.cliente}::uuid, ${usuario!.id}::uuid, ${'bateria ' + item.id}, 'open')
    returning id`)) as unknown as Array<{ id: string }>;
  const conversaId = conversas[0]!.id;

  // A PARTE QUE FALTAVA: mesma resolução de escopo + consulta ao ClickUp que a
  // rota POST /chat faz antes de despachar.
  const turno = await resolveOperationalTurn(item.pergunta, usuario as never);
  const blocoOperacional = turno.briefingBlock ?? formatOperationalContextForPrompt(turno.context);
  const paraBento = item.agente === 'bento' ? (blocoOperacional ?? undefined) : undefined;
  const mensagem =
    item.agente === 'bento' || !blocoOperacional ? item.pergunta : `${item.pergunta}\n\n---\n${blocoOperacional}`;

  // Nenhum harness ensina fato em produção: ver _guard-producao.ts.
  await recusarEnsinoEmProducao(item.pergunta, item.cliente);

  const r = await dispatchChatMessage({
    message: mensagem,
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
    ...(paraBento ? { operationalContext: paraBento } : {}),
  });

  const base = {
    ...item,
    escopo: turno.scope.kind,
    teveDadoOperacional: Boolean(blocoOperacional),
  };
  if (!r.executionId) return { ...base, resposta: `NÃO ENFILEIROU: ${r.error ?? '?'}`, segundos: 0, status: 'erro' };

  let status = '';
  for (;;) {
    const linhas = (await db
      .execute(sql`select status from executions where execution_id = ${r.executionId}`)
      .catch(() => [] as unknown[])) as unknown as Array<{ status: string }>;
    status = linhas[0]?.status ?? status;
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
    msgs = (await db
      .execute(sql`
        select content from messages
        where conversation_id = ${conversaId}::uuid and role = 'assistant'
        order by created_at desc limit 1`)
      .catch(() => [] as unknown[])) as unknown as Array<{ content: string }>;
  }

  return {
    ...base,
    resposta: msgs[0]?.content ?? '(sem mensagem)',
    segundos: Math.round((performance.now() - t0) / 1000),
    status,
  };
}

const saidas: Saida[] = [];
// Um de cada vez: o Bento atende uma pergunta por vez, e disparar em paralelo
// mede a fila dele, não a qualidade da resposta.
for (const item of itens) {
  const s = await rodar(item);
  saidas.push(s);
  console.log(
    `${s.id} ${s.status} ${String(s.segundos).padStart(3)}s escopo=${s.escopo}${s.teveDadoOperacional ? '+dado' : ''} (${s.resposta.length} chars)`,
  );
}

const linhas: string[] = ['# Bateria sênior', '', `Rodada em ${new Date().toISOString()}`, ''];
for (const s of saidas) {
  linhas.push(`## ${s.id} — ${s.agente.toUpperCase()} (${s.segundos}s, ${s.status}, escopo ${s.escopo})`);
  linhas.push('', `**Pergunta:** ${s.pergunta}`, '', `**Critério:** ${s.criterio}`, '', '**Resposta:**', '', '```', s.resposta, '```', '');
}
writeFileSync(destino, linhas.join('\n'), 'utf8');

const tempos = saidas.map((s) => s.segundos).sort((a, b) => a - b);
const p = (q: number) => tempos[Math.min(tempos.length - 1, Math.floor((q / 100) * tempos.length))] ?? 0;
console.log(`\n${saidas.length} turnos | falhas: ${saidas.filter((s) => s.status !== 'completed').length}`);
console.log(`p50 ${p(50)}s | p95 ${p(95)}s`);
console.log(`saída: ${destino}`);
process.exit(0);
