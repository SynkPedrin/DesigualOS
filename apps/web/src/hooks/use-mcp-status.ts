import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GET /mcp/status — quem está conectado ao MCP e o que andou chamando.
 *
 * Nasceu de um erro que vale registrar: a primeira versão da tela de MCP
 * afirmava "não publicado, nenhuma conexão possível". Era verdade quando foi
 * escrita e falso três horas depois — o servidor subiu no Railway e a conta de
 * atendimento conectou. Tela que AFIRMA ausência precisa LER a ausência, nunca
 * presumi-la: o código envelhece sem avisar, o dado não.
 */

export interface PessoaConectada {
  user_id: string;
  nome: string | null;
  scopes: string[];
  conexoes: number;
  desde: string | null;
}

export interface ChamadaDeFerramenta {
  tool: string | null;
  result: string;
  user_name: string | null;
  client_id: string | null;
  request_id: string | null;
  at: string | null;
}

/**
 * Uma conexão que ACONTECEU, do evento que o servidor MCP emite.
 *
 * Diferente de `PessoaConectada`, que é o estado agora (token vivo): aqui é o
 * fato datado. Os dois convivem porque respondem perguntas diferentes — "quem
 * pode entrar" e "quem entrou, quando".
 */
export interface ConexaoRecente {
  id: string;
  session_id: string | null;
  user_id: string | null;
  nome: string | null;
  summary: string | null;
  at: string | null;
  scopes: string[];
  /** `null` = o evento não trouxe dono; não há a quem atribuir chamada. */
  chamadas_24h: number | null;
  /** A autorização daquela sessão ainda está de pé? */
  conexao_viva: boolean;
}

export interface McpStatus {
  /** `null` = a API não sabe o endereço público. Nunca um endereço plausível. */
  endpoint: string | null;
  /** A base do servidor, pro navegador falar com ele direto (/health, /tools). */
  base: string | null;
  conexoes_vivas: number;
  pessoas_conectadas: number;
  pessoas: PessoaConectada[];
  chamadas_24h: number;
  sucessos_24h: number;
  por_ferramenta: Array<{ tool: string; total: number; sucesso: number }>;
  conexoes_recentes: ConexaoRecente[];
  ultimas: ChamadaDeFerramenta[];
}

export function useMcpStatus() {
  return useQuery({
    queryKey: ['mcp', 'status'],
    queryFn: () => apiFetch<McpStatus>('/mcp/status'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
