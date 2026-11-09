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
 *   .pdf            pdf-parse (29/09/2026)
 *
 * PDF entrou depois dos outros, e com uma ressalva que a operação precisa
 * conhecer: PDF **escaneado** é imagem, não texto. Nesses o extrator devolve
 * pouco ou nada, e isso é dito — "o PDF não tem texto extraível (pode ser
 * digitalizado)" — em vez de o Bento fingir que leu uma página em branco.
 */

import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
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
  if (/\.(txt|md|markdown|csv|vtt|srt)$/.test(nome) || contentType?.startsWith('text/')) return 'texto';
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

/**
 * DOCX COM ESTRUTURA (modo do Jarbas, 28/10/2026). O texto corrido de
 * `textoDeXml` serve para ata; para analisar relatório, a estrutura É o
 * conteúdo: título de seção diz o que o número mede, e uma tabela achatada em
 * espaços perde qual valor é de qual coluna. Aqui:
 *   - estilo de título (Heading1..6, "Título1".., inclusive o id "Ttulo1" que
 *     o Word em português grava) vira `#` de Markdown;
 *   - item de lista vira "- ";
 *   - tabela vira linhas `| a | b |`, uma linha por <w:tr>.
 */
export function textoDeDocxEstruturado(xml: string): string {
  const marcado = xml
    .replace(/<w:pStyle w:val="(?:Heading|T[ií]?tulo|Ttulo|Titulo)(\d)"\s*\/>/gi, (_m, n: string) => `@@T${n}@@`)
    .replace(/<w:numPr>/g, '@@LI@@')
    // Parágrafo DENTRO de célula não pode virar quebra de linha: partiria a
    // linha da tabela antes do separador de coluna.
    .replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (celula) => celula.replace(/<\/w:p>/g, ' '))
    .replace(/<\/w:tc>/g, '@@TC@@');
  return textoDeXml(marcado)
    .split('\n')
    .map((linha) => {
      let l = linha.trim();
      const titulo = /@@T(\d)@@/.exec(l);
      if (titulo) l = `${'#'.repeat(Math.min(Number(titulo[1]), 6))} ${l.replace(/@@T\d@@/g, '').trim()}`;
      if (l.includes('@@LI@@')) l = `- ${l.replace(/@@LI@@/g, '').trim()}`;
      if (l.includes('@@TC@@')) {
        const celulas = l.split('@@TC@@').map((c) => c.trim());
        if (celulas.at(-1) === '') celulas.pop();
        l = `| ${celulas.join(' | ')} |`;
      }
      return l.replace(/@@(TC|LI)@@/g, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Tabela detectada no PDF, em Markdown: cabeçalho, separador, linhas. */
export function tabelaEmMarkdown(tabela: string[][]): string {
  const linhas = tabela.filter((l) => l.some((c) => c.trim()));
  if (linhas.length === 0) return '';
  const larg = Math.max(...linhas.map((l) => l.length));
  const fmt = (l: string[]) => `| ${Array.from({ length: larg }, (_, i) => (l[i] ?? '').replace(/\s+/g, ' ').trim()).join(' | ')} |`;
  return [fmt(linhas[0]!), `|${' --- |'.repeat(larg)}`, ...linhas.slice(1).map(fmt)].join('\n');
}

/**
 * PDF COM ESTRUTURA (modo do Jarbas). Cada página leva o marcador
 * `[Página N]` — análise de relatório cita "na página 4", e sem o marcador o
 * modelo não tem como saber. Tabelas que o pdf-parse reconhece pelo desenho
 * da grade entram de novo, em Markdown, logo depois do texto da página: o
 * texto corrido de uma tabela embaralha colunas. Detecção de tabela é
 * melhor-esforço; se falhar, o texto por página continua valendo.
 */
async function textoDePdfEstruturado(buffer: ArrayBuffer, logger: Logger): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const r = await parser.getText();
    let tabelasPorPagina = new Map<number, string[]>();
    try {
      const t = await parser.getTable();
      tabelasPorPagina = new Map(
        t.pages.map((p) => [p.num, p.tables.map(tabelaEmMarkdown).filter(Boolean)] as const).filter(([, ts]) => ts.length > 0),
      );
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, '[documentos] tabelas do PDF não detectadas; segue só o texto');
    }
    const paginas = (r.pages ?? []).length ? r.pages : [{ num: 1, text: r.text ?? '' }];
    return paginas
      .map((p) => {
        const texto = (p.text ?? '').replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '').trim();
        const tabelas = tabelasPorPagina.get(p.num) ?? [];
        const blocoTabelas = tabelas.length ? `\n\nTabelas detectadas na página ${p.num}:\n${tabelas.join('\n\n')}` : '';
        return texto || blocoTabelas ? `[Página ${p.num}]\n${texto}${blocoTabelas}` : '';
      })
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } finally {
    await parser.destroy?.().catch(() => undefined);
  }
}

/**
 * Texto de PDF. O rodapé "-- N of M --" que a biblioteca insere entre páginas
 * sai fora: numa ata de reunião ele vira ruído no meio da frase, e o modelo
 * passa a tratá-lo como conteúdo.
 */
