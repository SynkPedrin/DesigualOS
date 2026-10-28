/**
 * Qual status o botão "Concluir" (e "Reabrir") usa. NÃO é "o primeiro status de categoria concluída": o espaço da agência
 * tem vários (pronto, encerrado, concluído…) e o primeiro da fila era "concluído", que quase ninguém usa — a tarefa
 * saía do fluxo real sem ser encerrada. A regra olha o NOME, na ordem em que a agência fecha trabalho:
 *   encerrado → concluído/complete/done/finalizado → qualquer outro "feito" que não seja cancelado.
 * "pronto" nunca é o destino do Concluir: é a entrega pronta, que ainda espera o encerramento.
 */
interface Fecha { id: string; name: string; category: string }
interface Abre extends Fecha { isInitial: boolean }

const ENCERRADO = /^encerrad/i;
const CONCLUIDO = /^(conclu|complete|done|finaliz)/i;
const CANCELADO = /cancel/i;
const PRONTO = /^pronto/i;

export function statusDeConclusao<T extends Fecha>(statuses: readonly T[]): T | undefined {
  const feitos = statuses.filter((s) => s.category === 'done');
  return feitos.find((s) => ENCERRADO.test(s.name))
    ?? feitos.find((s) => CONCLUIDO.test(s.name))
    ?? feitos.find((s) => !CANCELADO.test(s.name) && !PRONTO.test(s.name))
    ?? feitos.find((s) => !CANCELADO.test(s.name));
}

/** Para reabrir: o "aberto" do fluxo real do espaço; sem ele, o status inicial; sem ele, qualquer um ainda por fazer. */
export function statusDeReabertura<T extends Abre>(statuses: readonly T[]): T | undefined {
  const aFazer = statuses.filter((s) => s.category === 'todo');
  return aFazer.find((s) => /^aberto$/i.test(s.name)) ?? aFazer.find((s) => /^open$/i.test(s.name)) ?? statuses.find((s) => s.isInitial) ?? aFazer[0];
}
