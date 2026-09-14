/**
 * Loading de rota do shell: navegação SPA já responde em ~55-65ms (medido),
 * mas numa carga cheia (primeira visita, reload) o conteúdo da rota chega
 * depois do chrome. O placeholder ocupa o espaço do conteúdo final (sem
 * layout shift) em vez de spinner gigante.
 */
export default function ShellLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="h-24 animate-pulse rounded-xl bg-grafite" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-grafite" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-grafite" />
    </div>
  );
}
