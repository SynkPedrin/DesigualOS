/**
 * Cabeçalho de página — redesenhado (07/10/2026) pra parecer ferramenta
 * profissional de uso diário, não vitrine de demo. A versão anterior usava
 * BrandBanner (vídeo em loop ou wallpaper por trás do título, fonte
 * condensada gigante em caixa alta): pedido explícito do Endrigo em
 * 03/09/2026 pra "deixar as telas mais dinâmicas", mas o efeito colateral —
 * reportado depois — é cara de produto de demo, não de sistema que uma
 * equipe usa 8h por dia. Linear, Notion, ClickUp: nenhum tem vídeo atrás do
 * título. Texto simples, hierarquia clara, sem decoração que concorre com o
 * conteúdo. BrandBanner continua existindo (não apagado), só sem consumidor.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-grafite-elevado pb-5">
      <div>
        {eyebrow && (
          <p className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-roxo-eletrico">{eyebrow}</p>
        )}
        <h1 className="font-heading text-2xl font-semibold text-branco-cru">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-nevoa">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
