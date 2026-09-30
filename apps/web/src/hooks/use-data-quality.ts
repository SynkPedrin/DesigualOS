import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GET /data-quality — o que está torto no acervo.
 *
 * Só master: é tela de manutenção do cadastro, não de operação. Colaborador
 * recebe 403, e a tela diz isso em vez de mostrar uma lista vazia — "não posso
 * ver" e "não há nada" são coisas diferentes (ver packages/context-engine/
 * src/leitura.ts).
 */

export interface AlertaDeQualidade {
  codigo: string;
  titulo: string;
  oQueFazer: string;
  quantos: number;
  gravidade: 'ALTO' | 'MEDIO' | 'BAIXO';
  exemplos: string[];
}

export interface QualidadeDoDado {
  acervo: {
    clientes: number;
    carteira: number;
    internos: number;
    fixtures: number;
    memorias: number;
    memorias_producao: number;
    episodios: number;
    episodios_producao: number;
  };
  alertas: AlertaDeQualidade[];
  duplicatas: Array<{ tipo: 'exata' | 'prefixo'; entidades: Array<{ id: string; name: string }> }>;
  generated_at: string;
}

export function useDataQuality(enabled = true) {
  return useQuery({
    queryKey: ['data-quality'],
    queryFn: () => apiFetch<QualidadeDoDado>('/data-quality'),
    enabled,
    staleTime: 60_000,
    // 403 não é falha de rede: insistir três vezes num "você não pode" só
    // atrasa a tela dizer a verdade.
    retry: false,
  });
}
