/**
 * O QUE ESTE PADRÃO SIGNIFICA — e o que ele NÃO é.
 *
 * Esta conta existe pra responder, enquanto a pessoa escolhe o agendamento,
 * "então isso dispara quando?". É uma leitura do PADRÃO, feita no navegador.
 *
 * Ela NÃO é a resposta autoritativa de quando a automação vai rodar. Essa
 * vem do `next` do repeatable job do BullMQ (`proximasExecucoes()`, no
 * orchestrator) e só existe DEPOIS de salvar, porque é o agendador que
 * decide. As duas divergem exatamente nos momentos em que isso importa: fuso
 * diferente no servidor, repeatable que não foi registrado, automação
 * desligada.
 *
 * Por isso quem chama precisa dizer na tela que é prévia do padrão. Mostrar
 * esta lista com cara de "próxima execução" repetiria, do lado do cliente, o
 * erro que `proximasExecucoes()` foi escrita pra evitar: uma segunda opinião
 * sobre o mesmo cron, apresentada com a confiança de um dado medido.
 */

/** Um campo do cron já resolvido na lista de valores que ele aceita. */
function valoresDoCampo(campo: string, minimo: number, maximo: number): number[] | null {
  const aceitos = new Set<number>();

  for (const parte of campo.split(',')) {
    const pedaco = parte.trim();
    if (pedaco === '') return null;

    const [alvo, passoCru] = pedaco.split('/');
    const passo = passoCru === undefined ? 1 : Number(passoCru);
    if (!Number.isInteger(passo) || passo < 1) return null;

    let inicio: number;
    let fim: number;

    if (alvo === '*' || alvo === undefined) {
      inicio = minimo;
      fim = maximo;
    } else if (alvo.includes('-')) {
      const [a, b] = alvo.split('-');
      inicio = Number(a);
      fim = Number(b);
    } else {
      inicio = Number(alvo);
      fim = Number(alvo);
    }

    if (!Number.isInteger(inicio) || !Number.isInteger(fim)) return null;
    if (inicio < minimo || fim > maximo || inicio > fim) return null;

    for (let v = inicio; v <= fim; v += passo) aceitos.add(v);
  }

  return aceitos.size === 0 ? null : [...aceitos].sort((a, b) => a - b);
}

export interface PadraoDeCron {
  minutos: number[];
  horas: number[];
  diasDoMes: number[];
  meses: number[];
  diasDaSemana: number[];
  /** Verdadeiro quando dia-do-mês e dia-da-semana foram ambos restringidos. */
  diaRestritoPorDois: boolean;
}

/** `null` quando o padrão não é um cron de cinco campos que saibamos ler. */
export function lerCron(expressao: string): PadraoDeCron | null {
  const campos = expressao.trim().split(/\s+/);
  if (campos.length !== 5) return null;

  const [min, hora, dia, mes, semana] = campos as [string, string, string, string, string];
  const minutos = valoresDoCampo(min, 0, 59);
  const horas = valoresDoCampo(hora, 0, 23);
  const diasDoMes = valoresDoCampo(dia, 1, 31);
  const meses = valoresDoCampo(mes, 1, 12);
  // 0 e 7 são domingo no cron; normalizamos 7 em 0.
  const semanaCrua = valoresDoCampo(semana, 0, 7);

  if (!minutos || !horas || !diasDoMes || !meses || !semanaCrua) return null;

  const diasDaSemana = [...new Set(semanaCrua.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);

  return {
    minutos,
    horas,
    diasDoMes,
    meses,
    diasDaSemana,
    diaRestritoPorDois: dia !== '*' && semana !== '*',
  };
}

const MAXIMO_DE_MINUTOS_VARRIDOS = 60 * 24 * 400;

/**
 * As próximas `quantas` ocorrências do padrão, a partir de `desde`
 * (exclusivo). Devolve lista vazia quando o padrão não é legível ou quando
 * nada acontece no próximo ano — "a cada 29 de fevereiro" é padrão válido e
 * raro, e inventar uma data pra ele seria pior que não mostrar nada.
 */
export function proximasDoCron(expressao: string, desde: Date, quantas = 3): Date[] {
  const padrao = lerCron(expressao);
  if (!padrao) return [];

  const encontradas: Date[] = [];
  const cursor = new Date(desde.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let passo = 0; passo < MAXIMO_DE_MINUTOS_VARRIDOS && encontradas.length < quantas; passo += 1) {
    const mes = cursor.getMonth() + 1;
    const diaDoMes = cursor.getDate();
    const diaDaSemana = cursor.getDay();

    /**
     * A regra que quase toda implementação ingênua erra: com dia-do-mês E
     * dia-da-semana restringidos, o cron casa quando QUALQUER UM dos dois
     * bate, não os dois. "0 8 1 * 1" é dia 1 do mês OU toda segunda.
     */
    const diaBate = padrao.diaRestritoPorDois
      ? padrao.diasDoMes.includes(diaDoMes) || padrao.diasDaSemana.includes(diaDaSemana)
      : padrao.diasDoMes.includes(diaDoMes) && padrao.diasDaSemana.includes(diaDaSemana);

    if (
      diaBate &&
      padrao.meses.includes(mes) &&
      padrao.horas.includes(cursor.getHours()) &&
      padrao.minutos.includes(cursor.getMinutes())
    ) {
      encontradas.push(new Date(cursor.getTime()));
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return encontradas;
}
