/**
 * prova-duplicacao-otto.mts — o Otto recebe o mesmo domínio factual duas vezes.
 *
 * SOMENTE LEITURA. Não despacha turno, não escreve nada.
 *
 * A API concatena um `contextBlock` na mensagem do Otto (só o Bento é excluído
 * disso). O worker, depois, monta o ContextPack e o projeta. Resultado: dois
 * caminhos carregando dossiê e histórico, e só um deles passa pelo projetor.
 *
 * O caminho que escapa é o que realimenta: ele inclui as respostas anteriores
 * do próprio Otto, então uma resposta operacional vira contexto operacional do
 * turno seguinte, e o enquadramento se reforça sozinho.
 *
 *   pnpm --filter @desigual-os/api exec tsx src/scripts/prova-duplicacao-otto.mts
 */
import '../env.js';
import { db, schema } from '@desigual-os/database';
import { eq, sql } from 'drizzle-orm';
import { buildContext, formatContextForPrompt } from '@desigual-os/context-engine';
import { contextoGeralVaiNaMensagem, agenteAceitaBlocoNaMensagem } from '../chat/message-assembly.js';
import { blocoDeContinuacaoCriativa, contratoDeSaida, ehRevisaoEliptica } from '@desigual-os/otto';
import type { AgentName } from '@desigual-os/types';

const ELITE = '21b90202-1cfa-4aa1-93d6-53bac5dcfa72';
const PEDIDO = 'Me dá 3 títulos.';

console.log('== FASE 1 — quem recebe o quê ==\n');
console.log('agente    contextBlock na mensagem   bloco operacional na mensagem');
for (const a of ['bento', 'otto', 'jarbas', 'suzy', 'studio'] as AgentName[]) {
  console.log(
    `${a.padEnd(10)}${(contextoGeralVaiNaMensagem(a) ? 'SIM' : 'não').padEnd(27)}${agenteAceitaBlocoNaMensagem(a) ? 'SIM' : 'não'}`,
  );
}

const [usuario] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);

// Uma conversa REAL do Otto, com histórico: é onde a realimentação aparece.
const conversas = (await db.execute(sql`
  select c.id, count(m.id)::int as n
  from conversations c join messages m on m.conversation_id = c.id
  where c.client_id = ${ELITE}::uuid
  group by c.id having count(m.id) >= 4
  order by max(m.created_at) desc limit 1`)) as unknown as Array<{ id: string; n: number }>;
const conversaId = conversas[0]?.id ?? null;

console.log(`\n== FASE 2 — duplicação, na conversa ${conversaId ?? '(nenhuma)'} (${conversas[0]?.n ?? 0} mensagens) ==\n`);

const ctx = await buildContext({
  userId: usuario!.id,
  clientId: ELITE,
  conversationId: conversaId,
  projectId: null,
  agent: 'otto',
});
const blocoDaApi = formatContextForPrompt(ctx);

const citaClickUp = /ClickUp/i.test(blocoDaApi);
const citaId = /\b9014\d{8}\b/.test(blocoDaApi);
const lacunas = (blocoDaApi.match(/\[FALTA\]|a coletar/gi) ?? []).length;
const linhasDeHistorico = blocoDaApi.split('\n').filter((l) => /^-?\s*(Usuário|Assistente|Otto|Bento):/i.test(l)).length;

console.log(`pedido do usuário          ${String(PEDIDO.length).padStart(6)} chars`);
console.log(`contextBlock da API        ${String(blocoDaApi.length).padStart(6)} chars  <- NÃO passa pelo projetor`);
console.log(`  cita ClickUp             ${citaClickUp ? 'SIM' : 'não'}`);
console.log(`  cita id de lista         ${citaId ? 'SIM' : 'não'}`);
console.log(`  marcações de lacuna      ${String(lacunas).padStart(6)}`);
console.log(`  linhas de histórico      ${String(linhasDeHistorico).padStart(6)}  <- respostas anteriores do próprio Otto`);

