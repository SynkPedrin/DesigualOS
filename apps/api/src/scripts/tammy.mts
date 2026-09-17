/**
 * tammy.mts — a conversa que a Tammy teria, na ordem em que ela teria.
 *
 * As baterias testam perguntas ISOLADAS, uma conversa nova por item. Isso mede
 * competência e não mede a coisa que decide se o sistema serve: CONTINUIDADE.
 * Aqui tudo acontece na MESMA conversa, em sequência, com a linguagem que se
 * usa no dia a dia — sem nomear cliente quando o assunto já está claro, sem
 * explicar o que é escopo, sem dizer "por favor considere o contexto".
 *
 * O critério não é acertar cada resposta. É a Tammy não precisar ensinar o
 * sistema de novo a cada frase.
 *
 *   pnpm --filter @desigual-os/api exec tsx src/scripts/tammy.mts [saida.md]
 */
import '../env.js';
import { db, schema } from '@desigual-os/database';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import { eq, sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { formatOperationalContextForPrompt, resolveOperationalTurn } from '../lib/operational-context.js';
import { recusarEnsinoEmProducao } from './_guard-producao.js';

const COSENTINO = '44be15e0-b8bd-4f44-916d-eedc5a84a0d5';
const COLPAR = 'b246bcfe-89bb-4b70-ba04-9e1d2936c5da';

interface Turno {
  agente: 'bento' | 'otto';
  cliente: string | null;
  fala: string;
  espero: string;
}

/**
 * Duas conversas, como acontece de verdade: uma com o Bento sobre a operação,
 * outra com o Otto sobre a peça. A continuidade DENTRO de cada uma é o que
 * está sendo medido.
 */
const CONVERSA_BENTO: Turno[] = [
  { agente: 'bento', cliente: null, fala: 'Bento, me atualiza.', espero: 'Panorama da operação inteira, sem perguntar de qual cliente.' },
  { agente: 'bento', cliente: null, fala: 'o que tá pegando?', espero: 'Continua no panorama, aponta o que está travado ou atrasado.' },
  { agente: 'bento', cliente: COSENTINO, fala: 'e a Cosentino?', espero: 'Muda o foco pra Cosentino sem pedir que eu repita a pergunta.' },
  { agente: 'bento', cliente: COSENTINO, fala: 'e a Tammy?', espero: 'Entende que é pessoa, não cliente, e responde o que está com ela.' },
  { agente: 'bento', cliente: COSENTINO, fala: 'quem é a Esther mesmo?', espero: 'Diz que não há registro. NÃO inventa vínculo com o cliente da vez.' },
  { agente: 'bento', cliente: COLPAR, fala: 'quem decide na Colpar?', espero: 'Fernanda Alves, o que foi ensinado — não [FALTA].' },
  { agente: 'bento', cliente: COLPAR, fala: 'de onde você tirou isso?', espero: 'Diz que foi informado na conversa, com data. Nunca "ClickUp" por hábito.' },
];

const CONVERSA_OTTO: Turno[] = [
  { agente: 'otto', cliente: COSENTINO, fala: 'lembra daquela campanha do Jardim Europa?', espero: 'Recupera a campanha real, não pergunta qual.' },
  { agente: 'otto', cliente: COSENTINO, fala: 'me dá três títulos', espero: 'TRÊS TÍTULOS, uma linha cada. Não legenda.' },
  { agente: 'otto', cliente: COSENTINO, fala: 'faz uma legenda', espero: 'Agora sim legenda, pronta pra colar, no assunto que já está em pauta.' },
  { agente: 'otto', cliente: COSENTINO, fala: 'não gostei', espero: 'Trata como reprovação e muda de direção, sem pedir briefing de novo.' },
  { agente: 'otto', cliente: COSENTINO, fala: 'e vê como tá operacionalmente', espero: 'Traz o estado real da campanha: é o cruzamento criativo/operacional.' },
];

const [usuario] = await db
  .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);
if (!usuario) {
  console.error('usuário não encontrado');
  process.exit(1);
}

