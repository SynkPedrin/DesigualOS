/**
 * bento-documentos.ts — o Bento passa a LER o que foi anexado.
 *
 * Pedido da operação (29/09/2026): anexar doc, PDF e PPTX no chat, e o Bento
 * ler transcrição de reunião, entender e cruzar com as tasks.
 *
 * Até aqui o anexo era CARGA, não conteúdo: o arquivo subia pra task e ninguém
 * abria. Uma transcrição de reunião de uma hora entrava no ClickUp e o briefing
 * continuava dizendo "[CONFIRMAR: objetivo]" — com o objetivo escrito na ata,
 * a dois cliques de distância.
 *
 * O que dá pra extrair sem dependência nova:
 *
 *   .txt .md .csv   texto direto
 *   .docx           OOXML: zip com word/document.xml
 *   .pptx           OOXML: zip com ppt/slides/slideN.xml
 *
 * PDF fica de fora, e é uma ausência declarada: extrair texto de PDF exige uma
 * biblioteca nova (pdf-parse/pdfjs), e o repositório não tem nenhuma. Enquanto
 * não houver, o PDF continua sendo anexado na task — a pessoa só é avisada de
 * que o conteúdo dele não foi lido, em vez de o Bento fingir que leu.
 */

import JSZip from 'jszip';
import type { Logger } from '@desigual-os/logging';

/** Teto por documento. Transcrição de reunião longa passa disso e é cortada. */
const LIMITE_POR_DOC = 40_000;
/** Teto do bloco inteiro — o que vai pro prompt do turno. */
const LIMITE_DO_BLOCO = 60_000;
/** Arquivo maior que isso não é lido: baixar 25MB por turno não se paga. */
const LIMITE_DE_BYTES = 8 * 1024 * 1024;

export type TipoDeDocumento = 'texto' | 'docx' | 'pptx' | 'pdf' | 'desconhecido';

export function tipoDoArquivo(filename: string, contentType: string | null): TipoDeDocumento {
  const nome = filename.toLowerCase();
  if (/\.(txt|md|csv|vtt|srt)$/.test(nome) || contentType?.startsWith('text/')) return 'texto';
  if (nome.endsWith('.docx')) return 'docx';
  if (nome.endsWith('.pptx')) return 'pptx';
  if (nome.endsWith('.pdf') || contentType === 'application/pdf') return 'pdf';
  return 'desconhecido';
}

/** Tira as tags do XML e devolve o texto, com espaço onde havia fronteira. */
function textoDeXml(xml: string): string {
  return xml
    // Fim de parágrafo/linha vira quebra: sem isso a ata inteira vira um bloco.
    .replace(/<\/(w:p|a:p|w:tr)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function textoDeOoxml(buffer: ArrayBuffer, tipo: 'docx' | 'pptx'): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  if (tipo === 'docx') {
    const doc = zip.file('word/document.xml');
    return doc ? textoDeXml(await doc.async('string')) : '';
  }
  // Slides saem NA ORDEM: slide2 antes de slide10, que a ordenação de string
  // inverteria — e ata de reunião fora de ordem é pior que ata cortada.
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  const partes: string[] = [];
  for (const [i, nome] of slides.entries()) {
    const texto = textoDeXml(await zip.file(nome)!.async('string'));
    if (texto) partes.push(`[Slide ${i + 1}] ${texto}`);
  }
  return partes.join('\n\n');
}

export interface DocumentoLido {
  filename: string;
  tipo: TipoDeDocumento;
  /** Null quando não deu pra ler — o motivo vai em `motivo`. */
  texto: string | null;
  motivo?: string;
  truncado?: boolean;
}

export interface AnexoParaLeitura {
  url: string;
  filename: string;
  contentType: string | null;
}

/**
 * Lê os anexos do turno. NUNCA lança: anexo ilegível vira motivo declarado, e
 * o turno segue — a alternativa seria derrubar um pedido inteiro porque um
 * arquivo estava corrompido.
 */
export async function lerDocumentos(anexos: AnexoParaLeitura[], logger: Logger): Promise<DocumentoLido[]> {
  const out: DocumentoLido[] = [];
  for (const anexo of anexos) {
    const tipo = tipoDoArquivo(anexo.filename, anexo.contentType);
    if (tipo === 'desconhecido') continue;
    if (tipo === 'pdf') {
      out.push({
        filename: anexo.filename,
        tipo,
        texto: null,
        motivo: 'PDF ainda não é lido por este sistema (o arquivo foi anexado na task, mas o conteúdo não entrou na análise)',
      });
      continue;
    }
    try {
      const resposta = await fetch(anexo.url, { signal: AbortSignal.timeout(20_000) });
      if (!resposta.ok) {
        out.push({ filename: anexo.filename, tipo, texto: null, motivo: `não consegui baixar o arquivo (HTTP ${resposta.status})` });
        continue;
      }
      const tamanho = Number(resposta.headers.get('content-length') ?? '0');
      if (tamanho > LIMITE_DE_BYTES) {
        out.push({ filename: anexo.filename, tipo, texto: null, motivo: `arquivo grande demais para ler no turno (${Math.round(tamanho / 1024 / 1024)}MB)` });
        continue;
      }
      const buffer = await resposta.arrayBuffer();
      const bruto = tipo === 'texto' ? new TextDecoder().decode(buffer) : await textoDeOoxml(buffer, tipo);
      const limpo = bruto.trim();
      if (!limpo) {
        out.push({ filename: anexo.filename, tipo, texto: null, motivo: 'o arquivo não tem texto extraível' });
        continue;
      }
      out.push({
        filename: anexo.filename,
        tipo,
        texto: limpo.slice(0, LIMITE_POR_DOC),
        truncado: limpo.length > LIMITE_POR_DOC,
      });
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error);
      logger.warn({ error: detalhe, arquivo: anexo.filename }, '[bento-documentos] não consegui ler o anexo');
      out.push({ filename: anexo.filename, tipo, texto: null, motivo: `falha ao ler: ${detalhe}` });
    }
  }
  return out;
}

/**
 * O bloco que entra no turno. Documento ilegível aparece AQUI também, com o
 * motivo: quem pediu precisa saber que aquele arquivo não foi considerado,
 * senão vai supor que foi.
 */
export function documentosEmTexto(docs: DocumentoLido[]): string | null {
  if (docs.length === 0) return null;
  const partes: string[] = ['MATERIAL ANEXADO NESTE PEDIDO (leia como fonte; não invente nada além do que está aqui):'];
  let orcamento = LIMITE_DO_BLOCO;
  for (const d of docs) {
    if (!d.texto) {
      partes.push(`\n--- ${d.filename} — NÃO LIDO: ${d.motivo} ---`);
      continue;
    }
    const fatia = d.texto.slice(0, Math.max(0, orcamento));
    if (!fatia) break;
    orcamento -= fatia.length;
    const corte = d.truncado || fatia.length < d.texto.length ? ' (trecho inicial; o arquivo é maior)' : '';
    partes.push(`\n--- ${d.filename}${corte} ---\n${fatia}`);
  }
  return partes.join('\n');
}

/** Algum documento foi lido de verdade? Usado pra decidir se vale citar a fonte. */
export function houveLeitura(docs: DocumentoLido[]): boolean {
  return docs.some((d) => d.texto !== null);
}
