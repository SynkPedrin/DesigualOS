/**
 * CSV no formato RFC 4180: campos entre aspas podem ter vírgula, quebra de linha e aspas duplas
 * escapadas (`""`). Dividir por vírgula (a primeira tentativa na auditoria) quebra qualquer
 * título com vírgula e produz números que parecem certos e não são.
 */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ',') {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.length > 1 || linha[0] !== '') linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  if (aspas) throw new Error('CSV com aspas sem fechar.');
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}
