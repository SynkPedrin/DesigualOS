/**
 * parse-due-date.ts — data falada em PT-BR vira data EXPLÍCITA antes da escrita.
 *
 * Nasce do incidente de 24/09/2026: "altere a data do item 11 para o dia 28 de
 * setembro de 2026" não tinha parser de data extensa, a intenção não classificou,
 * e o fallback CRIOU uma task nova em vez de atualizar a existente. A data tem
 * que resolver ANTES de qualquer tool call — e se não resolve, pergunta, nunca
 * inventa.
 *
 * Tudo é ponto-no-tempo (fim do dia, America/Sao_Paulo em horário civil local):
 *   "28 de setembro de 2026" | "28/09/2026" | "dia 28" | "amanhã" | "sexta"
 *   "próxima segunda" | "fim do mês" | "semana que vem" (segunda da próxima)
 */

const MESES: Record<string, number> = {
  janeiro: 0, fevereiro: 1, 'março': 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

/** 0 = domingo ... 6 = sábado (getDay). */
const DIAS_SEMANA: Record<string, number> = {
  domingo: 0, segunda: 1, 'terça': 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, 'sábado': 6, sabado: 6,
};

function fimDoDia(d: Date): Date {
  const f = new Date(d);
  f.setHours(23, 59, 59, 999);
  return f;
}

function proximoDiaDaSemana(now: Date, alvo: number): Date {
  const d = new Date(now);
  let delta = (alvo - d.getDay() + 7) % 7;
  // O dia de hoje nunca é o alvo: "sexta" dita numa sexta = a PRÓXIMA sexta.
  if (delta === 0) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * Extrai a data-alvo da frase, ou null quando não há data reconhecível.
 * Quem chama decide entre perguntar e seguir sem prazo — null nunca vira
 * "hoje" por acidente.
 */
export function parseDataNatural(texto: string, now: Date = new Date()): number | null {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // "28 de setembro de 2026" / "28 de setembro" (ano: corrente, ou o próximo
  // se a data já passou — ninguém pede prazo pro passado)
  const extensa = t.match(/\b(?:dia\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?(?=\s|$|[,.!?])/);
  if (extensa && MESES[extensa[2]!] !== undefined) {
    const dia = Number(extensa[1]);
    const mes = MESES[extensa[2]!]!;
    let ano = extensa[3] ? Number(extensa[3]) : now.getFullYear();
    if (dia < 1 || dia > 31) return null;
    let candidato = fimDoDia(new Date(ano, mes, dia));
    if (!extensa[3] && candidato.getTime() < now.getTime()) {
      ano += 1;
      candidato = fimDoDia(new Date(ano, mes, dia));
    }
    return candidato.getTime();
  }

  // "28/09/2026" | "28/09" | "28-09-2026"
  const numerica = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numerica) {
    const dia = Number(numerica[1]);
    const mes = Number(numerica[2]) - 1;
    if (dia < 1 || dia > 31 || mes < 0 || mes > 11) return null;
    let ano = numerica[3] ? Number(numerica[3]) : now.getFullYear();
    if (ano < 100) ano += 2000;
    let candidato = fimDoDia(new Date(ano, mes, dia));
    if (!numerica[3] && candidato.getTime() < now.getTime()) {
      candidato = fimDoDia(new Date(ano + 1, mes, dia));
    }
    return candidato.getTime();
  }

  // "dia 28" — próxima ocorrência do dia 28 (este mês se futuro, senão o seguinte)
  const diaSolto = t.match(/\bdia\s+(\d{1,2})\b/);
  if (diaSolto) {
    const dia = Number(diaSolto[1]);
    if (dia < 1 || dia > 31) return null;
    let candidato = fimDoDia(new Date(now.getFullYear(), now.getMonth(), dia));
    if (candidato.getTime() < now.getTime()) {
      candidato = fimDoDia(new Date(now.getFullYear(), now.getMonth() + 1, dia));
    }
    return candidato.getTime();
  }

  if (/\bdepois de amanh[ãa]\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return fimDoDia(d).getTime();
  }
  if (/\bamanh[ãa]\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return fimDoDia(d).getTime();
  }
  if (/\bhoje\b/.test(t)) return fimDoDia(now).getTime();

  // "fim do mês" / "final do mês"
  if (/\b(fim|final) do m[eê]s\b/.test(t)) {
    return fimDoDia(new Date(now.getFullYear(), now.getMonth() + 1, 0)).getTime();
  }

  // "semana que vem" / "próxima semana" → segunda da semana seguinte
  if (/\b(semana que vem|pr[óo]xima semana)\b/.test(t)) {
    return fimDoDia(proximoDiaDaSemana(now, 1)).getTime();
  }

  // "próxima segunda" / "na sexta" / "sexta"
  const proxima = t.match(/\bpr[óo]xim[ao]\s+(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado)\b/);
  if (proxima) return fimDoDia(proximoDiaDaSemana(now, DIAS_SEMANA[proxima[1]!]!)).getTime();
  const diaSemana = t.match(/\b(?:na|no|pra|pro|para|at[eé])?\s*(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado)(?:-feira)?\b/);
  if (diaSemana && !/segunda[\s-]?feira passada/.test(t)) {
    return fimDoDia(proximoDiaDaSemana(now, DIAS_SEMANA[diaSemana[1]!]!)).getTime();
  }

  return null;
}
