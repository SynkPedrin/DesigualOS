import type { ExecutionListItem } from '@/lib/api/contracts';

/**
 * A separação que o Control Plane inteiro depende: QUEBRA não é RECUSA.
 *
 * Aprendida caro, e registrada em `apps/worker/scripts/saude-do-bento.mts`: a
 * primeira versão daquele leitor somava as duas e acusou 23% de falha num dia
 * em que a maior parte era o sistema se comportando bem. Um painel que grita
 * demais é ignorado exatamente como um que não grita.
 *
 * A regra prática, e o motivo de ela viver aqui e não em cada tela:
 *
 *   QUEBRA   — o motor caiu, a rede sumiu, estourou o tempo. Precisa de
 *              conserto. É o que pinta de vermelho.
 *   RECUSA   — sem permissão, sem entender qual task, sem o dado, e o sistema
 *              disse isso. É o produto funcionando. Aparece à parte, nunca em
 *              vermelho.
 *   VAZIA    — terminou "completed" e não entregou texto. O pior dos três,
 *              porque o sistema acha que deu certo e a pessoa não recebeu nada.
 */

export type Desfecho = 'entregue' | 'quebra' | 'recusa' | 'andando';

/** Defeito de máquina. A ordem importa: quebra vence recusa quando as duas aparecem. */
const QUEBRA_DE_MAQUINA =
  /(ollama|502|503|504|fetch failed|timeout|n[ãa]o respondeu em|ECONN|socket hang up|congestionad|indispon[íi]vel)/i;

/** O sistema se comportando: recusou e disse por quê. */
const RECUSA_LEGITIMA =
  /(n[ãa]o (tenho|identifiquei|encontrei) |n[ãa]o fiz altera|sem autoriza|n[ãa]o consigo (alterar|escrever)|pode me lembrar|revisar antes de enviar|fora do escopo|permission)/i;

export function classificarDesfecho(e: ExecutionListItem, resposta?: string | null): Desfecho {
  if (e.status === 'completed') return 'entregue';
  if (e.status !== 'failed' && e.status !== 'cancelled') return 'andando';
  const texto = resposta ?? '';
  if (QUEBRA_DE_MAQUINA.test(texto)) return 'quebra';
  if (RECUSA_LEGITIMA.test(texto)) return 'recusa';
  // Sem texto pra classificar, "failed" é quebra: o erro caro é chamar de
  // comportamento correto o que ninguém olhou.
  return 'quebra';
}

export function duracaoMs(e: ExecutionListItem): number | null {
  if (!e.startedAt || !e.completedAt) return null;
  const ms = new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function formatarDuracao(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return ordenados[idx] ?? null;
}

export interface ResumoDeExecucoes {
  total: number;
  entregues: number;
  quebras: number;
  andando: number;
  medianaMs: number | null;
  p95Ms: number | null;
  piorMs: number | null;
}

export function resumir(execucoes: ExecutionListItem[]): ResumoDeExecucoes {
  const duracoes = execucoes.map(duracaoMs).filter((d): d is number => d !== null);
  return {
    total: execucoes.length,
    entregues: execucoes.filter((e) => e.status === 'completed').length,
    // Sem o texto da resposta na listagem, "failed" conta como quebra. A tela
    // de Incidentes, que carrega o detalhe, faz a separação fina.
    quebras: execucoes.filter((e) => e.status === 'failed' || e.status === 'cancelled').length,
    andando: execucoes.filter((e) => e.status !== 'completed' && e.status !== 'failed' && e.status !== 'cancelled')
      .length,
    medianaMs: percentil(duracoes, 50),
    p95Ms: percentil(duracoes, 95),
    piorMs: duracoes.length > 0 ? Math.max(...duracoes) : null,
  };
}
