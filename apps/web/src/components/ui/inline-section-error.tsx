/** Erro inline pra uma seção dentro de uma página que carregou o resto normalmente - mais
 * discreto que o EmptyState de página inteira (esse fica pra quando a página inteira depende
 * de um único fetch que falhou). Usa o mesmo texto/tentar-de-novo em toda página que tem mais
 * de uma fonte de dado independente (costs, admin, monitoring, messages). */
export function InlineSectionError({
  message = 'Não conseguimos carregar esses dados.',
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <p className="text-sm text-nevoa">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
      >
        Tentar novamente
      </button>
    </div>
  );
}
