import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gestaoApi, type Paginado } from './use-gestao-empresarial';

export const PAPEIS = ['cliente', 'fornecedor', 'veiculo_midia', 'prestador', 'colaborador'] as const;
export type Papel = (typeof PAPEIS)[number];
export const ROTULO_PAPEL: Record<Papel, string> = { cliente: 'Cliente', fornecedor: 'Fornecedor', veiculo_midia: 'Veículo de mídia', prestador: 'Prestador', colaborador: 'Colaborador' };

export interface PessoaWire {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  rawDocument: string | null;
  documentKind: 'cpf' | 'cnpj' | 'outro' | null;
  documentValid: boolean | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: 'ativo' | 'inativo';
  notes: string | null;
  roles: Papel[];
  mediaType?: string | null;
}

export interface FiltroPessoas {
  role: Papel;
  status?: 'ativo' | 'inativo' | undefined;
  q?: string | undefined;
  semDocumento?: boolean | undefined;
  documentoInvalido?: boolean | undefined;
  page: number;
  pageSize?: number;
}

export interface CorpoPessoa {
  name: string;
  legalName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
  mediaType?: string | null;
}

const RAIZ = ['gestao-empresarial', 'cadastros'] as const;

export function usePessoas(f: FiltroPessoas) {
  return useQuery({
    queryKey: [...RAIZ, 'pessoas', f],
    queryFn: () => gestaoApi.get<Paginado<PessoaWire>>('/cadastros/pessoas', { role: f.role, status: f.status, q: f.q, semDocumento: f.semDocumento ? 'true' : undefined, documentoInvalido: f.documentoInvalido ? 'true' : undefined, page: f.page, pageSize: f.pageSize ?? 25 }),
    placeholderData: (anterior) => anterior,
  });
}

export function usePessoa(id: string | null) {
  return useQuery({ queryKey: [...RAIZ, 'pessoa', id], queryFn: () => gestaoApi.get<PessoaWire>(`/cadastros/pessoas/${id}`), enabled: !!id });
}

export function useAcoesDePessoa() {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: RAIZ });
  return {
    criar: useMutation({ mutationFn: (c: CorpoPessoa & { roles: Papel[] }) => gestaoApi.post<PessoaWire>('/cadastros/pessoas', c), onSuccess: refrescar }),
    editar: useMutation({ mutationFn: ({ id, ...c }: CorpoPessoa & { id: string }) => gestaoApi.patch<PessoaWire>(`/cadastros/pessoas/${id}`, c), onSuccess: refrescar }),
    arquivar: useMutation({ mutationFn: ({ id, arquivar }: { id: string; arquivar: boolean }) => gestaoApi.post<PessoaWire>(`/cadastros/pessoas/${id}/arquivar`, { arquivar }), onSuccess: refrescar }),
    adicionarPapel: useMutation({ mutationFn: ({ id, role }: { id: string; role: Papel }) => gestaoApi.post<void>(`/cadastros/pessoas/${id}/papeis`, { role }), onSuccess: refrescar }),
    removerPapel: useMutation({ mutationFn: ({ id, role }: { id: string; role: Papel }) => gestaoApi.del<void>(`/cadastros/pessoas/${id}/papeis/${role}`), onSuccess: refrescar }),
  };
}

// ── Catálogos ────────────────────────────────────────────────────────────
export interface ServicoWire { id: string; name: string; kind: 'venda' | 'compra'; unit: string | null; defaultPriceCents: number | null; active: boolean }
export interface CategoriaWire { id: string; name: string; kind: 'receita' | 'despesa'; parentId: string | null; active: boolean }
export interface CentroWire { id: string; name: string; active: boolean }

function catalogo<T>(chave: string, caminho: string) {
  return {
    useLista: () => useQuery({ queryKey: [...RAIZ, chave], queryFn: async () => (await gestaoApi.get<{ items: T[] }>(caminho)).items }),
    useAcoes: () => {
      const qc = useQueryClient();
      const refrescar = () => qc.invalidateQueries({ queryKey: [...RAIZ, chave] });
      return {
        criar: useMutation({ mutationFn: (c: Record<string, unknown>) => gestaoApi.post<T>(caminho, c), onSuccess: refrescar }),
        editar: useMutation({ mutationFn: ({ id, ...c }: { id: string } & Record<string, unknown>) => gestaoApi.patch<T>(`${caminho}/${id}`, c), onSuccess: refrescar }),
      };
    },
  };
}

export const servicos = catalogo<ServicoWire>('servicos', '/cadastros/servicos');
export const categorias = catalogo<CategoriaWire>('categorias', '/financeiro/categorias');
export const centros = catalogo<CentroWire>('centros', '/financeiro/centros-de-custo');
