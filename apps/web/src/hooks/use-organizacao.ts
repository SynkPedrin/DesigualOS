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
  /** Um ponto por dia, incluindo os dias de silêncio — o silêncio é o que o
   *  dono precisa ver. A janela pode ser menor que 30 dias numa empresa nova. */
  atividade: { dia: string; mensagens: number; execucoes: number }[];
  atividade_desde: string | null;
  ultima_atividade: string | null;
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

export type PapelDeEmpresa = 'owner' | 'admin' | 'collaborator';

export interface MembroDaEmpresa {
  id: string;
  nome: string | null;
  email: string;
  papel: PapelDeEmpresa;
  ativa: boolean;
  ultimo_acesso: string | null;
  membro_desde: string | null;
}

export interface ConvitePendente {
  id: string;
  email: string;
  papel: PapelDeEmpresa;
  status: string;
  convidado_em: string | null;
}

export interface MembrosDaEmpresa {
  membros: MembroDaEmpresa[];
  convites_pendentes: ConvitePendente[];
}

/**
 * Quem trabalha na empresa, incluindo convite pendente — separado da ficha
 * (`useOrganizacao`) porque é o endpoint que também serve as mutações de
 * convidar/trocar papel/remover, e refaz essa lista sozinho sem invalidar a
 * ficha inteira.
 */
export function useMembrosDaEmpresa(id: string | undefined) {
  return useQuery({
    queryKey: ['organizacao', id, 'membros'],
    queryFn: () => apiFetch<MembrosDaEmpresa>(`/organizations/${id}/members`),
    enabled: Boolean(id),
  });
}

function useInvalidarMembros(id: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['organizacao', id, 'membros'] });
    void queryClient.invalidateQueries({ queryKey: ['organizacao', id] });
  };
}

export function useConvidarParaEmpresa(id: string | undefined) {
  const invalidar = useInvalidarMembros(id);
  return useMutation({
    mutationFn: (dados: { email: string; role: PapelDeEmpresa }) =>
      apiFetch<{ email: string; papel: PapelDeEmpresa; status: string; membro_criado: boolean; email_enviado: boolean; motivo: string | null }>(
        `/organizations/${id}/invites`,
        { method: 'POST', body: JSON.stringify(dados) },
      ),
    onSuccess: invalidar,
  });
}

export function useTrocarPapelDeMembro(id: string | undefined) {
  const invalidar = useInvalidarMembros(id);
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: PapelDeEmpresa }) =>
      apiFetch(`/organizations/${id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: invalidar,
  });
}

export function useRemoverMembro(id: string | undefined) {
  const invalidar = useInvalidarMembros(id);
  return useMutation({
    mutationFn: (userId: string) => apiFetch(`/organizations/${id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });
}

export function useReenviarConvite(id: string | undefined) {
  const invalidar = useInvalidarMembros(id);
  return useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch<{ email_enviado: boolean; motivo: string | null }>(`/organizations/${id}/invites/${inviteId}/reenviar`, { method: 'POST' }),
    onSuccess: invalidar,
  });
}

export function useRevogarConvite(id: string | undefined) {
  const invalidar = useInvalidarMembros(id);
  return useMutation({
    mutationFn: (inviteId: string) => apiFetch(`/organizations/${id}/invites/${inviteId}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });
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
