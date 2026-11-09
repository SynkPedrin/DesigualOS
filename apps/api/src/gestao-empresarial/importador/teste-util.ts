import JSZip from 'jszip';

/** Constrói um .xlsx mínimo em memória, para os testes não dependerem de arquivo de cliente. */
export async function xlsxDe(linhas: string[][]): Promise<Buffer> {
  const col = (i: number) => String.fromCharCode(65 + i);
  const textos: string[] = [];
  const idx = (t: string) => {
    let i = textos.indexOf(t);
    if (i < 0) i = textos.push(t) - 1;
    return i;
  };
  const xml = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => (v === '' ? '' : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`)).join('')}</row>`).join('');
  const z = new JSZip();
  z.file('xl/workbook.xml', '<workbook xmlns:r="x"><sheets><sheet r:id="rId1" sheetId="1" name="Relatório"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${xml}</sheetData></worksheet>`);
  z.file('xl/sharedStrings.xml', `<sst>${textos.map((t) => `<si><t>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

export const CAB_CADASTRO = ['Nome', 'CNPJ / CPF', 'E-mail', 'Telefone', 'Cidade', 'Estado', 'Situação', 'Razão Social'];
export const CAB_LANCAMENTO = ['operand_id', 'venc_pgto', 'competencia', 'faturamento', 'categoria', 'titulo', 'parcela', 'relacionado_codigo', 'relacionado_ref', 'sacado_cedente', 'doc_nf', 'status', 'valor_brl', 'valor_num', 'rel_tipo', 'rel_id', 'ano_venc_pgto'];

export const linhaCadastro = (o: Partial<Record<(typeof CAB_CADASTRO)[number], string>>) => CAB_CADASTRO.map((c) => o[c] ?? '');
export function csvDeLancamentos(linhas: Array<Record<string, string>>): Buffer {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return Buffer.from([CAB_LANCAMENTO.join(','), ...linhas.map((l) => CAB_LANCAMENTO.map((c) => esc(l[c] ?? '')).join(','))].join('\n'));
}
