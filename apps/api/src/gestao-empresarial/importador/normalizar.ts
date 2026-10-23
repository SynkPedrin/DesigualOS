import { centavosDeTexto, ErroDeValor } from '../dominio/dinheiro';
import { isoDeBR } from '../dominio/datas';
import { emailValido, lerDocumento, normalizarNome, soDigitos, textoOuNulo } from '../dominio/documentos';
import { lerParcela } from '../dominio/parcelas';
import { ErroDeNegocio } from '../http';
import { lerCsv } from './csv';
import { lerXlsx } from './xlsx';

export type TipoDeLote = 'clientes' | 'fornecedores' | 'veiculos_midia' | 'lancamentos';
export type StatusDaLinha = 'novo' | 'duplicado_provavel' | 'invalido' | 'precisa_vinculo';

export interface LinhaPreparada {
  rowNo: number;
  sourceKey: string;
  raw: Record<string, string | null>;
  normalized: Record<string, unknown>;
  status: StatusDaLinha;
  issues: string[];
}

export const PAPEL_DO_TIPO = { clientes: 'cliente', fornecedores: 'fornecedor', veiculos_midia: 'veiculo_midia' } as const;

const COLUNAS_CADASTRO = ['Nome', 'CNPJ / CPF', 'E-mail', 'Telefone', 'Cidade', 'Estado', 'Situação'];
const COLUNAS_LANCAMENTO = ['operand_id', 'venc_pgto', 'competencia', 'categoria', 'titulo', 'parcela', 'relacionado_codigo', 'rel_tipo', 'rel_id', 'sacado_cedente', 'status', 'valor_num'];

function comoRegistros(linhas: Array<Array<string | null>>, obrigatorias: string[], descricao: string) {
  const [cab, ...dados] = linhas;
  const faltando = obrigatorias.filter((c) => !cab?.includes(c));
  if (!cab || faltando.length > 0) throw new ErroDeNegocio(422, `O arquivo não parece ser ${descricao}: faltam as colunas ${faltando.join(', ')}.`);
  return dados
    .map((l, i) => ({ rowNo: i + 2, registro: Object.fromEntries(cab.filter((c): c is string => !!c).map((c) => [c, l[cab.indexOf(c)] ?? null])) as Record<string, string | null> }))
    .filter((r) => Object.values(r.registro).some((v) => v !== null && v.trim() !== ''));
}

/** O DDD faltando é DADO FALTANTE: marca, não completa. */
const telefoneSemDdd = (tel: string | null) => !!tel && [8, 9].includes(soDigitos(tel).length);

export function prepararCadastros(tipo: Exclude<TipoDeLote, 'lancamentos'>, linhas: Array<Array<string | null>>): LinhaPreparada[] {
  const registros = comoRegistros(linhas, COLUNAS_CADASTRO, `um relatório de ${tipo.replace('_', ' ')}`);
  const vistos = new Map<string, number>();
  const docsVistos = new Map<string, number>();
  return registros.map(({ rowNo, registro: r }) => {
    const issues: string[] = [];
    const nome = textoOuNulo(r['Nome']);
    const doc = lerDocumento(r['CNPJ / CPF']);
    const emailBruto = textoOuNulo(r['E-mail']);
    const email = emailBruto && emailValido(emailBruto) ? emailBruto : null;
    const telefone = textoOuNulo(r['Telefone']);
    const situacao = textoOuNulo(r['Situação']);
    if (emailBruto && !email) issues.push('email_invalido');
    if (!doc.document) issues.push('documento_ausente');
    else if (doc.valid === false) issues.push('documento_invalido');
    if (telefoneSemDdd(telefone)) issues.push('telefone_sem_ddd');
    if (situacao !== 'Ativo' && situacao !== 'Inativo') issues.push('situacao_desconhecida');

    const base = doc.document ? `doc:${doc.document}` : `nome:${normalizarNome(nome)}|${normalizarNome(r['Cidade'])}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    const sourceKey = n === 1 ? base : `${base}#${n}`;
    let status: StatusDaLinha = 'novo';
    if (!nome) {
      issues.push('sem_nome');
      status = 'invalido';
    } else if (doc.document && n > 1) {
      issues.push(`documento_repetido_na_linha_${docsVistos.get(doc.document)}`);
      status = 'duplicado_provavel';
    }
    if (doc.document && !docsVistos.has(doc.document)) docsVistos.set(doc.document, rowNo);
    if (!doc.document && n > 1) issues.push('nome_repetido_sem_documento');

    return {
      rowNo,
      sourceKey,
      raw: r,
      normalized: {
        name: nome,
        legalName: textoOuNulo(r['Razão Social']),
        document: doc.document,
        rawDocument: textoOuNulo(r['CNPJ / CPF']),
        documentKind: doc.kind,
        documentValid: doc.valid,
        email,
        phone: telefone,
        city: textoOuNulo(r['Cidade']),
        state: textoOuNulo(r['Estado'])?.toUpperCase() ?? null,
        active: situacao !== 'Inativo',
        role: PAPEL_DO_TIPO[tipo],
      },
      status,
      issues,
    };
  });
}

