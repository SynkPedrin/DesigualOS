import { db, schema } from '@desigual-os/database';
import { controleDeAdmissaoDaGpu } from '@desigual-os/orchestrator';
import { gte, sql } from 'drizzle-orm';
import type { Logger } from '@desigual-os/logging';

/**
 * inference-warmth.ts — manter o modelo forte RESIDENTE na GPU.
 *
 * Medido em 16/09/2026, contra a RTX 4090 com qwen3.6:35b-a3b:
 *
 *   modelo frio  -> TTFT 88.459 ms   (primeira resposta em ~1min29)
 *   modelo quente-> TTFT 585–4.201 ms
 *
 * Um teste de concorrência com a placa OCIOSA deu 7,6 respostas/min com duas
 * chamadas e 7,2 com três, e a leitura que se fez disso — "contenção não é o
 * gargalo" — estava errada, porque o teste não reproduzia a carga real. Sob uso
 * misto de verdade a RTX satura: gerar 5 tokens passou de 60s e uma execução
 * ficou 438s em `queued`. Contenção É gargalo; o que o teste ocioso mediu foi
 * uma placa sem disputa.
 *
 * O que continua verdadeiro é a carga fria: ela transforma um turno de 10
 * segundos em quatro minutos, e acontece no pior momento — a primeira pergunta
 * depois de um período parado, que é o caso normal numa agência.
 *
 * Então são duas correções, não uma: manter o modelo residente (aqui) e limitar
 * a concorrência numa porta única (packages/orchestrator/src/gpu-admission.ts).
 * O custo deste lado é uma geração minúscula a cada 10 minutos.
 *
 * A GPU é compartilhada com Studio/ComfyUI/Flux, e o modelo ocupa 22,3 GB de um
 * cartão de 24 GB — medido. Manter isso preso das 7h às 21h deixaria o Studio
 * sem placa, o que troca um problema por outro pior.
 *
 * Por isso o keeper é POR DEMANDA: só aquece quando houve conversa recente com
 * os agentes. Quem está trabalhando com o Bento e o Otto encontra o modelo
 * quente; quando a equipe para de conversar e vai renderizar, o modelo expira
 * sozinho e a VRAM volta para o Studio.
 */

/** Janela em que vale a pena manter quente (hora local). */
const INICIO_EXPEDIENTE = 7;
const FIM_EXPEDIENTE = 21;

/**
 * Folga maior que o intervalo do job, para não haver janela fria entre pings,
 * mas curta o bastante para a VRAM voltar ao Studio pouco depois que a equipe
 * para de usar os agentes.
 */
const KEEP_ALIVE = '20m';

/**
 * Janela de ATIVIDADE que justifica manter 22 GB de VRAM ocupados. Sem alguém
 * conversando com os agentes, aquecer é só tirar a placa de quem vai renderizar.
 */
const ATIVIDADE_RECENTE_MIN = 45;

export interface ResultadoDoAquecimento {
  executou: boolean;
  jaEstavaQuente: boolean;
  ttftMs: number | null;
  motivo?: string;
}

function dentroDoExpediente(agora = new Date()): boolean {
  const h = agora.getHours();
  return h >= INICIO_EXPEDIENTE && h < FIM_EXPEDIENTE;
}

/**
 * O Studio está renderizando? O ComfyUI usa a MESMA VRAM por outra porta, e
 * nenhuma fila de Ollama enxerga isso. Aquecer 22,3 GB no meio de um render é
 * tirar a placa de quem já está usando — e o keeper é, dos cinco chamadores, o
 * único cujo trabalho pode simplesmente esperar.
 *
 * Na dúvida (ComfyUI fora do ar, resposta estranha) o keeper NÃO recua: tratar
 * silêncio como "ocupado" desligaria o aquecimento pra sempre se o Studio caísse.
 */
export async function estudioOcupado(comfyUrl = process.env.COMFYUI_URL ?? 'http://100.107.198.50:8188'): Promise<boolean> {
  const r = await fetch(`${comfyUrl}/queue`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!r?.ok) return false;
  const j = (await r.json().catch(() => null)) as { queue_running?: unknown[]; queue_pending?: unknown[] } | null;
  if (!j) return false;
  return (j.queue_running?.length ?? 0) > 0 || (j.queue_pending?.length ?? 0) > 0;
}

/** O modelo está carregado agora? */
export async function modeloResidente(baseUrl: string, modelo: string): Promise<boolean> {
  const r = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r?.ok) return false;
  const j = (await r.json().catch(() => null)) as { models?: Array<{ name?: string }> } | null;
  return (j?.models ?? []).some((m) => (m.name ?? '').startsWith(modelo.split(':')[0] ?? modelo));
}

/**
 * Mantém o modelo quente. Fora do expediente não faz nada: a GPU é
 * compartilhada e render noturno tem mais direito à VRAM que um agente ocioso.
 */
export async function keepInferenceWarm(logger: Logger, agora = new Date()): Promise<ResultadoDoAquecimento> {
  const baseUrl = process.env.OTTO_OLLAMA_URL ?? process.env.OLLAMA_URL ?? 'http://100.107.198.50:11434';
  const modelo = process.env.OTTO_MODEL ?? 'qwen3.6:35b-a3b';

  if (!dentroDoExpediente(agora)) {
    return { executou: false, jaEstavaQuente: false, ttftMs: null, motivo: 'fora do expediente' };
  }

  if (!(await houveAtividadeRecente(agora))) {
    return { executou: false, jaEstavaQuente: false, ttftMs: null, motivo: 'sem conversa recente; VRAM fica com o Studio' };
  }

  if (await estudioOcupado()) {
    return { executou: false, jaEstavaQuente: false, ttftMs: null, motivo: 'Studio renderizando; a placa é dele agora' };
  }

  const quente = await modeloResidente(baseUrl, modelo);
  const t0 = performance.now();

  /**
   * Pelo controle de admissão, direto: o keeper roda no mesmo processo do
   * gateway, então usa o mesmo singleton — um limite global, não dois. Se a
   * placa estiver ocupada, o aquecimento é recusado e espera o próximo ciclo,
   * que é o comportamento certo: ninguém deve perder a vez pro keeper.
   */
  const r = await controleDeAdmissaoDaGpu()
    .executar('keeper', () =>
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelo,
          messages: [{ role: 'user', content: 'ok' }],
          stream: false,
          think: false,
          keep_alive: KEEP_ALIVE,
          options: { num_predict: 1 },
        }),
        // Frio pode levar ~90s: o timeout precisa caber na carga, senão o keeper
        // desiste justamente quando era mais necessário.
        signal: AbortSignal.timeout(180_000),
      }),
    )
    .catch(() => null);

  const ttftMs = Math.round(performance.now() - t0);
  if (!r?.ok) {
    logger.warn({ baseUrl, modelo, ttftMs }, '[inferencia] aquecimento falhou');
    return { executou: true, jaEstavaQuente: quente, ttftMs, motivo: 'servidor de inferência não respondeu' };
  }

  if (!quente) {
    logger.info({ modelo, ttftMs }, '[inferencia] modelo estava FRIO e foi carregado pelo keeper');
  }
  return { executou: true, jaEstavaQuente: quente, ttftMs };
}

/** Alguém conversou com os agentes há pouco? É o que justifica ocupar a GPU. */
async function houveAtividadeRecente(agora: Date): Promise<boolean> {
  const desde = new Date(agora.getTime() - ATIVIDADE_RECENTE_MIN * 60_000);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.executions)
    .where(gte(schema.executions.createdAt, desde))
    .catch(() => []);
  return (r?.n ?? 0) > 0;
}
