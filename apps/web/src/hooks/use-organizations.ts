import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { useMe } from '@/hooks/use-me';

/**
 * GET /organizations — as empresas que o provedor atende.
 *
 * Só quem opera no nível da plataforma recebe. Quem não é provider leva 403 da
 * API, e a consulta nem é disparada aqui — pedir para receber negativa é gastar
 * requisição para confirmar o que já se sabe.
 */

export interface EmpresaResumo {
  id: string;
  name: string;
  eh_provedora: boolean;
  pessoas: number;
  clientes: number;
  memorias: number;
  /** `null` = sem atividade registrada. Nunca uma data inventada. */
  ultima_atividade: string | null;
}

export function useOrganizations() {
  const { data: me } = useMe();
  const ehProvider = me?.eh_provider === true;

  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => apiFetch<{ organizations: EmpresaResumo[]; gerado_em: string }>('/organizations'),
    enabled: ehProvider,
    staleTime: 60_000,
  });
}
