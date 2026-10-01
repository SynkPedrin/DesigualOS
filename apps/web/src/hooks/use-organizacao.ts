import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * A FICHA DE UMA EMPRESA — ler e configurar.
 *
 * Separado de `use-organizations` (plural) de propósito: aquele é a LISTA do
 * provedor, e só o provedor recebe. Este é a ficha de UMA empresa, que o dono
 * da própria empresa também pode abrir. São dois públicos e duas permissões.
 */

export interface PessoaDaEmpresa {
  id: string;
  nome: string | null;
  email: string;
  papel: string;
  ativa: boolean;
  responde_pela_empresa: boolean;
}

export interface FichaDaEmpresa {
  id: string;
  nome: string;
  slug: string;
  status: string;
  eh_provedora: boolean;
  como_provedor: boolean;
  identidade: {
    nome_assistente: string | null;
    mensagem_boas_vindas: string | null;
    logo_url: string | null;
    cor_primaria: string | null;
    cor_secundaria: string | null;
  };
  pessoas: PessoaDaEmpresa[];
  numeros: { clientes: number; pessoas: number; memorias: number; conversas: number };
  criada_em: string | null;
}

export function useOrganizacao(id: string | undefined) {
  return useQuery({
    queryKey: ['organizacao', id],
    queryFn: () => apiFetch<FichaDaEmpresa>(`/organizations/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export interface MudancaDeEmpresa {
  nome?: string;
  slug?: string;
  nome_assistente?: string | null;
  mensagem_boas_vindas?: string | null;
  cor_primaria?: string | null;
  cor_secundaria?: string | null;
  logo_url?: string | null;
  status?: 'ativa' | 'suspensa';
}

export function useConfigurarEmpresa(id: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mudanca: MudancaDeEmpresa) =>
      apiFetch<FichaDaEmpresa>(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(mudanca) }),
    onSuccess: (ficha) => {
      /**
       * Escreve a resposta REAL no cache em vez de só invalidar. O slug volta
       * normalizado e a cor em minúscula — mostrar o que foi digitado enquanto
       * o banco guardou outra coisa é o jeito mais fácil de alguém acreditar
       * que salvou algo que não salvou.
       */
      queryClient.setQueryData(['organizacao', id], ficha);
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
