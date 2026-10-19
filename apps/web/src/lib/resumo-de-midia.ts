import type { MediaOverviewClientWire } from '@/lib/api/contracts';

/**
 * OS NÚMEROS DA CARTEIRA DE MÍDIA — e por que cada um pode ser `null`.
 *
 * Esta é a tela onde um zero tranquilizador custa mais caro. "Investimento
 * total: R$ 0" lido como "ninguém está gastando" quando na verdade é "não
 * consegui ler três contas" é a diferença entre dormir tranquilo e perder o
 * mês. Por isso nenhuma conta aqui completa buraco com zero:
 *
 * - soma só entra com o que foi LIDO (`data_available`);
 * - divisão com denominador zero devolve `null`, não `0` nem `Infinity`;
 * - quantos clientes ficaram de fora da soma é PARTE do resultado, não nota de
 *   rodapé — quem lê o total precisa saber sobre quantos ele fala.
 *
 * O mockup pede também ROAS e CAC. Os dois exigem RECEITA, e `/media/overview`
 * não traz receita: a leitura do Meta hoje vai até gasto, impressão, clique e
 * resultado. Então eles não aparecem como 0 nem como "—": não aparecem. Um
 * ROAS inventado numa tela de mídia é pior que nenhum ROAS.
 */
export interface ResumoDeMidia {
  /** Quantos clientes a empresa tem, lidos ou não. */
  totalDeClientes: number;
  /** Clientes com conta vinculada E leitura disponível. A base de toda soma. */
  comLeitura: number;
  /** Vinculados, mas a leitura falhou agora (conexão revogada, API fora). */
  semLeitura: number;
  /** Sem conta de anúncio vinculada: dinheiro possivelmente fora do radar. */
  semConta: number;

  investido: number | null;
  impressoes: number | null;
  cliques: number | null;
  leads: number | null;

  /** Custo por lead da carteira. `null` sem lead ou sem gasto lido. */
  cplMedio: number | null;
  /**
   * CTR da carteira, ponderado por impressão — nunca a média das médias.
   * Média de CTR trata uma conta de mil impressões igual a uma de um milhão,
   * e o número que sai não corresponde a cliente nenhum.
   */
  ctrMedio: number | null;
}

type ClienteComLeitura = Extract<MediaOverviewClientWire, { data_available: true }>;

function temLeitura(c: MediaOverviewClientWire): c is ClienteComLeitura {
  return c.connected && c.data_available;
}

/** Soma que devolve `null` quando NADA foi lido, em vez de zero. */
function somar(valores: Array<number | null | undefined>): number | null {
  const lidos = valores.filter((v): v is number => typeof v === 'number');
  return lidos.length === 0 ? null : lidos.reduce((t, v) => t + v, 0);
}

export function resumoDeMidia(clientes: readonly MediaOverviewClientWire[]): ResumoDeMidia {
  const comLeitura = clientes.filter(temLeitura);

  const investido = somar(comLeitura.map((c) => c.insights?.spend));
  const impressoes = somar(comLeitura.map((c) => c.insights?.impressions));
  const cliques = somar(comLeitura.map((c) => c.insights?.clicks));
  const leads = somar(comLeitura.map((c) => c.insights?.results));

  return {
    totalDeClientes: clientes.length,
    comLeitura: comLeitura.length,
    semLeitura: clientes.filter((c) => c.connected && !c.data_available).length,
    semConta: clientes.filter((c) => !c.connected).length,
    investido,
    impressoes,
    cliques,
    leads,
    // Sem lead não existe custo POR lead. Zero aqui diria "cada lead saiu de
    // graça", que é o contrário do que aconteceu.
    cplMedio: investido !== null && leads !== null && leads > 0 ? investido / leads : null,
    ctrMedio: cliques !== null && impressoes !== null && impressoes > 0 ? (cliques / impressoes) * 100 : null,
  };
}

/**
 * O QUE PRECISA DE AÇÃO, em ordem de quanto dói.
 *
 * Ordem deliberada: cliente sem conta vinculada vem antes de conta que falhou
 * a leitura, porque o primeiro pode estar gastando sem ninguém ver, e o segundo
 * ao menos se sabe que existe.
 */
export interface AlertaDeMidia {
  id: string;
  tipo: 'sem-conta' | 'sem-leitura' | 'sem-resultado';
  clienteId: string;
  clienteNome: string;
  /** O motivo que a API deu, quando deu. Nunca inventado aqui. */
  motivo?: string;
}

export function alertasDeMidia(clientes: readonly MediaOverviewClientWire[]): AlertaDeMidia[] {
  const alertas: AlertaDeMidia[] = [];

  for (const c of clientes) {
    if (!c.connected) {
      alertas.push({ id: `sem-conta:${c.client_id}`, tipo: 'sem-conta', clienteId: c.client_id, clienteNome: c.client_name });
    } else if (!c.data_available) {
      alertas.push({
        id: `sem-leitura:${c.client_id}`,
        tipo: 'sem-leitura',
        clienteId: c.client_id,
        clienteNome: c.client_name,
        motivo: c.reason,
      });
    }
  }

  /**
   * Gastou e não trouxe resultado nenhum é alerta de verdade, e só pode ser
   * afirmado quando as DUAS leituras existem. Com `results` ausente, não se
   * sabe se foi zero ou se não foi medido — e tratar ausência como zero aqui
   * acusaria campanha boa de não entregar.
   */
  for (const c of clientes) {
    if (!temLeitura(c)) continue;
    const gasto = c.insights?.spend;
    const resultados = c.insights?.results;
    if (typeof gasto === 'number' && gasto > 0 && resultados === 0) {
      alertas.push({ id: `sem-resultado:${c.client_id}`, tipo: 'sem-resultado', clienteId: c.client_id, clienteNome: c.client_name });
    }
  }

  return alertas;
}
