import { db, schema } from '@desigual-os/database';
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
 * Duas chamadas concorrentes entregam 7,6 respostas/min e três entregam 7,2 —
 * ou seja, CONTENÇÃO NÃO É O GARGALO. O que transforma um turno de 10 segundos
 * em quatro minutos é a carga fria, e ela acontece exatamente no pior momento:
 * a primeira pergunta depois de um período parado, que é o caso normal numa
 * agência.
 *
 * Por isso a correção não é fila nem modelo menor: é não deixar o modelo sair
 * da memória durante o expediente. O custo é uma geração minúscula a cada 10
 * minutos.
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

  const quente = await modeloResidente(baseUrl, modelo);
  const t0 = performance.now();

  // Mesmo quente, o ping renova o keep_alive — é o que impede a janela fria.
  const r = await fetch(`${baseUrl}/api/chat`, {
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
  }).catch(() => null);

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
