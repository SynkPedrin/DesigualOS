/**
 * bateria-cosentino.mts — a bateria que decide se o P0 fechou.
 *
 * Por que existe: em 01/10/2026 eu declarei um defeito corrigido com base em
 * UMA execução verde, e a medição seguinte mostrou 22% de acerto. Neste
 * sistema, uma amostra não é evidência de nada — a mesma pergunta, no mesmo
 * código, dá respostas diferentes.
 *
 * Então toda afirmação sobre comportamento de resposta passa a sair daqui, com
 * a distribuição inteira à vista e nunca só o número bom.
 *
 * Uso:
 *   pnpm --filter @desigual-os/worker exec tsx scripts/bateria-cosentino.mts [--n 5]
 *
 * As perguntas saem de fatos que ESTÃO no dossiê real da Cosentino. Perguntar
 * o que não existe mediria outra coisa.
 */
import { db } from '@desigual-os/database';
import { sql as raw } from 'drizzle-orm';

const N = Number(process.argv[process.argv.indexOf('--n') + 1]) || 5;
const API = process.env.API_URL ?? 'http://localhost:3001';
const CLIENTE_COSENTINO = '44be15e0-b8bd-4f44-916d-eedc5a84a0d5';

const PERGUNTAS = [
  { q: 'Qual é o posicionamento da Cosentino?', espera: /premium|regional|legado|permanenc/i },
  { q: 'Como a Cosentino se posiciona em preço frente aos concorrentes?', espera: /10\s*%|acima|premium/i },
  { q: 'Que tipo de comunicação a Cosentino deve evitar?', espera: /urgenc|desconto|pre[çc]o|regressiva/i },
  { q: 'Há quantos anos a Cosentino atua?', espera: /47/i },
  { q: 'Qual é o segmento da Cosentino?', espera: /imobili|incorpora|loteament/i },
] as const;

/** Afirmação de ausência, mesma família que o guarda reconhece. */
const AUSENCIA =
  /n[ãa]o (tenho|temos|h[áa]|existe|encontrei|consta)|o dado n[ãa]o|est[áa] vazio|\[MISSING\]|imposs[íi]vel responder|sem informa[çc][ãa]o/i;
const CLARIFICATION = /n[ãa]o consegui identificar sozinho/i;

async function token(): Promise<string> {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.QA_USER_EMAIL, password: process.env.QA_USER_PASSWORD }),
  });
  return ((await r.json()) as { access_token?: string }).access_token ?? '';
}

/** `sem_resposta` é separado de `outra` de propósito: resposta que não chegou
 *  em 160s não é resposta ruim, é timeout — e misturar as duas esconderia uma
 *  falha de latência dentro de uma métrica de qualidade. */
type Desfecho = 'correta' | 'ausencia_falsa' | 'clarification' | 'outra' | 'sem_resposta';

async function main(): Promise<void> {
  const jwt = await token();
  if (!jwt) throw new Error('sem token: confira SUPABASE_URL/QA_USER_EMAIL/QA_USER_PASSWORD');

  const contagem: Record<Desfecho, number> = { correta: 0, ausencia_falsa: 0, clarification: 0, outra: 0, sem_resposta: 0 };
  const porPergunta: Array<{ q: string; d: Record<Desfecho, number> }> = [];

  for (const { q, espera } of PERGUNTAS) {
    const d: Record<Desfecho, number> = { correta: 0, ausencia_falsa: 0, clarification: 0, outra: 0, sem_resposta: 0 };
    for (let i = 0; i < N; i++) {
      const resp = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: q, client_id: CLIENTE_COSENTINO }),
      });
      const corpo = (await resp.json()) as { conversation_id?: string; status?: string };
      const cid = corpo.conversation_id;
      // `contagem` TAMBÉM precisa subir aqui. Na primeira execução não subia, e
      // o total reportou `outra: 0` enquanto as linhas por pergunta somavam 3.
      // Instrumento que não conta o próprio caso de falha mente sobre o alvo.
      if (!cid) { d.outra++; contagem.outra++; process.stdout.write('o'); continue; }

      let texto: string | null = null;
      for (let t = 0; t < 40 && texto === null; t++) {
        const bruto: unknown = await db.execute(
          raw`select content from messages where conversation_id = ${cid}::uuid and role = 'assistant' order by created_at desc limit 1`,
        );
        const linhas = ((bruto as { rows?: unknown[] }).rows ?? (bruto as unknown[])) as Array<{ content: string }>;
        if (linhas.length) texto = linhas[0]!.content;
        else await new Promise((r) => setTimeout(r, 4000));
      }
      if (texto === null) { d.sem_resposta++; contagem.sem_resposta++; process.stdout.write('_'); continue; }

      const desfecho: Desfecho = CLARIFICATION.test(texto)
        ? 'clarification'
        : AUSENCIA.test(texto)
          ? 'ausencia_falsa'
          : espera.test(texto)
            ? 'correta'
            : 'outra';
      d[desfecho]++;
      contagem[desfecho]++;
      process.stdout.write(desfecho === 'correta' ? '.' : desfecho === 'ausencia_falsa' ? 'X' : desfecho === 'clarification' ? '?' : 'o');
    }
    porPergunta.push({ q, d });
    process.stdout.write('\n');
  }

  const total = PERGUNTAS.length * N;
  console.log('\n=== BATERIA COSENTINO ===');
  console.log(`perguntas: ${PERGUNTAS.length} | runs/pergunta: ${N} | total: ${total}\n`);
  for (const { q, d } of porPergunta) {
    console.log(`  ${d.correta}/${N} certas | ${d.ausencia_falsa} ausência falsa | ${d.clarification} clarification | ${d.outra} outra | ${d.sem_resposta} sem resposta  — ${q}`);
  }
  const pct = (x: number) => `${Math.round((100 * x) / total)}%`;
  console.log('\n--- totais ---');
  console.log(`  correta:          ${contagem.correta}/${total}  ${pct(contagem.correta)}`);
  console.log(`  ausência falsa:   ${contagem.ausencia_falsa}/${total}  ${pct(contagem.ausencia_falsa)}   <- alvo 0`);
  console.log(`  clarification:    ${contagem.clarification}/${total}  ${pct(contagem.clarification)}   <- alvo 0 (roteador)`);
  console.log(`  outra:            ${contagem.outra}/${total}  ${pct(contagem.outra)}`);
  console.log(`  sem resposta:     ${contagem.sem_resposta}/${total}  ${pct(contagem.sem_resposta)}   <- timeout, não qualidade`);
  const somado = contagem.correta + contagem.ausencia_falsa + contagem.clarification + contagem.outra + contagem.sem_resposta;
  if (somado !== total) console.log(`\n  ATENCAO: os desfechos somam ${somado} e o total e ${total}. O instrumento esta errado.`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
