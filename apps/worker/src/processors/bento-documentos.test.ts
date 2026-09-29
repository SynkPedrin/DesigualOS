import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { tipoDoArquivo, lerDocumentos, documentosEmTexto, houveLeitura } from './bento-documentos';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

/**
 * 29/09/2026: o anexo era CARGA, não conteúdo — subia pra task e ninguém
 * abria. Uma transcrição de reunião de uma hora entrava no ClickUp e o
 * briefing continuava dizendo "[CONFIRMAR: objetivo]", com o objetivo escrito
 * na ata a dois cliques de distância.
 */

describe('que tipo de arquivo é', () => {
  it.each([
    ['ata.txt', null, 'texto'],
    ['reuniao.vtt', null, 'texto'],
    ['notas.md', null, 'texto'],
    ['briefing.docx', null, 'docx'],
    ['apresentacao.pptx', null, 'pptx'],
    ['contrato.pdf', null, 'pdf'],
    ['foto.png', 'image/png', 'desconhecido'],
  ])('%s -> %s', (nome, ct, tipo) => {
    expect(tipoDoArquivo(nome, ct as string | null)).toBe(tipo);
  });
});

async function docx(texto: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document><w:body>${texto.split('\n').map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function pptx(slides: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  // Fora de ordem de propósito: slide10 antes de slide2 pra provar a ordenação.
  for (const [i, s] of slides.entries()) zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><a:p><a:t>${s}</a:t></a:p></p:sld>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

function servir(buffer: ArrayBuffer | string, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    headers: new Headers(headers),
    arrayBuffer: async () => (typeof buffer === 'string' ? new TextEncoder().encode(buffer).buffer : buffer),
  })));
}

describe('o texto sai do arquivo', () => {
  it('lê .txt — o formato mais comum de transcrição', async () => {
    servir('Reunião 28/09. Cliente pediu carrossel de 5 slides e um reels.');
    const r = await lerDocumentos([{ url: 'u', filename: 'ata.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.texto).toContain('carrossel de 5 slides');
  });

  it('lê .docx, e a quebra de parágrafo vira quebra de linha', async () => {
    servir(await docx('Objetivo: gerar orçamento\nPúblico: donas de lavanderia'));
    const r = await lerDocumentos([{ url: 'u', filename: 'briefing.docx', contentType: null }], fakeLogger);
    expect(r[0]?.texto).toContain('Objetivo: gerar orçamento');
    expect(r[0]?.texto).toContain('Público: donas de lavanderia');
  });

  it('lê .pptx com os slides NA ORDEM — ata fora de ordem é pior que ata cortada', async () => {
    servir(await pptx(['Abertura', 'Diagnóstico', 'Proposta']));
    const r = await lerDocumentos([{ url: 'u', filename: 'deck.pptx', contentType: null }], fakeLogger);
    const t = r[0]?.texto ?? '';
    expect(t.indexOf('Abertura')).toBeLessThan(t.indexOf('Diagnóstico'));
    expect(t.indexOf('Diagnóstico')).toBeLessThan(t.indexOf('Proposta'));
    expect(t).toContain('[Slide 2]');
  });

  it('lê .pdf — o formato em que ata de reunião chega mais vezes', async () => {
    vi.unstubAllGlobals();
    const { readFileSync, writeFileSync } = await import('node:fs');
    // PDF mínimo e válido, escrito aqui pra não depender de arquivo no disco.
    writeFileSync('/tmp/_t.pdf', `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 92>>stream
BT /F1 12 Tf 72 720 Td (Cliente pediu carrossel de 5 slides e um reels de 30s.) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`);
    // `Buffer.buffer` do Node aponta pro POOL, com offset — fatiar é obrigatório,
    // senão o parser recebe bytes de outro arquivo.
    const b = readFileSync('/tmp/_t.pdf');
    servir(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const r = await lerDocumentos([{ url: 'u', filename: 'ata.pdf', contentType: 'application/pdf' }], fakeLogger);
    expect(r[0]?.texto).toContain('carrossel de 5 slides');
    // O rodapé de página que a biblioteca insere não pode virar conteúdo.
    expect(r[0]?.texto).not.toMatch(/--\s*1\s+of\s+1\s*--/);
  });

  it('PDF digitalizado (sem texto) é dito, e diz o que fazer', async () => {
    servir('%PDF-1.4\ntrailer<</Root 1 0 R>>');
    const r = await lerDocumentos([{ url: 'u', filename: 'escaneado.pdf', contentType: 'application/pdf' }], fakeLogger);
    expect(r[0]?.texto).toBeNull();
    expect(r[0]?.motivo).toMatch(/digitalizado|extra[íi]vel|falha ao ler/);
  });

  it('imagem não entra na leitura — continua sendo só anexo', async () => {
    expect(await lerDocumentos([{ url: 'u', filename: 'print.png', contentType: 'image/png' }], fakeLogger)).toEqual([]);
  });
});

describe('falha de leitura nunca derruba o turno', () => {
  it('download que falha vira motivo, não exceção', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, headers: new Headers() })));
    const r = await lerDocumentos([{ url: 'u', filename: 'ata.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.texto).toBeNull();
    expect(r[0]?.motivo).toContain('404');
  });

  it('arquivo grande demais é recusado com o tamanho dito', async () => {
    servir('x', { 'content-length': String(20 * 1024 * 1024) });
    const r = await lerDocumentos([{ url: 'u', filename: 'gigante.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.motivo).toContain('grande demais');
  });

  it('arquivo sem texto extraível é declarado', async () => {
    servir('   ');
    const r = await lerDocumentos([{ url: 'u', filename: 'vazio.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.motivo).toContain('não tem texto extraível');
  });
});

describe('o bloco que entra no turno', () => {
  it('diz o que NÃO foi lido — senão quem pediu supõe que foi', () => {
    const bloco = documentosEmTexto([
      { filename: 'ata.txt', tipo: 'texto', texto: 'Cliente pediu o carrossel.' },
      { filename: 'contrato.pdf', tipo: 'pdf', texto: null, motivo: 'PDF ainda não é lido' },
    ])!;
    expect(bloco).toContain('Cliente pediu o carrossel');
    expect(bloco).toContain('contrato.pdf — NÃO LIDO');
  });

  it('instrui a não inventar além do material', () => {
    const bloco = documentosEmTexto([{ filename: 'a.txt', tipo: 'texto', texto: 'texto' }])!;
    expect(bloco).toContain('não invente nada além do que está aqui');
  });

  it('sem documento, sem bloco', () => {
    expect(documentosEmTexto([])).toBeNull();
  });

  it('houveLeitura separa "li" de "tentei ler"', () => {
    expect(houveLeitura([{ filename: 'a.pdf', tipo: 'pdf', texto: null, motivo: 'x' }])).toBe(false);
    expect(houveLeitura([{ filename: 'a.txt', tipo: 'texto', texto: 'oi' }])).toBe(true);
  });
});
