import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * vault-writer.ts — conhecimento consolidado vira documento legível por humano.
 *
 * A auditoria de 16/09/2026 mudou o desenho deste módulo, e vale registrar por
 * quê: o vault que o node do Otto lê (`Brain-Marketing`, 196 arquivos) é TEORIA
 * de marketing — funil de demanda, STP, GTM, arquitetura de marca. Não existe
 * um único arquivo de cliente lá. Escrever preferência de cliente dentro dele
 * misturaria duas coisas de naturezas diferentes e poluiria a recuperação de
 * teoria, que é o que aquele vault existe para servir.
 *
 * Por isso o writer tem namespace próprio por cliente, e o Postgres continua
 * sendo a verdade estruturada: o vault é a REPRESENTAÇÃO consolidada, não a
 * fonte. Se os dois divergirem, o banco está certo e o vault é regerado.
 *
 * Três garantias, todas exigidas por experiência ruim anterior:
 *
 *  - IDEMPOTÊNCIA por seção e por chave. Consolidação roda todo dia; append
 *    cego transformaria "copies mais diretas" em vinte linhas iguais em três
 *    semanas.
 *  - SUPERSESSÃO visível. Regra substituída sai da seção corrente e vai para o
 *    histórico, com data. Duas regras contraditórias apresentadas como atuais é
 *    pior que nenhuma.
 *  - ISOLAMENTO de ambiente. Conhecimento de QA nunca escreve no vault de
 *    produção; vai para um namespace separado.
 */

export interface ConhecimentoParaVault {
  /** Identifica a regra dentro da seção. Reescrever a MESMA chave substitui. */
  chave: string;
  conteudo: string;
  /** De onde veio: episódio, memória, task. Sem isto a linha não é auditável. */
  sourceRefs: string[];
  atualizadoEm: Date;
}

export interface DestinoDoVault {
  raiz: string;
  clienteSlug: string;
  environment: string;
  /** Seção determinística: "Preferências consolidadas", "Decisões". */
  secao: string;
}

/** Cabeçalho de seção usado para achar e reescrever o bloco certo. */
const marcaDeSecao = (secao: string) => `## ${secao}`;
const MARCA_HISTORICO = '## Histórico de regras substituídas';

/**
 * Caminho do arquivo. QA vai para um namespace separado — não é detalhe de
 * organização: é a barreira que impede conhecimento de teste virar documento
 * institucional.
 */
export function caminhoDoVault(destino: DestinoDoVault): string {
  const base = destino.environment === 'production'
    ? join(destino.raiz, 'clientes')
    : join(destino.raiz, '_qa', 'clientes');
  return resolve(join(base, `${destino.clienteSlug}.md`));
}

function linhaDaRegra(k: ConhecimentoParaVault): string {
  const data = k.atualizadoEm.toISOString().slice(0, 10);
  const fontes = k.sourceRefs.length > 0 ? ` <!-- ${k.sourceRefs.slice(0, 5).join(' ')} -->` : '';
  return `- **${k.chave}**: ${k.conteudo.trim()} _(${data})_${fontes}`;
}

/** A linha já existe nesta seção? Compara pela CHAVE, não pelo texto. */
function indiceDaChave(linhas: string[], chave: string): number {
  const alvo = `- **${chave}**:`;
  return linhas.findIndex((l) => l.startsWith(alvo));
}

export interface ResultadoDoVault {
  caminho: string;
  acao: 'criado' | 'atualizado' | 'inalterado';
  /** Regra anterior que saiu da seção corrente, quando houve substituição. */
  substituiu: string | null;
}

/**
 * Escreve (ou atualiza) uma regra consolidada. Rodar duas vezes com o mesmo
 * conteúdo não muda nada — é isso que `inalterado` reporta.
 */
export async function escreverNoVault(
  destino: DestinoDoVault,
  conhecimento: ConhecimentoParaVault,
): Promise<ResultadoDoVault> {
  const caminho = caminhoDoVault(destino);
  await mkdir(dirname(caminho), { recursive: true });

  const existente = await readFile(caminho, 'utf8').catch(() => '');
  const linhas = existente.length > 0
    ? existente.split('\n')
    : [`# ${destino.clienteSlug}`, '', '> Conhecimento consolidado pelo Desigual OS. A verdade estruturada vive no banco; este arquivo é a representação legível.', ''];

  const cabecalho = marcaDeSecao(destino.secao);
  let inicio = linhas.findIndex((l) => l.trim() === cabecalho);
  if (inicio === -1) {
    linhas.push('', cabecalho, '');
    inicio = linhas.length - 2;
  }

  // Fim da seção: próximo cabeçalho de mesmo nível ou fim do arquivo.
  let fim = linhas.findIndex((l, i) => i > inicio && l.startsWith('## '));
  if (fim === -1) fim = linhas.length;

  const corpo = linhas.slice(inicio + 1, fim);
  const nova = linhaDaRegra(conhecimento);
  const jaEsta = indiceDaChave(corpo, conhecimento.chave);

  let acao: ResultadoDoVault['acao'] = 'criado';
  let substituiu: string | null = null;

  if (jaEsta !== -1) {
    const anterior = corpo[jaEsta]!;
    if (anterior === nova) {
      // Idempotência: nada mudou, não reescreve o arquivo.
      return { caminho, acao: 'inalterado', substituiu: null };
    }
    corpo[jaEsta] = nova;
    substituiu = anterior;
    acao = 'atualizado';
  } else {
    corpo.push(nova);
  }

  const atualizadas = [...linhas.slice(0, inicio + 1), ...corpo, ...linhas.slice(fim)];

  // Supersessão VISÍVEL: a regra antiga não some, muda de seção. Some sem
  // rastro seria perder o porquê da mudança.
  if (substituiu) {
    let iHist = atualizadas.findIndex((l) => l.trim() === MARCA_HISTORICO);
    if (iHist === -1) {
      atualizadas.push('', MARCA_HISTORICO, '');
      iHist = atualizadas.length - 2;
    }
    const data = conhecimento.atualizadoEm.toISOString().slice(0, 10);
    atualizadas.splice(iHist + 1, 0, `${substituiu.replace(/^- /, '- [substituída em ' + data + '] ')}`);
  }

  const texto = atualizadas.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  await writeFile(caminho, texto, 'utf8');
  return { caminho, acao, substituiu };
}

/** Read-back: lê o que ficou gravado. Escrever sem reler não é escrever. */
export async function lerDoVault(destino: DestinoDoVault): Promise<string> {
  return readFile(caminhoDoVault(destino), 'utf8').catch(() => '');
}
