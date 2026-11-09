import { redirect } from 'next/navigation';

/**
 * "Tarefas" (o espelho do ClickUp) foi retirada em 28/10/2026: o Daily Tasks é a tela de tarefas da operação.
 * A rota continua existindo só para os links antigos (favoritos, Hoje, Gestão da equipe) caírem no lugar certo.
 */
export default function TarefasAntiga() {
  redirect('/daily-tasks');
}
