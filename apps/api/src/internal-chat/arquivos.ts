import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Armazenamento privado dos anexos da Comunicação interna.
 *
 * Disco do servidor (volume próprio em produção, INTERNAL_CHAT_FILES_DIR),
 * mesma abordagem da mídia do WhatsApp: o arquivo NUNCA tem URL pública — só
 * sai pela rota da API, que confere se quem pede participa da conversa. Os
 * buckets do Supabase usados até aqui são públicos (quem tem o link abre), e
 * conversa interna não pode ter isso.
 *
 * Validação em três camadas, porque nenhuma basta sozinha:
 *   1. extensão na lista permitida (configurável);
 *   2. tipo declarado pelo navegador compatível com a extensão;
 *   3. ASSINATURA REAL — os primeiros bytes do arquivo. Um executável renomeado
 *      para .pdf passa nas duas primeiras e cai aqui.
 */

export type AttachmentKind = 'image' | 'video' | 'document' | 'archive';

interface Regra {
  kind: AttachmentKind;
  mimes: RegExp;
  assinatura: (cabecalho: Buffer) => boolean;
  /** Tipo servido no download (o declarado pelo navegador não é confiável). */
  servirComo: string;
}

const comeca = (bytes: number[]) => (b: Buffer) => bytes.every((v, i) => b[i] === v);
const zip = (b: Buffer) => comeca([0x50, 0x4b, 0x03, 0x04])(b) || comeca([0x50, 0x4b, 0x05, 0x06])(b);
const ole = comeca([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** MP4/MOV: caixa ISO-BMFF — "ftyp" (ou átomos clássicos do QuickTime) no byte 4. */
const isoBmff = (b: Buffer) => ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(b.subarray(4, 8).toString('latin1'));
/** Texto: sem byte nulo no começo (binário renomeado para .txt/.csv cai aqui). */
const texto = (b: Buffer) => b.length > 0 && !b.includes(0x00);

const REGRAS: Record<string, Regra> = {
  png: { kind: 'image', mimes: /^image\/png$/, assinatura: comeca([0x89, 0x50, 0x4e, 0x47]), servirComo: 'image/png' },
  jpg: { kind: 'image', mimes: /^image\/(jpeg|pjpeg)$/, assinatura: comeca([0xff, 0xd8, 0xff]), servirComo: 'image/jpeg' },
  jpeg: { kind: 'image', mimes: /^image\/(jpeg|pjpeg)$/, assinatura: comeca([0xff, 0xd8, 0xff]), servirComo: 'image/jpeg' },
  webp: { kind: 'image', mimes: /^image\/webp$/, assinatura: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP', servirComo: 'image/webp' },
  gif: { kind: 'image', mimes: /^image\/gif$/, assinatura: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8', servirComo: 'image/gif' },
  pdf: { kind: 'document', mimes: /^application\/(pdf|x-pdf)$/, assinatura: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', servirComo: 'application/pdf' },
  doc: { kind: 'document', mimes: /^application\/(msword|octet-stream)$/, assinatura: ole, servirComo: 'application/msword' },
  xls: { kind: 'document', mimes: /^application\/(vnd\.ms-excel|octet-stream)$/, assinatura: ole, servirComo: 'application/vnd.ms-excel' },
  ppt: { kind: 'document', mimes: /^application\/(vnd\.ms-powerpoint|octet-stream)$/, assinatura: ole, servirComo: 'application/vnd.ms-powerpoint' },
  docx: { kind: 'document', mimes: /^application\/(vnd\.openxmlformats-officedocument\.wordprocessingml\.document|zip|octet-stream)$/, assinatura: zip, servirComo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'document', mimes: /^application\/(vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|zip|octet-stream)$/, assinatura: zip, servirComo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { kind: 'document', mimes: /^application\/(vnd\.openxmlformats-officedocument\.presentationml\.presentation|zip|octet-stream)$/, assinatura: zip, servirComo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  csv: { kind: 'document', mimes: /^(text\/(csv|plain)|application\/(csv|vnd\.ms-excel|octet-stream))$/, assinatura: texto, servirComo: 'text/csv; charset=utf-8' },
  txt: { kind: 'document', mimes: /^(text\/plain|application\/octet-stream)$/, assinatura: texto, servirComo: 'text/plain; charset=utf-8' },
  mp4: { kind: 'video', mimes: /^video\/(mp4|x-m4v)$/, assinatura: isoBmff, servirComo: 'video/mp4' },
  mov: { kind: 'video', mimes: /^video\/(quicktime|mp4)$/, assinatura: isoBmff, servirComo: 'video/quicktime' },
  zip: { kind: 'archive', mimes: /^application\/(zip|x-zip-compressed|octet-stream)$/, assinatura: zip, servirComo: 'application/zip' },
};

const MB = 1024 * 1024;

/**
 * Lista de extensões e limites configuráveis por ambiente. Os padrões cabem no
 * que a infraestrutura atual aceita: o nginx da API está em 110 MB por
 * requisição, por isso vídeo começa em 100 MB (a referência de 250 MB exige
 * subir o client_max_body_size do nginx junto — ver docs/comunicacao-interna.md).
 */
export function politicaDeAnexos() {
  const env = process.env;
  const permitidas = (env.INTERNAL_CHAT_ALLOWED_EXTENSIONS ?? Object.keys(REGRAS).join(','))
    .split(',').map((e) => e.trim().toLowerCase().replace(/^\./, '')).filter((e) => e in REGRAS);
  const limite = (nome: string, padraoMb: number) => Math.max(1, Number(env[nome]) || padraoMb) * MB;
  return {
    permitidas: new Set(permitidas),
    limites: {
      image: limite('INTERNAL_CHAT_MAX_IMAGE_MB', 25),
      document: limite('INTERNAL_CHAT_MAX_DOCUMENT_MB', 25),
      archive: limite('INTERNAL_CHAT_MAX_ARCHIVE_MB', 25),
      video: limite('INTERNAL_CHAT_MAX_VIDEO_MB', 100),
    } satisfies Record<AttachmentKind, number>,
    /** Teto de armazenamento por organização (quota). */
    quotaPorOrganizacao: limite('INTERNAL_CHAT_ORG_QUOTA_MB', 20 * 1024),
  };
}

export class AnexoRecusado extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415 = 400) {
    super(message);
    this.name = 'AnexoRecusado';
  }
}

function raiz(): string {
  return resolve(process.env.INTERNAL_CHAT_FILES_DIR ?? join(homedir(), '.desigualos', 'internal-chat-files'));
}

function dentroDaRaiz(storageKey: string): string {
  const caminho = resolve(raiz(), storageKey);
  if (!caminho.startsWith(`${raiz()}${sep}`)) throw new Error('Caminho de anexo inválido');
  return caminho;
}

export function nomeSeguro(nome: string): string {
  const base = nome.normalize('NFKC').replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '-').trim().slice(0, 180);
  return base || 'arquivo';
}

/** Regra da extensão, ou recusa explicando o que é aceito. */
export function regraPara(filename: string, mimetype: string): { extensao: string; regra: Regra } {
  const extensao = extname(filename).slice(1).toLowerCase();
  const politica = politicaDeAnexos();
  const regra = REGRAS[extensao];
  if (!regra || !politica.permitidas.has(extensao)) {
    throw new AnexoRecusado(`Tipo de arquivo não permitido (.${extensao || '?'}). Aceitos: ${[...politica.permitidas].join(', ')}.`, 415);
  }
  const declarado = mimetype.split(';')[0]!.trim().toLowerCase();
  if (declarado && !regra.mimes.test(declarado)) {
    throw new AnexoRecusado(`O arquivo diz ser ${declarado}, que não combina com .${extensao}.`, 415);
  }
  return { extensao, regra };
}

/** Largura × altura lidas do cabeçalho (PNG, GIF, WEBP, JPEG), sem biblioteca. */
export function dimensoesDaImagem(b: Buffer): { width: number; height: number } | null {
  try {
    if (comeca([0x89, 0x50, 0x4e, 0x47])(b) && b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.subarray(0, 4).toString('latin1') === 'GIF8' && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.subarray(8, 12).toString('latin1') === 'WEBP') {
      const chunk = b.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    }
    if (comeca([0xff, 0xd8])(b)) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i += 1; continue; }
        const marker = b[i + 1]!;
        const tamanho = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        i += 2 + tamanho;
      }
    }
  } catch {
    // cabeçalho inesperado: sem dimensões, a imagem aparece do mesmo jeito
  }
  return null;
}

/**
 * Grava o arquivo EM FLUXO (vídeo de 100 MB não passa inteiro pela memória),
 * contando bytes e cortando no limite do tipo. Assinatura conferida nos
 * primeiros bytes que chegam; arquivo recusado é apagado na hora.
 */
export async function gravarAnexo(input: {
  organizationId: string;
  conversationId: string;
  filename: string;
  mimetype: string;
  stream: Readable;
  usadoPelaOrganizacao: number;
}): Promise<{ storageKey: string; filename: string; kind: AttachmentKind; sizeBytes: number; servirComo: string; width: number | null; height: number | null }> {
  const { extensao, regra } = regraPara(input.filename, input.mimetype);
  const politica = politicaDeAnexos();
  const limite = politica.limites[regra.kind];
  const storageKey = `${input.organizationId}/${input.conversationId}/${randomUUID()}.${extensao}`;
  const destino = dentroDaRaiz(storageKey);
  const temporario = `${destino}.parcial`;
  await mkdir(resolve(destino, '..'), { recursive: true, mode: 0o700 });

  let total = 0;
  let cabecalho = Buffer.alloc(0);
  let recusa: AnexoRecusado | null = null;
  const saida = createWriteStream(temporario, { mode: 0o600, flags: 'wx' });
  try {
    for await (const pedaco of input.stream) {
      const chunk = pedaco as Buffer;
      total += chunk.length;
      if (cabecalho.length < 4096) cabecalho = Buffer.concat([cabecalho, chunk.subarray(0, 4096 - cabecalho.length)]);
      if (total > limite) {
        recusa = new AnexoRecusado(`Arquivo acima do limite de ${Math.round(limite / MB)} MB para ${regra.kind === 'video' ? 'vídeo' : regra.kind === 'image' ? 'imagem' : 'este tipo'}.`, 413);
        break;
      }
      if (input.usadoPelaOrganizacao + total > politica.quotaPorOrganizacao) {
        recusa = new AnexoRecusado('A organização atingiu a quota de armazenamento da Comunicação.', 413);
        break;
      }
      if (!saida.write(chunk)) await new Promise<void>((r) => saida.once('drain', () => r()));
    }
    await new Promise<void>((ok, falha) => saida.end((erro?: Error | null) => (erro ? falha(erro) : ok())));
    if (recusa) throw recusa;
    if (total === 0) throw new AnexoRecusado('Arquivo vazio.');
    if (!regra.assinatura(cabecalho)) {
      throw new AnexoRecusado(`O conteúdo não é um .${extensao} de verdade (assinatura do arquivo não confere).`, 415);
    }
    await rename(temporario, destino);
  } catch (erro) {
    saida.destroy();
    // Fluxo cortado no limite: o resto precisa ser drenado para a requisição terminar.
    input.stream.resume();
    await rm(temporario, { force: true });
    throw erro;
  }
  const dimensoes = regra.kind === 'image' ? dimensoesDaImagem(cabecalho) : null;
  return {
    storageKey,
    filename: nomeSeguro(input.filename),
    kind: regra.kind,
    sizeBytes: total,
    servirComo: regra.servirComo,
    width: dimensoes?.width ?? null,
    height: dimensoes?.height ?? null,
  };
}

/** Tipo a servir no download, pela extensão gravada (nunca o declarado no upload). */
export function tipoParaServir(storageKey: string): string {
  return REGRAS[extname(storageKey).slice(1).toLowerCase()]?.servirComo ?? 'application/octet-stream';
}

/**
 * Leitura com suporte a Range (o player de vídeo do navegador pede pedaços para
 * poder avançar sem baixar tudo).
 */
export async function abrirAnexo(storageKey: string, range: string | undefined) {
  const caminho = dentroDaRaiz(storageKey);
  const { size } = await stat(caminho);
  const pedido = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (pedido && (pedido[1] || pedido[2])) {
    let inicio = pedido[1] ? Number(pedido[1]) : size - Number(pedido[2]);
    let fim = pedido[1] && pedido[2] ? Number(pedido[2]) : size - 1;
    inicio = Math.max(0, inicio);
    fim = Math.min(size - 1, fim);
    if (inicio > fim) return { status: 416 as const, size };
    return { status: 206 as const, size, inicio, fim, stream: createReadStream(caminho, { start: inicio, end: fim }) };
  }
  return { status: 200 as const, size, stream: createReadStream(caminho) };
}

export async function apagarAnexo(storageKey: string): Promise<void> {
  await rm(dentroDaRaiz(storageKey), { force: true });
}

/** Usado só pelos testes: confere que o arquivo existe no disco. */
export async function existeNoDisco(storageKey: string): Promise<boolean> {
  try {
    const handle = await open(dentroDaRaiz(storageKey), 'r');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}
