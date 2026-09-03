import { LinkIcon } from 'lucide-react';

export function Chip({ label, url }: { label: string; url?: string | undefined }) {
  const content = (
    <>
      <LinkIcon size={11} className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 font-mono text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
      >
        {content}
      </a>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 font-mono text-[11px] text-nevoa">
      {content}
    </span>
  );
}
