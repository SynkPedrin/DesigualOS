/**
 * gpu-load-test.mts — mede a GPU sob DISPUTA, não ociosa.
 *
 * O teste anterior de concorrência rodou com a placa parada e concluiu que
 * contenção não era o gargalo. A conclusão estava errada porque o teste não
 * reproduzia disputa nenhuma. Este aqui dispara ondas concorrentes de prompts
 * de tamanho realista e mede o que de fato interessa:
 *
 *   RESPOSTAS ÚTEIS POR MINUTO — não latência média.
 *
 * Latência média melhora quando o sistema recusa tudo rápido. Resposta útil por
 * minuto só melhora quando mais gente sai atendida.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/gpu-load-test.mts <clientes> [rodadas]
 */
const GATEWAY = process.env.GPU_GATEWAY_TEST_URL ?? 'http://127.0.0.1:11500';
const MODELO = process.env.OTTO_MODEL ?? 'qwen3.6:35b-a3b';

const clientes = Number(process.argv[2] ?? 3);
/** Tamanho da geração: o default é curto, mas turno real de agente é longo e
 * come KV cache — e o modelo já ocupa 24,1 GB de um cartão de 24. */
const NUM_PREDICT = Number(process.env.CARGA_NUM_PREDICT ?? 120);
const NUM_CTX = Number(process.env.CARGA_NUM_CTX ?? 8192);
const rodadas = Number(process.argv[3] ?? 1);

/** Prompts com tamanho de trabalho real, não "diga ok". */
const PROMPTS = [
  'Liste em 3 bullets o que um gestor de tráfego olha primeiro numa campanha de leads que caiu 30%.',
  'Escreva uma legenda curta de Instagram para uma corretora de seguros falando de seguro residencial.',
  'Resuma em 3 linhas por que uma agência deve separar briefing de roteiro.',
  'Dê 3 títulos possíveis para um carrossel sobre planejamento financeiro familiar.',
  'Explique em 2 frases a diferença entre alcance e impressões.',
];

interface Resultado {
  ok: boolean;
  status: number;
  ms: number;
  recusado: boolean;
  tokens: number;
}

async function umPedido(indice: number): Promise<Resultado> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${GATEWAY}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desigual-Caller': `carga-${indice % clientes}` },
      body: JSON.stringify({
        model: MODELO,
        messages: [{ role: 'user', content: PROMPTS[indice % PROMPTS.length] }],
        stream: false,
        think: false,
        keep_alive: '20m',
        options: { num_ctx: NUM_CTX, num_predict: NUM_PREDICT },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const ms = performance.now() - t0;
    const corpo = (await r.json().catch(() => null)) as { eval_count?: number; error?: string } | null;
    return {
      ok: r.ok,
      status: r.status,
      ms,
      recusado: r.status === 503,
      tokens: corpo?.eval_count ?? 0,
    };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, recusado: false, tokens: 0 };
  }
}

function percentil(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const ordenado = [...xs].sort((a, b) => a - b);
  return Math.round(ordenado[Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length))] ?? 0);
}

const admissao = await fetch(`${GATEWAY}/admission`).then((r) => r.json()).catch(() => null);
console.log(`gateway: ${GATEWAY} | upstream: ${(admissao as { upstream?: string } | null)?.upstream ?? '?'}`);
console.log(`modelo: ${MODELO} | clientes simultâneos: ${clientes} | rodadas: ${rodadas}\n`);

const todos: Resultado[] = [];
const inicio = performance.now();

for (let rodada = 0; rodada < rodadas; rodada++) {
  const lote = await Promise.all(Array.from({ length: clientes }, (_, i) => umPedido(rodada * clientes + i)));
  todos.push(...lote);
  const ok = lote.filter((r) => r.ok).length;
  console.log(
    `rodada ${rodada + 1}: ${ok}/${clientes} ok | recusados ${lote.filter((r) => r.recusado).length} | ` +
      `p50 ${percentil(lote.map((r) => r.ms), 50)}ms p95 ${percentil(lote.map((r) => r.ms), 95)}ms`,
  );
}

const totalMin = (performance.now() - inicio) / 60_000;
const sucessos = todos.filter((r) => r.ok);
const recusados = todos.filter((r) => r.recusado);
const erros = todos.filter((r) => !r.ok && !r.recusado);

console.log('\n--- RESULTADO ---');
console.log(`pedidos:            ${todos.length}`);
console.log(`respostas úteis:    ${sucessos.length}`);
console.log(`recusas (capacidade): ${recusados.length}`);
console.log(`erros/timeouts:     ${erros.length}`);
console.log(`latência p50:       ${percentil(sucessos.map((r) => r.ms), 50)}ms`);
console.log(`latência p95:       ${percentil(sucessos.map((r) => r.ms), 95)}ms`);
console.log(`tokens gerados:     ${sucessos.reduce((a, r) => a + r.tokens, 0)}`);
console.log(`tempo total:        ${totalMin.toFixed(2)} min`);
console.log(`>>> RESPOSTAS ÚTEIS/MIN: ${(sucessos.length / Math.max(totalMin, 0.0001)).toFixed(2)}`);

const fim = (await fetch(`${GATEWAY}/admission`).then((r) => r.json()).catch(() => null)) as Record<
  string,
  unknown
> | null;
console.log(`\ntelemetria final: emExecucao=${fim?.emExecucao} naFila=${fim?.naFila} admitidos=${fim?.admitidos}`);
process.exit(0);
