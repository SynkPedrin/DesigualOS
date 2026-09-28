/**
 * bento-field-values.ts — tradução de texto humano pros formatos do ClickUp.
 *
 * Nasceu em 28/09/2026, quando o Bento passou a alcançar o resto do ClickUp
 * (estimativa, campos personalizados). A regra é a mesma que vale no resto do
 * agente: **o que não dá pra traduzir com certeza vira ausência, nunca chute**
 * — um campo preenchido errado é pior que um campo vazio, porque ninguém
 * confere o que parece pronto.
 */

import type { ClickUpCustomField } from '@desigual-os/tool-gateway';

const HORA_MS = 3_600_000;
const MINUTO_MS = 60_000;
const DIA_MS = 8 * HORA_MS; // dia ÚTIL, que é como a operação fala "1 dia"

/**
 * "2h", "30min", "1h30", "meio dia", "1 dia e meio" → milissegundos.
 * Null quando não dá pra ler — o campo simplesmente não é escrito.
 */
export function parseEstimativa(texto: string | null | undefined): number | null {
  if (!texto?.trim()) return null;
  const t = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

  if (/\bmeio\s+dia\b/.test(t)) return DIA_MS / 2;
  if (/\bmeia\s+hora\b/.test(t)) return HORA_MS / 2;

  let total = 0;
  let achou = false;

  // "1h30" / "1h 30min" / "1:30"
  const composto = /(\d+)\s*[h:]\s*(\d{1,2})\b(?!\s*d)/.exec(t);
  if (composto) {
    total += Number(composto[1]) * HORA_MS + Number(composto[2]) * MINUTO_MS;
    achou = true;
  } else {
    for (const [re, unidade] of [
      [/(\d+(?:[.,]\d+)?)\s*(?:d|dias?)\b/, DIA_MS],
      [/(\d+(?:[.,]\d+)?)\s*(?:h|horas?|hrs?)\b/, HORA_MS],
      [/(\d+(?:[.,]\d+)?)\s*(?:min|minutos?|mins?)\b/, MINUTO_MS],
    ] as Array<[RegExp, number]>) {
      const m = re.exec(t);
      if (m) {
        total += Number(m[1]!.replace(',', '.')) * unidade;
        achou = true;
      }
    }
  }

  if (/\be\s+meia?\b/.test(t) && achou) total += /dia/.test(t) ? DIA_MS / 2 : HORA_MS / 2;
  if (!achou || total <= 0) return null;
  return Math.round(total);
}

function normaliza(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

export interface ValorDeCampoResolvido {
  fieldId: string;
  fieldName: string;
  /** Já no formato que aquele tipo de campo espera. */
  value: unknown;
  /** Como ficou legível na resposta ao usuário. */
  rotulo: string;
}

export type FalhaDeCampo =
  | { motivo: 'campo_nao_existe'; nome: string; disponiveis: string[] }
  | { motivo: 'opcao_nao_existe'; nome: string; valor: string; disponiveis: string[] }
  | { motivo: 'valor_invalido'; nome: string; valor: string; tipo: string };

/**
 * Resolve UM par "nome do campo": "valor" contra os campos reais da lista.
 *
 * O modelo escreve o que a pessoa falou ("Etapa": "Aprovação"); quem descobre
 * o id do campo e o id da opção é esta função, lendo o que a lista tem. Nome
 * ou opção que não existe vira falha DECLARADA, com as opções disponíveis —
 * é o que permite a pessoa corrigir em vez de adivinhar.
 */
export function resolverCampoPersonalizado(
  campos: ClickUpCustomField[],
  nome: string,
  valor: string,
): ValorDeCampoResolvido | FalhaDeCampo {
  const alvo = normaliza(nome);
  const campo =
    campos.find((c) => normaliza(c.name) === alvo) ?? campos.find((c) => normaliza(c.name).startsWith(alvo));
  if (!campo) return { motivo: 'campo_nao_existe', nome, disponiveis: campos.map((c) => c.name) };

  if (campo.options.length > 0) {
    const valorAlvo = normaliza(valor);
    const opcao =
      campo.options.find((o) => normaliza(o.name) === valorAlvo) ??
      campo.options.find((o) => normaliza(o.name).startsWith(valorAlvo));
    if (!opcao) {
      return { motivo: 'opcao_nao_existe', nome: campo.name, valor, disponiveis: campo.options.map((o) => o.name) };
    }
    return { fieldId: campo.id, fieldName: campo.name, value: opcao.id, rotulo: opcao.name };
  }

  if (campo.type === 'number' || campo.type === 'currency') {
    // Sem dígito não há número: `Number('')` é 0, e gravar 0 num campo de
    // verba porque a pessoa escreveu "a combinar" é pior que não gravar.
    const limpo = valor.replace(/[^\d.,-]/g, '').replace(',', '.');
    const n = Number(limpo);
    if (!/\d/.test(limpo) || !Number.isFinite(n)) {
      return { motivo: 'valor_invalido', nome: campo.name, valor, tipo: campo.type };
    }
    return { fieldId: campo.id, fieldName: campo.name, value: n, rotulo: valor };
  }

  if (campo.type === 'checkbox') {
    const v = /^(sim|true|1|marcado|ok)$/i.test(valor.trim());
    return { fieldId: campo.id, fieldName: campo.name, value: v, rotulo: v ? 'sim' : 'não' };
  }

  // text, short_text, url, email, phone e o que mais o ClickUp aceitar como texto.
  return { fieldId: campo.id, fieldName: campo.name, value: valor, rotulo: valor };
}

export function ehFalhaDeCampo(r: ValorDeCampoResolvido | FalhaDeCampo): r is FalhaDeCampo {
  return 'motivo' in r;
}

/** A frase que o usuário lê quando o campo não pôde ser escrito. */
export function explicarFalhaDeCampo(f: FalhaDeCampo): string {
  if (f.motivo === 'campo_nao_existe') {
    return `não existe o campo "${f.nome}" nessa lista${f.disponiveis.length ? ` (tem: ${f.disponiveis.join(', ')})` : ''}`;
  }
  if (f.motivo === 'opcao_nao_existe') {
    return `"${f.valor}" não é uma opção de "${f.nome}" (as opções são: ${f.disponiveis.join(', ')})`;
  }
  return `"${f.valor}" não serve pro campo "${f.nome}" (tipo ${f.tipo})`;
}
