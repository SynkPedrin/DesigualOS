import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-grafite-elevado px-8 py-16 text-center">
      <Icon size={28} className="text-nevoa" />
      <p className="font-heading text-lg font-semibold text-branco-cru">{title}</p>
      {description && <p className="max-w-sm text-sm text-nevoa">{description}</p>}
    </div>
  );
}