async function textoDePdf(buffer: ArrayBuffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const r = await parser.getText();
    return (r.text ?? '')
      .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } finally {
    await parser.destroy?.().catch(() => undefined);
  }
}

async function textoDeOoxml(buffer: ArrayBuffer, tipo: 'docx' | 'pptx', estruturado = false): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  if (tipo === 'docx') {
    const doc = zip.file('word/document.xml');
    if (!doc) return '';
    const xml = await doc.async('string');
    return estruturado ? textoDeDocxEstruturado(xml) : textoDeXml(xml);
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
 * O Bento lê ata: texto corrido, 40 mil caracteres, 8 MB. O Jarbas analisa
 * relatório: estrutura preservada (página, título, tabela) e documento
 * inteiro — o corte acontece depois, no motor de análise, que sabe dividir.
 */
export interface OpcoesDeLeitura {
  limitePorDoc?: number;
  limiteDeBytes?: number;
  estruturado?: boolean;
}

/**
 * Só se baixa anexo do storage do NOSSO Supabase — é para lá que todo upload
 * legítimo vai (web: /uploads; WhatsApp: guardarAnexo → uploadUserFile).
 * Sem isso, `POST /chat` com `{url: "http://169.254.169.254/..."}` fazia o
 * worker buscar endereço interno e devolver o conteúdo na resposta do agente
 * (auditoria de 23/10/2026; trazido para cá quando o Jarbas passou a ler
 * anexos, porque cada agente que lê aumenta a superfície).
 */
export function anexoDoNossoStorage(url: string, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const alvo = new URL(url);
    const base = new URL(supabaseUrl);
    return alvo.origin === base.origin && alvo.pathname.startsWith('/storage/v1/object/public/');
  } catch {
    return false;
  }
}

/**
 * Lê os anexos do turno. NUNCA lança: anexo ilegível vira motivo declarado, e
 * o turno segue — a alternativa seria derrubar um pedido inteiro porque um
 * arquivo estava corrompido.
 */
export async function lerDocumentos(anexos: AnexoParaLeitura[], logger: Logger, opcoes: OpcoesDeLeitura = {}): Promise<DocumentoLido[]> {
  const limitePorDoc = opcoes.limitePorDoc ?? LIMITE_POR_DOC;
  const limiteDeBytes = opcoes.limiteDeBytes ?? LIMITE_DE_BYTES;
  const out: DocumentoLido[] = [];
  for (const anexo of anexos) {
    const tipo = tipoDoArquivo(anexo.filename, anexo.contentType);
    if (tipo === 'desconhecido') continue;
    if (!anexoDoNossoStorage(anexo.url, process.env.SUPABASE_URL)) {
      logger.warn({ filename: anexo.filename }, '[documentos] anexo fora do storage recusado');
      out.push({ filename: anexo.filename, tipo, texto: null, motivo: 'arquivo fora do armazenamento do Desigual OS — envie pelo anexo do chat' });
      continue;
    }
    try {
      // `redirect: 'error'`: o storage não redireciona; um 30x só serviria
      // para levar o download a outro endereço depois da checagem acima.
      const resposta = await fetch(anexo.url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
      if (!resposta.ok) {
        out.push({ filename: anexo.filename, tipo, texto: null, motivo: `não consegui baixar o arquivo (HTTP ${resposta.status})` });
        continue;
      }
      const tamanho = Number(resposta.headers.get('content-length') ?? '0');
      if (tamanho > limiteDeBytes) {
        out.push({ filename: anexo.filename, tipo, texto: null, motivo: `arquivo grande demais para ler no turno (${Math.round(tamanho / 1024 / 1024)}MB)` });
        continue;
      }
      const buffer = await resposta.arrayBuffer();
      if (buffer.byteLength > limiteDeBytes) {
        out.push({ filename: anexo.filename, tipo, texto: null, motivo: `arquivo grande demais para ler no turno (${Math.round(buffer.byteLength / 1024 / 1024)}MB)` });
        continue;
      }
      const bruto =
        tipo === 'texto'
          ? new TextDecoder().decode(buffer)
          : tipo === 'pdf'
            ? opcoes.estruturado
              ? await textoDePdfEstruturado(buffer, logger)
              : await textoDePdf(buffer)
            : await textoDeOoxml(buffer, tipo, opcoes.estruturado);
      const limpo = bruto.trim();
      if (!limpo) {
        out.push({
          filename: anexo.filename,
          tipo,
          texto: null,
          // PDF vazio quase sempre é digitalização: dizer isso poupa a pessoa
          // de reenviar o mesmo arquivo achando que foi falha de upload.
          motivo:
            tipo === 'pdf'
              ? 'o PDF não tem texto extraível (provavelmente é digitalizado/imagem — mande a versão em texto ou o .docx)'
              : 'o arquivo não tem texto extraível',
        });
        continue;
      }
      out.push({
        filename: anexo.filename,
        tipo,
        texto: limpo.slice(0, limitePorDoc),
        truncado: limpo.length > limitePorDoc,
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
