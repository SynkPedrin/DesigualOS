import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { anexoDoNossoStorage, tabelaEmMarkdown, textoDeDocxEstruturado, tipoDoArquivo, lerDocumentos, documentosEmTexto, houveLeitura } from './bento-documentos';

const SUPABASE = 'https://projeto.supabase.co';
process.env.SUPABASE_URL = SUPABASE;
const u = `${SUPABASE}/storage/v1/object/public/user-uploads/abc/arquivo`;

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
    const r = await lerDocumentos([{ url: u, filename: 'ata.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.texto).toContain('carrossel de 5 slides');
  });

  it('lê .docx, e a quebra de parágrafo vira quebra de linha', async () => {
    servir(await docx('Objetivo: gerar orçamento\nPúblico: donas de lavanderia'));
    const r = await lerDocumentos([{ url: u, filename: 'briefing.docx', contentType: null }], fakeLogger);
    expect(r[0]?.texto).toContain('Objetivo: gerar orçamento');
    expect(r[0]?.texto).toContain('Público: donas de lavanderia');
  });

  it('lê .pptx com os slides NA ORDEM — ata fora de ordem é pior que ata cortada', async () => {
    servir(await pptx(['Abertura', 'Diagnóstico', 'Proposta']));
    const r = await lerDocumentos([{ url: u, filename: 'deck.pptx', contentType: null }], fakeLogger);
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
    const r = await lerDocumentos([{ url: u, filename: 'ata.pdf', contentType: 'application/pdf' }], fakeLogger);
    expect(r[0]?.texto).toContain('carrossel de 5 slides');
    // O rodapé de página que a biblioteca insere não pode virar conteúdo.
    expect(r[0]?.texto).not.toMatch(/--\s*1\s+of\s+1\s*--/);
  });

  it('PDF digitalizado (sem texto) é dito, e diz o que fazer', async () => {
    servir('%PDF-1.4\ntrailer<</Root 1 0 R>>');
    const r = await lerDocumentos([{ url: u, filename: 'escaneado.pdf', contentType: 'application/pdf' }], fakeLogger);
    expect(r[0]?.texto).toBeNull();
    expect(r[0]?.motivo).toMatch(/digitalizado|extra[íi]vel|falha ao ler/);
  });

  it('imagem não entra na leitura — continua sendo só anexo', async () => {
    expect(await lerDocumentos([{ url: u, filename: 'print.png', contentType: 'image/png' }], fakeLogger)).toEqual([]);
  });
});

describe('falha de leitura nunca derruba o turno', () => {
  it('download que falha vira motivo, não exceção', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, headers: new Headers() })));
    const r = await lerDocumentos([{ url: u, filename: 'ata.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.texto).toBeNull();
    expect(r[0]?.motivo).toContain('404');
  });

  it('arquivo grande demais é recusado com o tamanho dito', async () => {
    servir('x', { 'content-length': String(20 * 1024 * 1024) });
    const r = await lerDocumentos([{ url: u, filename: 'gigante.txt', contentType: 'text/plain' }], fakeLogger);
    expect(r[0]?.motivo).toContain('grande demais');
  });

  it('arquivo sem texto extraível é declarado', async () => {
    servir('   ');
    const r = await lerDocumentos([{ url: u, filename: 'vazio.txt', contentType: 'text/plain' }], fakeLogger);
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

/** SSRF (auditoria de 23/10/2026): o worker baixava qualquer URL e devolvia o texto na resposta. */
describe('só baixa do nosso storage', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://127.0.0.1:3001/health'],
    ['http://100.107.198.50:11434/api/tags'],
    ['https://projeto.supabase.co.atacante.com/storage/v1/object/public/x.txt'],
    ['https://projeto.supabase.co/rest/v1/users'],
    ['file:///etc/passwd'],
    ['nem-url'],
  ])('recusa %s', (url) => {
    expect(anexoDoNossoStorage(url, SUPABASE)).toBe(false);
  });

  it('aceita o arquivo público do nosso storage, e recusa tudo sem SUPABASE_URL', () => {
    expect(anexoDoNossoStorage(u, SUPABASE)).toBe(true);
    expect(anexoDoNossoStorage(u, undefined)).toBe(false);
  });

  it('anexo recusado não chega a ser baixado e vira motivo declarado', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    const r = await lerDocumentos([{ url: 'http://169.254.169.254/x.txt', filename: 'x.txt', contentType: 'text/plain' }], fakeLogger);
    expect(buscar).not.toHaveBeenCalled();
    expect(r[0]?.motivo).toMatch(/fora do armazenamento/);
  });
});

/** Modo do Jarbas (28/10/2026): relatório perde sentido sem título, lista, tabela e página. */
describe('leitura estruturada (Jarbas)', () => {
  it('DOCX: título vira #, lista vira -, tabela vira | a | b |', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Resultados de setembro</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Ttulo2"/></w:pPr><w:r><w:t>Meta Ads</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>CPL caiu</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Campanha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Investimento</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Leads</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>R$ 1.200,00</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>';
    const t = textoDeDocxEstruturado(xml);
    expect(t).toContain('# Resultados de setembro');
    expect(t).toContain('## Meta Ads');
    expect(t).toContain('- CPL caiu');
    expect(t).toContain('| Campanha | Investimento |');
    expect(t).toContain('| Leads | R$ 1.200,00 |');
  });

  it('tabela de PDF vira Markdown com cabeçalho, sem linha vazia', () => {
    const md = tabelaEmMarkdown([['Canal', 'Cliques'], ['', ''], ['Meta', ' 1.500 '], ['Google']]);
    expect(md.split('\n')).toEqual(['| Canal | Cliques |', '| --- | --- |', '| Meta | 1.500 |', '| Google |  |']);
  });

  it('PDF: cada página leva [Página N]', async () => {
    vi.unstubAllGlobals();
    const { readFileSync, writeFileSync } = await import('node:fs');
    const pagina = (n: number, texto: string) =>
      `${n} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${n + 1} 0 R/Resources<</Font<</F1 9 0 R>>>>>>endobj
${n + 1} 0 obj<</Length ${texto.length + 30}>>stream
BT /F1 12 Tf 72 720 Td (${texto}) Tj ET
endstream
endobj`;
    writeFileSync(
      '/tmp/_t2.pdf',
      `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>endobj
${pagina(3, 'Resumo executivo do mes')}
${pagina(5, 'Investimento total 4.200')}
9 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`,
    );
    const b = readFileSync('/tmp/_t2.pdf');
    servir(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const r = await lerDocumentos([{ url: u, filename: 'relatorio.pdf', contentType: 'application/pdf' }], fakeLogger, { estruturado: true });
    const t = r[0]?.texto ?? '';
    expect(t).toContain('[Página 1]');
    expect(t).toContain('[Página 2]');
    expect(t.indexOf('Resumo executivo')).toBeLessThan(t.indexOf('[Página 2]'));
    expect(t.indexOf('Investimento total')).toBeGreaterThan(t.indexOf('[Página 2]'));
  });

  it('.markdown também é texto', () => {
    expect(tipoDoArquivo('plano.markdown', null)).toBe('texto');
  });

  it('o limite por documento do Jarbas é o que ele pedir, e o corte é declarado', async () => {
    servir('x'.repeat(100_000));
    const r = await lerDocumentos([{ url: u, filename: 'longo.md', contentType: 'text/markdown' }], fakeLogger, { limitePorDoc: 90_000 });
    expect(r[0]?.texto).toHaveLength(90_000);
    expect(r[0]?.truncado).toBe(true);
  });
});
