import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapInfrastructureHealth, type InfrastructureHealthWire } from '@/lib/api/contracts';

/** `nodes:read` is master-only on the backend (confirmed by the backend team): colaborador
 * gets 403. Callers should pass `enabled: isMaster` from useIsMaster() rather than let the
 * request fire and surface an error, same pattern as useCostsOverview. */
export function useInfrastructureHealth(enabled = true) {
  return useQuery({
    queryKey: ['health', 'infrastructure'],
    queryFn: async () => {
      const wire = await apiFetch<InfrastructureHealthWire>('/health/infrastructure');
      return mapInfrastructureHealth(wire);
    },
    enabled,
    // staleTime > 0 porque sidebar + agent-spotlight montam a mesma query em
    // sequência: sem isto, cada mount refetchava (medido: 2x GET
    // /health/infrastructure por carga de página). O poll de 15s segue
    // garantindo frescor.
    staleTime: 10_000,
    refetchInterval: 15_000,
    /**
     * DUAS OU MAIS CHAMADAS POR CARGA SÃO ESPERADAS. NÃO DEDUPLIQUE.
     *
     * O comentário logo acima descreve um defeito ANTIGO cuja assinatura é
     * idêntica à do comportamento CORRETO de hoje, e é por isso que este aviso
     * existe: quem contar as chamadas de uma tela vai ver duas (às vezes três)
     * idas a `/health/infrastructure` e concluir, com toda a razão aparente,
     * que o `staleTime` parou de funcionar.
     *
     * Não parou. A segunda chamada vem de `use-realtime-events.ts`, que invalida
     * `['health','infrastructure']` ao receber `node.status` pelo WebSocket, de
     * propósito, pra derrubar o polling de 15s e atualizar na hora. Mais nós
     * reportando durante a carga, mais invalidações.
     *
     * COMO DISTINGUIR um do outro, medido em 09/10/2026 no /pipeline: o defeito
     * antigo era duas chamadas QUASE SIMULTÂNEAS, de dois mounts. O
     * comportamento atual é uma chamada, a resposta, e só DEPOIS a segunda —
     * ali foram 2.687ms, resposta aos 4.041ms, segunda aos 7.200ms. Separadas
     * por mais que o tempo de resposta, e dentro do `staleTime`, só podem vir
     * de invalidação.
     *
     * Deduplicar isso economiza uma chamada e quebra a atualização ao vivo de
     * TODAS as telas, porque este hook alimenta o rodapé da barra lateral.
     */
  });
}