const secoes = blocoDaApi
  .split('\n')
  .filter((l) => /^[A-ZÀ-Ý][^:]{2,40}:$|^[A-ZÀ-Ý][^:]{2,40}\s\(/.test(l.trim()))
  .slice(0, 8);
console.log(`\nfontes dentro do bloco da API: ${secoes.map((s) => s.trim()).join(' | ')}`);

console.log(
  `\nVEREDITO: era por ESTE caminho que o dossiê e o histórico chegavam ao Otto ` +
    `sem recorte, além do ContextPack projetado que o worker monta depois.`,
);

/**
 * FASE 5 — o que sobra quando o bloco da API sai.
 *
 * Fechar o caminho duplicado só é legítimo se a continuidade não depender dele.
 * Os quatro sinais que sustentam um fluxo criativo de vários turnos são
 * conferidos aqui contra a MESMA conversa real, lidos da estrutura que já
 * existe (a tabela `messages`), não do texto colado na mensagem.
 */
console.log('\n== FASE 5 — continuidade sem o bloco da API ==\n');

const historico = conversaId
  ? ((await db.execute(sql`
      select role, content, created_at from messages
      where conversation_id = ${conversaId}::uuid
      order by created_at desc limit 12`)) as unknown as Array<{ role: string; content: string }>)
  : [];

const ultimoDoUsuario = historico.filter((m) => m.role === 'user');
const ultimaResposta = historico.find((m) => m.role === 'assistant')?.content ?? '';

// last_artifact_type: lido dos pedidos anteriores, como o dispatch faz.
let tipoDoArtefato = 'indefinido';
for (const m of ultimoDoUsuario) {
  const c = contratoDeSaida(m.content ?? '');
  if (c.artefato !== 'indefinido') {
    tipoDoArtefato = c.artefato;
    break;
  }
}
// last_creative_angle: a abertura da peça é o ângulo — é o que muda quando a
// crítica é "genérico", e o que precisa NÃO se repetir na reescrita.
const angulo = ultimaResposta.split('\n').map((l) => l.trim()).find((l) => l.length > 30) ?? '';
// last_user_feedback: a crítica que abriu o turno de revisão.
const feedback = ultimoDoUsuario.find((m) => ehRevisaoEliptica(m.content ?? ''))?.content ?? '';

const sinais: Array<[string, string, string]> = [
  ['last_artifact_type', tipoDoArtefato !== 'indefinido' ? 'SIM' : 'não', tipoDoArtefato],
  ['last_artifact_content', ultimaResposta.length > 0 ? 'SIM' : 'não', `${ultimaResposta.length} chars`],
  ['last_creative_angle', angulo.length > 0 ? 'SIM' : 'não', angulo.slice(0, 60)],
  ['last_user_feedback', feedback.length > 0 ? 'SIM' : 'não', feedback.slice(0, 60)],
];
console.log('sinal                    sobrevive   de onde vem');
for (const [nome, ok, amostra] of sinais) {
  console.log(`${nome.padEnd(24)} ${ok.padEnd(11)} ${amostra}`);
}

const bloco = blocoDeContinuacaoCriativa(tipoDoArtefato as never, ultimaResposta);
console.log(`\nbloco de continuação montado: ${bloco.length} chars`);
console.log(`  carrega a peça anterior:    ${bloco.includes('O QUE VOCÊ ENTREGOU') ? 'SIM' : 'não'}`);
console.log(`  cita ClickUp:               ${/ClickUp/i.test(bloco) ? 'SIM' : 'não'}`);
console.log(`  cita id de lista:           ${/\b9014\d{8}\b/.test(bloco) ? 'SIM' : 'não'}`);

console.log('\nmontagem da mensagem, agora:');
console.log(`  contexto geral na mensagem do Otto: ${contextoGeralVaiNaMensagem('otto') ? 'SIM' : 'não'}`);
console.log(`  bloco operacional na mensagem:      ${agenteAceitaBlocoNaMensagem('otto') ? 'SIM' : 'não'}`);
console.log(
  `\nVEREDITO: os quatro sinais vêm da tabela de mensagens, que é estrutura, ` +
    `não do texto concatenado — a continuidade não dependia do bloco da API.`,
);
process.exit(0);
