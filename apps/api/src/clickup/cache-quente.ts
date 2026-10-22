/**
 * CACHE QUENTE DAS CONSULTAS AO CLICKUP (22/10/2026).
 *
 * A consulta da agência inteira custa ~40 s fria (medido em produção: 42,6 s na
 * primeira abertura da gestão da equipe, 1,0 s na segunda). Antes, cada webhook
 * de tarefa ESVAZIAVA o cache inteiro, e o webhook dispara a cada edição de
 * qualquer pessoa — então a próxima pessoa a abrir Tarefas ou a Gestão pagava os
 * 40 s de novo, várias vezes por hora.
 *
 * Agora:
 *   até 1 min          serve do cache.
 *   até 10 min         serve do cache NA HORA e relê por trás.
 *   depois             busca de verdade (só acontece se ninguém usou e o
 *                      aquecimento não rodou — fora do horário de trabalho).
 *   webhook (mudou)    NÃO apaga: marca para reler e relê por trás na hora. Quem
 *                      abrir nos segundos seguintes vê o dado de antes da edição;
 *                      a tela atualiza sozinha quando a releitura termina.
 *   aquecimento        a cada 4 min, das 7h às 20h (Brasília), relê por trás o
 *                      que alguém usou nas últimas 24 h. A primeira abertura do
 *                      dia já encontra o cache quente.
 *
 * Releitura com falha não apaga nada: o valor anterior continua até a próxima.
 */

export const FRESCO_MS = 60_000;
export const VALIDADE_MS = 10 * 60_000;
const USO_RECENTE_MS = 24 * 60 * 60_000;
const LIMITE = 50;

interface Entrada<T> {
  em: number;
  usadoEm: number;
  resultado: T;
  renovando: boolean;
  buscar: () => Promise<T>;
}

export function criarCacheQuente<T>(aoFalhar: (error: unknown) => void = () => undefined) {
  const entradas = new Map<string, Entrada<T>>();

  function renovar(chave: string, entrada: Entrada<T>) {
    if (entrada.renovando) return;
    entrada.renovando = true;
    void entrada.buscar()
      .then((resultado) => {
        const atual = entradas.get(chave);
        // Se a entrada foi trocada enquanto relia, quem trocou ganha.
        if (atual === entrada) entradas.set(chave, { ...entrada, em: Date.now(), resultado, renovando: false });
      })
      .catch((error) => {
        entrada.renovando = false;
        aoFalhar(error);
      });
  }

  async function obter(chave: string, buscar: () => Promise<T>, agora = Date.now()): Promise<T> {
    const guardado = entradas.get(chave);
    if (guardado && agora - guardado.em < VALIDADE_MS) {
      guardado.usadoEm = agora;
      guardado.buscar = buscar;
      if (agora - guardado.em >= FRESCO_MS) renovar(chave, guardado);
      return guardado.resultado;
    }
    const inicio = Date.now();
    const resultado = await buscar();
    // Hora da leitura no mesmo relógio de quem chamou (`agora`), somando o tempo que a busca levou.
    const lidoEm = agora + (Date.now() - inicio);
    if (!entradas.has(chave) && entradas.size >= LIMITE) {
      const maisAntiga = entradas.keys().next().value;
      if (maisAntiga !== undefined) entradas.delete(maisAntiga);
    }
    entradas.set(chave, { em: lidoEm, usadoEm: agora, resultado, renovando: false, buscar });
    return resultado;
  }

  /** Algo mudou no ClickUp: relê tudo por trás, sem apagar o que está servindo. */
  function marcarParaReler() {
    for (const [chave, entrada] of entradas) renovar(chave, entrada);
  }

  /** Relê por trás o que alguém usou nas últimas 24 h e já não está fresco. */
  function aquecer(agora = Date.now()) {
    for (const [chave, entrada] of entradas) {
      if (agora - entrada.usadoEm < USO_RECENTE_MS && agora - entrada.em >= FRESCO_MS) renovar(chave, entrada);
    }
  }

  return { obter, marcarParaReler, aquecer, limpar: () => entradas.clear(), tamanho: () => entradas.size };
}

/** Horário de trabalho em Brasília (7h–20h): fora dele o aquecimento não gasta chamadas ao ClickUp. */
export function emHorarioDeTrabalho(agora = Date.now()): boolean {
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date(agora)));
  return hora >= 7 && hora < 20;
}
