/** "Hoje", "Ontem" ou "terça, 21 de outubro" (com o ano quando não é o atual), pelo dia em que a tarefa foi encerrada. */
export function rotuloDoDia(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dia(agora) - dia(d)) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== agora.getFullYear() ? { year: 'numeric' } : {}) });
}
