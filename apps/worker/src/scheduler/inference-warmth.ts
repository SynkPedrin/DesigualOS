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
 * A GPU é compartilhada com Studio/ComfyUI/Flux, então o keeper NÃO fixa o
 * modelo para sempre: usa `keep_alive` com folga e só roda no horário de
 * trabalho, deixando a placa livre à noite para render.
 */

/** Janela em que vale a pena manter quente (hora local). */
const INICIO_EXPEDIENTE = 7;
const FIM_EXPEDIENTE = 21;

/** Folga maior que o intervalo do job, para nunca haver janela fria entre pings. */
const KEEP_ALIVE = '45m';

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
