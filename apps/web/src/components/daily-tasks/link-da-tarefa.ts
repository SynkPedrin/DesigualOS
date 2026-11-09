import { toast } from '@/stores/toast-store';

/** Endereço que abre a tarefa direto na gaveta (`?task=` é lido pela tela de Tarefas, também depois do login). */
export function linkDaTarefa(taskId: string): string {
  return `${window.location.origin}/daily-tasks?task=${encodeURIComponent(taskId)}`;
}

/** Copia o link da tarefa. Sem permissão de área de transferência, mostra o link para copiar à mão. */
export async function copiarLinkDaTarefa(taskId: string, chave?: string): Promise<void> {
  const link = linkDaTarefa(taskId);
  try {
    await navigator.clipboard.writeText(link);
    toast(`Link ${chave ? `da ${chave} ` : 'da tarefa '}copiado.`, 'success');
  } catch {
    window.prompt('Copie o link da tarefa:', link);
  }
}
