import Image from 'next/image';
import { File } from 'lucide-react';
import type { Message } from '@/lib/api/contracts';

/** Anexo de mensagem (extraído da page antiga): imagem inline, player de
 * áudio/vídeo ou card genérico de arquivo. Sem mimetype whitelist no backend,
 * então caímos no card pra qualquer tipo desconhecido. */
export function MessageAttachment({ message }: { message: Message }) {
  if (!message.attachmentUrl) return null;
  const type = message.attachmentType ?? '';

  if (type.startsWith('image/')) {
    return (
      <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 block">
        <Image
          src={message.attachmentUrl}
          alt={message.attachmentFilename ?? 'imagem'}
          width={240}
          height={180}
          unoptimized
          className="h-auto max-w-[240px] rounded-md border border-white/10 object-cover"
        />
      </a>
    );
  }

  if (type.startsWith('audio/')) {
    return <audio controls src={message.attachmentUrl} className="mt-2 h-9 max-w-[240px]" />;
  }

  if (type.startsWith('video/')) {
    return (
      <video controls src={message.attachmentUrl} className="mt-2 max-w-[240px] rounded-md border border-white/10" />
    );
  }

  return (
    <a
      href={message.attachmentUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex max-w-[240px] items-center gap-2 rounded-md border border-white/10 bg-carbono/40 px-3 py-2 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
    >
      <File size={14} className="shrink-0" />
      <span className="truncate">{message.attachmentFilename ?? 'arquivo'}</span>
    </a>
  );
}