const STATUS_DO_OPERAND: Record<string, 'aberto' | 'quitado' | 'cancelado'> = { 'Em Aberto': 'aberto', Quitado: 'quitado', Cancelado: 'cancelado' };
const CATEGORIA_DO_OPERAND: Record<string, 'receita' | 'despesa'> = { Receitas: 'receita', Despesas: 'despesa' };

export function prepararLancamentos(linhas: Array<Array<string | null>>): LinhaPreparada[] {
  const registros = comoRegistros(linhas, COLUNAS_LANCAMENTO, 'um export de lançamentos');
  const chaves = new Set<string>();
  return registros.map(({ rowNo, registro: r }) => {
    const issues: string[] = [];
    const id = textoOuNulo(r['operand_id']);
    const status = STATUS_DO_OPERAND[textoOuNulo(r['status']) ?? ''];
    const kind = CATEGORIA_DO_OPERAND[textoOuNulo(r['categoria']) ?? ''];
    const dueDate = isoDeBR(r['venc_pgto'] ?? '');
    const competenceDate = isoDeBR(r['competencia'] ?? '');
    const descricao = textoOuNulo(r['titulo']);
    let amountCents: number | null = null;
    try {
      amountCents = centavosDeTexto(r['valor_num'] ?? '');
      if (amountCents <= 0) {
        issues.push('valor_nao_positivo');
        amountCents = null;
      }
    } catch (e) {
      if (!(e instanceof ErroDeValor)) throw e;
      issues.push('valor_invalido');
    }
    if (!id) issues.push('sem_operand_id');
    else if (chaves.has(id)) issues.push('operand_id_repetido');
    if (id) chaves.add(id);
    if (!status) issues.push('status_desconhecido');
    if (!kind) issues.push('categoria_desconhecida');
    if (!dueDate) issues.push('vencimento_invalido');
    if (r['competencia'] && !competenceDate) issues.push('competencia_invalida');
    if (!descricao) issues.push('sem_titulo');

    const textoParcela = textoOuNulo(r['parcela']);
    const parcela = lerParcela(textoParcela);
    if (textoParcela && !parcela) issues.push('parcela_nao_reconhecida');
    const cedente = textoOuNulo(r['sacado_cedente']);
    if (!cedente) issues.push('sem_cedente');

    const bloqueios = ['valor_invalido', 'valor_nao_positivo', 'sem_operand_id', 'operand_id_repetido', 'status_desconhecido', 'categoria_desconhecida', 'vencimento_invalido', 'sem_titulo'];
    const invalido = issues.some((i) => bloqueios.includes(i));
    return {
      rowNo,
      sourceKey: id ?? `linha:${rowNo}`,
      raw: r,
      normalized: {
        kind,
        description: descricao,
        amountCents,
        dueDate,
        competenceDate,
        status,
        partyLabel: cedente,
        installmentNo: parcela?.numero ?? null,
        installmentTotal: parcela?.total ?? null,
        parcelaOriginal: textoParcela,
        relatedKind: textoOuNulo(r['rel_tipo']),
        relatedRef: textoOuNulo(r['relacionado_codigo']),
        docNumber: textoOuNulo(r['doc_nf']),
      },
      // Sem vínculo com um cadastro o lançamento NÃO entra: um humano decide quem é o cedente.
      status: invalido ? 'invalido' : cedente ? 'precisa_vinculo' : 'novo',
      issues,
    };
  });
}

/** Lê o arquivo bruto conforme o tipo: cadastros vêm em .xlsx, lançamentos em .csv. */
export async function lerArquivoDoLote(tipo: TipoDeLote, nomeDoArquivo: string, conteudo: Buffer): Promise<Array<Array<string | null>>> {
  const ext = nomeDoArquivo.toLowerCase().split('.').pop();
  try {
    if (tipo === 'lancamentos') {
      if (ext !== 'csv') throw new ErroDeNegocio(422, 'Lançamentos devem ser enviados em .csv.');
      return lerCsv(conteudo.toString('utf8'));
    }
    if (ext !== 'xlsx') throw new ErroDeNegocio(422, 'Cadastros devem ser enviados em .xlsx.');
    return (await lerXlsx(conteudo)).linhas;
  } catch (e) {
    if (e instanceof ErroDeNegocio) throw e;
    throw new ErroDeNegocio(422, `Não consegui ler o arquivo: ${e instanceof Error ? e.message : 'formato inválido'}.`);
  }
}