async function conversar(nome: string, turnos: Turno[]): Promise<Array<Turno & { resposta: string; segundos: number; status: string }>> {
  // UMA conversa para todos os turnos: é o que torna isto uma conversa e não
  // uma lista de perguntas.
  const conversas = (await db.execute(sql`
    insert into conversations (client_id, user_id, title, status)
    values (${turnos[0]!.cliente}::uuid, ${usuario!.id}::uuid, ${'tammy ' + nome}, 'open')
    returning id`)) as unknown as Array<{ id: string }>;
  const conversaId = conversas[0]!.id;

  const saidas: Array<Turno & { resposta: string; segundos: number; status: string }> = [];
  for (const t of turnos) {
    const t0 = performance.now();
    const turno = await resolveOperationalTurn(t.fala, usuario as never);
    const bloco = turno.briefingBlock ?? formatOperationalContextForPrompt(turno.context);
    const paraBento = t.agente === 'bento' ? (bloco ?? undefined) : undefined;
    const mensagem = t.agente === 'bento' || !bloco ? t.fala : `${t.fala}\n\n---\n${bloco}`;

    // Nenhum harness ensina fato em produção: ver _guard-producao.ts.
    await recusarEnsinoEmProducao(t.fala, t.cliente);

    const r = await dispatchChatMessage({
      message: mensagem,
      userId: usuario!.id,
      clientId: t.cliente,
      conversationId: conversaId,
      decision: {
        intent: 'simulação de uso real',
        primary_agent: t.agente,
        required_tools: [],
        context: [],
        estimated_complexity: 'medium',
        workflow: null,
        confidence: 1,
        source: 'manual',
      },
      ...(paraBento ? { operationalContext: paraBento } : {}),
    });

    let status = '';
    let resposta = '(sem mensagem)';
    if (r.executionId) {
      for (;;) {
        const l = (await db
          .execute(sql`select status from executions where execution_id = ${r.executionId}`)
          .catch(() => [] as unknown[])) as unknown as Array<{ status: string }>;
        status = l[0]?.status ?? status;
        if (status === 'completed' || status === 'failed') break;
        if (performance.now() - t0 > 300_000) { status = 'estourou'; break; }
        await new Promise((x) => setTimeout(x, 2_000));
      }
      for (let i = 0; i < 10; i++) {
        const m = (await db
          .execute(sql`
            select content from messages where conversation_id = ${conversaId}::uuid and role = 'assistant'
            order by created_at desc limit 1`)
          .catch(() => [] as unknown[])) as unknown as Array<{ content: string }>;
        if (m[0]?.content && m[0].content !== saidas[saidas.length - 1]?.resposta) {
          resposta = m[0].content;
          break;
        }
        await new Promise((x) => setTimeout(x, 800));
      }
    } else {
      status = 'erro';
      resposta = r.error ?? 'não enfileirou';
    }

    const s = { ...t, resposta, segundos: Math.round((performance.now() - t0) / 1000), status };
    saidas.push(s);
    console.log(`  [${t.agente}] "${t.fala}" -> ${status} ${s.segundos}s (${resposta.length} chars)`);
  }
  return saidas;
}

console.log('== conversa com o Bento ==');
const bento = await conversar('bento', CONVERSA_BENTO);
console.log('== conversa com o Otto ==');
const otto = await conversar('otto', CONVERSA_OTTO);

const linhas: string[] = ['# Simulação de uso real', '', `Rodada em ${new Date().toISOString()}`, ''];
for (const [nome, conj] of [['Bento', bento], ['Otto', otto]] as const) {
  linhas.push(`## Conversa com o ${nome}`, '');
  for (const s of conj) {
    linhas.push(`### "${s.fala}" (${s.segundos}s, ${s.status})`, '', `_Esperado:_ ${s.espero}`, '', '```', s.resposta, '```', '');
  }
}
const destino = process.argv[2] ?? '/tmp/tammy.md';
writeFileSync(destino, linhas.join('\n'), 'utf8');
console.log(`\nsaída: ${destino}`);
process.exit(0);
