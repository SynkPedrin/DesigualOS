import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gestaoApi, type Paginado } from './use-gestao-empresarial';

export type TipoDeLote = 'clientes' | 'fornecedores' | 'veiculos_midia' | 'lancamentos';
export type StatusDaLinha = 'novo' | 'duplicado_provavel' | 'invalido' | 'precisa_vinculo' | 'aplicado' | 'ignorado';

export const ROTULO_DO_TIPO: Record<TipoDeLote, string> = { clientes: 'Clientes', fornecedores: 'Fornecedores', veiculos_midia: 'Veículos de mídia', lancamentos: 'Lançamentos' };
export const FORMATO_DO_TIPO: Record<TipoDeLote, string> = { clientes: '.xlsx (Relatório de Clientes)', fornecedores: '.xlsx (Relatório de Fornecedores)', veiculos_midia: '.xlsx (Relatório de Veículos)', lancamentos: '.csv (export de lançamentos)' };
export const ROTULO_DA_SITUACAO: Record<StatusDaLinha, string> = { novo: 'Pronta para aplicar', duplicado_provavel: 'Duplicado provável', invalido: 'Inválida', precisa_vinculo: 'Precisa de vínculo', aplicado: 'Aplicada', ignorado: 'Ignorada' };

/** Cada aviso que o importador grava numa linha, em português. Aviso desconhecido aparece como veio. */
export const ROTULO_DO_AVISO: Record<string, string> = {
  documento_ausente: 'Sem CPF/CNPJ',
  documento_invalido: 'CPF/CNPJ com dígito verificador inválido',
  documento_ja_cadastrado: 'Documento já cadastrado',
  email_invalido: 'E-mail com formato inválido (não importado)',
  telefone_sem_ddd: 'Telefone sem DDD',
  situacao_desconhecida: 'Situação diferente de Ativo/Inativo',
  sem_nome: 'Sem nome',
  nome_repetido_sem_documento: 'Mesmo nome, sem documento',
  ja_importado: 'Já importado antes',
  sem_cedente: 'Sem cedente',
  parcela_nao_reconhecida: 'Parcela fora do padrão N/N',
  valor_invalido: 'Valor inválido',
  valor_nao_positivo: 'Valor zero ou negativo',
  vencimento_invalido: 'Vencimento inválido',
  status_desconhecido: 'Status desconhecido',
  categoria_desconhecida: 'Categoria desconhecida',
  sem_titulo: 'Sem título',
  sem_operand_id: 'Sem ID do Operand',
  operand_id_repetido: 'ID do Operand repetido',
  competencia_invalida: 'Competência inválida',
};

export interface LoteWire {
  id: string;
  kind: TipoDeLote;
  fileName: string;
  sha256: string;
  status: 'em_staging' | 'aplicado' | 'descartado';
  totals: Record<string, number>;
  createdAt: string;
  appliedAt: string | null;
}
export interface ResumoDoLoteWire {
  lote: LoteWire;
  porSituacao: Partial<Record<StatusDaLinha, number>>;
  avisos: Array<{ aviso: string; n: number }>;
}
export interface LinhaWire {
  id: string;
  rowNo: number;
  sourceKey: string;
  raw: Record<string, string | null>;
  normalized: Record<string, unknown>;
  status: StatusDaLinha;
  issues: string[];
  resolvedPartyId: string | null;
}
export interface CedenteWire {
  label: string;
  linhas: number;
  totalCents: number;
  candidatos: Array<{ id: string; name: string; roles: string[] }>;
}
export interface ResultadoDaAplicacao {
  criados: number;
  vinculados: number;
  jaExistiam: number;
  adiados: number;
  pendentes: number;
  loteConcluido: boolean;
}

const RAIZ = ['gestao-empresarial', 'importacao'];

export const useLotes = () => useQuery({ queryKey: [...RAIZ, 'lotes'], queryFn: () => gestaoApi.get<{ items: LoteWire[] }>('/importador/lotes') });
export const useResumoDoLote = (id: string) => useQuery({ queryKey: [...RAIZ, id, 'resumo'], queryFn: () => gestaoApi.get<ResumoDoLoteWire>(`/importador/lotes/${id}`) });
export const useLinhasDoLote = (id: string, f: { status?: string | undefined; aviso?: string | undefined; page: number }) =>
  useQuery({ queryKey: [...RAIZ, id, 'linhas', f], queryFn: () => gestaoApi.get<Paginado<LinhaWire>>(`/importador/lotes/${id}/linhas`, { ...f, pageSize: 25 }), placeholderData: (anterior) => anterior });
export const useCedentes = (id: string, ativo: boolean) => useQuery({ queryKey: [...RAIZ, id, 'cedentes'], enabled: ativo, queryFn: () => gestaoApi.get<{ items: CedenteWire[] }>(`/importador/lotes/${id}/cedentes`) });

/** Qualquer ação do importador mexe no resumo, nas linhas e nos cadastros: invalida o que depende. */
function useAcao<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RAIZ });
      void qc.invalidateQueries({ queryKey: ['gestao-empresarial', 'visao-geral'] });
    },
  });
}

export const useEnviarLote = () => useAcao((v: { kind: TipoDeLote; fileName: string; contentBase64: string }) => gestaoApi.post<{ lote: LoteWire; totals: Record<string, number> }>('/importador/lotes', v));
export const useAplicarLote = (id: string) => useAcao(() => gestaoApi.post<ResultadoDaAplicacao>(`/importador/lotes/${id}/aplicar`));
export const useDescartarLote = (id: string) => useAcao(() => gestaoApi.post<LoteWire>(`/importador/lotes/${id}/descartar`));
export const useVincularPorDocumento = (id: string) => useAcao(() => gestaoApi.post<{ vinculadas: number }>(`/importador/lotes/${id}/vincular-por-documento`));
export const useDecidirLinha = (id: string) => useAcao((v: { rowId: string; decisao: { acao: 'ignorar' } | { acao: 'vincular'; partyId: string } }) => gestaoApi.put<LinhaWire>(`/importador/lotes/${id}/linhas/${v.rowId}/decisao`, v.decisao));
export const useVincularCedente = (id: string) => useAcao((v: { label: string; partyId: string | null }) => gestaoApi.put<{ atualizadas: number }>(`/importador/lotes/${id}/cedentes`, v));

/** Arquivo → base64, em pedaços: `btoa(String.fromCharCode(...bytes))` estoura a pilha num arquivo de alguns MB. */
export async function arquivoParaBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
