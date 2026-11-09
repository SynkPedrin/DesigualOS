import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * Cliente e acesso da Gestão Empresarial. Todas as rotas moram sob `/gestao-empresarial`; este arquivo
 * é a única porta de entrada para elas, para o prefixo e o tratamento de erro ficarem num lugar só.
 */
export const GESTAO = '/gestao-empresarial';

type Consulta = Record<string, string | number | boolean | null | undefined>;

/** Query string só com o que tem valor: `undefined`, nulo e vazio não viajam. */
export function qs(consulta: Consulta = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(consulta)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const gestaoApi = {
  get: <T>(caminho: string, consulta?: Consulta) => apiFetch<T>(`${GESTAO}${caminho}${qs(consulta)}`),
  post: <T>(caminho: string, corpo?: unknown) => apiFetch<T>(`${GESTAO}${caminho}`, { method: 'POST', body: JSON.stringify(corpo ?? {}) }),
  patch: <T>(caminho: string, corpo: unknown) => apiFetch<T>(`${GESTAO}${caminho}`, { method: 'PATCH', body: JSON.stringify(corpo) }),
  put: <T>(caminho: string, corpo: unknown) => apiFetch<T>(`${GESTAO}${caminho}`, { method: 'PUT', body: JSON.stringify(corpo) }),
  del: <T>(caminho: string) => apiFetch<T>(`${GESTAO}${caminho}`, { method: 'DELETE' }),
};

export interface Paginado<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GestaoAcessoWire {
  allowed: boolean;
}

/**
 * GET /gestao-empresarial/access: a decisão vem SEMPRE do servidor (módulo ligado + papel
 * administrador). Esconder o menu não protege dado financeiro; o servidor recusa com 403/404 de
 * qualquer forma. Erro conta como "não liberado".
 */
export function useGestaoAcesso() {
  return useQuery({
    queryKey: ['gestao-empresarial', 'access'],
    queryFn: () => gestaoApi.get<GestaoAcessoWire>('/access'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
