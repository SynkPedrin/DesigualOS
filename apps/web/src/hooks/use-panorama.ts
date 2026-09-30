import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GET /panorama — a resposta de "como estamos?" numa chamada só.
 *
 * Existe porque quem é dono da agência não abre nove telas para montar a conta
 * na cabeça.
 */

export interface Panorama {
  carteira: { clientes: number; internos: number };
  equipe: { pessoas: number; usando: number; sem_clickup: number };
  inteligencia: {
    pedidos_30d: number;
    por_agente: Array<{ agente: string; total: number }>;
    serie_14d: Array<{ dia: string; total: number; ok: number; falhou: number }>;
    /** `null` = não houve pedido na janela. Não é 0% de falha; é ausência de dado. */
    taxa_de_falha_14d: number | null;
  };
  conhecimento: { memorias: number };
  atencao: { sinais_abertos: number };
  gerado_em: string;
}

export function usePanorama() {
  return useQuery({
    queryKey: ['panorama'],
    queryFn: () => apiFetch<Panorama>('/panorama'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
