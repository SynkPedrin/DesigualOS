import JSZip from 'jszip';

/**
 * Leitor mínimo de .xlsx (um zip de XML): só texto e números das células da primeira aba. Sem
 * fórmula, sem estilo, sem data serial: os relatórios do Operand são tabelas de texto, e ler só
 * isso mantém a superfície de ataque de um arquivo enviado pelo usuário pequena.
 */
const entidades: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const decodificar = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&(lt|gt|quot|apos|amp);/g, (m) => entidades[m]!);
const atributo = (tag: string, nome: string) => new RegExp(`${nome}="([^"]*)"`).exec(tag)?.[1];
const coluna = (ref: string) => [...ref.replace(/\d/g, '')].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** Limites: um relatório legítimo cabe folgado; um zip bomba não. */
const MAX_BYTES_DESCOMPRIMIDOS = 40 * 1024 * 1024;
const MAX_LINHAS = 50_000;

export async function lerXlsx(conteudo: Buffer | Uint8Array): Promise<{ aba: string; linhas: Array<Array<string | null>> }> {
  const zip = await JSZip.loadAsync(conteudo);
  const lerArquivo = async (caminho: string) => {
    const f = zip.file(caminho);
    if (!f) return null;
    const texto = await f.async('string');
    if (texto.length > MAX_BYTES_DESCOMPRIMIDOS) throw new Error('Planilha grande demais.');
    return texto;
  };
  const wb = await lerArquivo('xl/workbook.xml');
  if (!wb) throw new Error('Arquivo não parece ser uma planilha .xlsx.');
  const aba = [...wb.matchAll(/<sheet [^>]*\/>/g)][0]?.[0];
  if (!aba) throw new Error('A planilha não tem nenhuma aba.');
  const rels = (await lerArquivo('xl/_rels/workbook.xml.rels')) ?? '';
  const alvos = new Map([...rels.matchAll(/<Relationship [^>]*\/>/g)].map((m) => [atributo(m[0], 'Id')!, atributo(m[0], 'Target')!]));
  const alvo = alvos.get(atributo(aba, 'r:id') ?? '');
  if (!alvo) throw new Error('Não encontrei os dados da primeira aba.');
  const xml = await lerArquivo(alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`);
  if (!xml) throw new Error('Não encontrei os dados da primeira aba.');
  const ss = await lerArquivo('xl/sharedStrings.xml');
  const compartilhadas = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodificar([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];

  const linhas: Array<Array<string | null>> = [];
  for (const r of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    if (linhas.length >= MAX_LINHAS) throw new Error('Planilha com linhas demais.');
    const linha: Array<string | null> = [];
    for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = atributo(c[1]!, 'r');
      if (!ref) continue;
      const tipo = atributo(c[1]!, 't');
      const corpo = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let valor: string | null = null;
      if (tipo === 's' && v !== undefined) valor = compartilhadas[Number(v)] ?? null;
      else if (tipo === 'inlineStr') valor = decodificar([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (v !== undefined) valor = decodificar(v);
      linha[coluna(ref)] = valor;
    }
    linhas.push(Array.from(linha, (v) => v ?? null));
  }
  return { aba: decodificar(atributo(aba, 'name') ?? ''), linhas };
}
