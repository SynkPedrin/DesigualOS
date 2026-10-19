import { useQuery } from '@tanstack/react-query';

/**
 * O servidor MCP, perguntado DIRETO — sem passar pela nossa API.
 *
 * Dois endpoints públicos, com CORS aberto pra origem do front (conferido ao
 * vivo: o header volta com o domínio da Vercel):
 *
 *   GET {base}/health  -> ping de verdade, com latência do banco
 *   GET {base}/tools   -> o inventário vivo, 35 ferramentas hoje
 *
 * POR QUE DIRETO, e não por proxy na nossa API: a pergunta que estas telas
 * fazem é "o servidor MCP está de pé?". Um proxy responderia "a nossa API
 * conseguiu falar com ele", que é parecido e não é a mesma coisa — e, pior,
 * esconderia uma falha de rede do navegador atrás de um sucesso do servidor.
 *
 * POR QUE ISTO SUBSTITUIU UMA LISTA GERADA: eu tinha um `lib/mcp-tools.ts`
 * gerado do código de `apps/mcp` por script. Ele dizia 33 ferramentas. Quando
 * fui conferir, o servidor já servia 35 — envelheceu em horas, exatamente como
 * a frase "não publicado" que eu tinha escrito na tela de MCP. Duas vezes o
 * mesmo erro no mesmo dia: afirmar por constante o que dá pra ler.
 */

const REFRESH_MS = 60_000;

export interface SaudeDoMcp {
  status: 'ok' | 'degraded' | string;
  service?: string;
  version?: string;
  banco?: { ok: boolean; latencia_ms: number };
  timestamp?: string;
}

export interface FerramentaViva {
  name: string;
  description: string;
  scope: string;
  access: 'READ' | 'WRITE';
  resource: string;
}

async function buscar<T>(url: string): Promise<T> {
  // Timeout curto de propósito: é um painel, e uma espera longa por um serviço
  // de fora trava a leitura do resto da tela por algo que é informativo.
  const resposta = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return (await resposta.json()) as T;
}

export function useSaudeDoMcp(base: string | null | undefined) {
  return useQuery({
    queryKey: ['mcp', 'saude', base],
    queryFn: () => buscar<SaudeDoMcp>(`${base}/health`),
    enabled: Boolean(base),
    refetchInterval: REFRESH_MS,
    // Uma tentativa só: se o servidor não respondeu, a resposta certa da tela é
    // dizer isso, não insistir três vezes antes de admitir.
    retry: 1,
  });
}

export function useFerramentasVivas(base: string | null | undefined) {
  return useQuery({
    queryKey: ['mcp', 'tools', base],
    queryFn: async () => (await buscar<{ count: number; tools: FerramentaViva[] }>(`${base}/tools`)).tools,
    enabled: Boolean(base),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Agrupa por escopo, que é como a permissão é concedida — não por arquivo. */
export function porEscopo(lista: readonly FerramentaViva[]): Map<string, FerramentaViva[]> {
  const mapa = new Map<string, FerramentaViva[]>();
  for (const f of lista) {
    const atual = mapa.get(f.scope);
    if (atual) atual.push(f);
    else mapa.set(f.scope, [f]);
  }
  return mapa;
}
