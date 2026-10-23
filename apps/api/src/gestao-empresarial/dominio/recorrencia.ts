import { somarDias, somarMeses } from './datas';

export type Frequencia = 'semanal' | 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual';

const MESES: Record<Exclude<Frequencia, 'semanal'>, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };

export interface ModeloRecorrente {
  frequencia: Frequencia;
  inicio: string;
  fim?: string | null | undefined;
  /** Dia do vencimento; nulo usa o dia do início. */
  diaDoMes?: number | null | undefined;
  /** Até onde já foi gerado: a próxima ocorrência é a seguinte a esta. */
  geradoAte?: string | null | undefined;
}

/**
 * Datas de vencimento ainda NÃO geradas, de `inicio` (ou depois de `geradoAte`) até `ate`,
 * inclusive. Pura e determinística: rodar duas vezes com os mesmos dados dá o mesmo resultado, e
 * como o próprio `geradoAte` avança, gerar de novo não duplica.
 */
export function ocorrenciasPendentes(modelo: ModeloRecorrente, ate: string): string[] {
  const limite = modelo.fim && modelo.fim < ate ? modelo.fim : ate;
  const dia = modelo.diaDoMes ?? Number(modelo.inicio.slice(8, 10));
  const datas: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const data = modelo.frequencia === 'semanal' ? somarDias(modelo.inicio, 7 * i) : somarMeses(modelo.inicio, MESES[modelo.frequencia] * i, dia);
    if (data > limite) break;
    if (modelo.geradoAte && data <= modelo.geradoAte) continue;
    datas.push(data);
  }
  return datas;
}
