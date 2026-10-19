import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';

// 100 MB: cobre foto, vídeo, áudio e quase todo documento de trabalho. Acima
// disso o arquivo atravessaria a memória do navegador do WhatsApp (whatsapp-web.js
// carrega a mídia inteira em base64), que divide 4 GB com todos os números.
export const WHATSAPP_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|webm)|audio\/(ogg|mpeg|mp4|wav|x-wav|webm|aac|opus)|application\/(pdf|msword|octet-stream|zip|x-zip-compressed|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-[a-z.]+)|text\/(plain|csv))([; ].*)?$/i;

function root(): string {
  return resolve(process.env.WHATSAPP_MEDIA_DIR ?? join(homedir(), '.desigualos', 'whatsapp-media'));
}

export function safeWhatsappFilename(filename: string | null | undefined, mimetype: string): string {
  const cleaned = (filename ?? 'arquivo')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120) || 'arquivo';
  if (extname(cleaned)) return cleaned;
  const extension = mimetype.startsWith('image/jpeg') ? '.jpg'
    : mimetype.startsWith('image/png') ? '.png'
      : mimetype.startsWith('image/webp') ? '.webp'
        : mimetype.startsWith('audio/ogg') || mimetype.startsWith('audio/opus') ? '.ogg'
          : mimetype.startsWith('audio/mpeg') ? '.mp3'
            : mimetype.startsWith('video/mp4') ? '.mp4'
              : mimetype.startsWith('application/pdf') ? '.pdf'
                : '';
  return `${cleaned}${extension}`;
}

export function assertWhatsappMedia(input: { bytes: Buffer; mimetype: string; maxBytes?: number }): void {
  const maxBytes = input.maxBytes ?? WHATSAPP_MEDIA_MAX_BYTES;
  if (input.bytes.byteLength === 0) throw new Error('Mídia vazia');
  if (input.bytes.byteLength > maxBytes) throw new Error(`Mídia maior que ${Math.floor(maxBytes / 1024 / 1024)} MB`);
  if (!ALLOWED_MIME.test(input.mimetype)) throw new Error(`Tipo de mídia não permitido: ${input.mimetype}`);
}

export async function saveWhatsappMedia(input: {
  organizationId: string;
  sessionId: string;
  bytes: Buffer;
  mimetype: string;
  filename?: string | undefined;
  maxBytes?: number | undefined;
}): Promise<{ storageKey: string; filename: string; sizeBytes: number }> {
  assertWhatsappMedia({
    bytes: input.bytes,
    mimetype: input.mimetype,
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
  });
  const filename = safeWhatsappFilename(input.filename, input.mimetype);
  const storageKey = `${input.organizationId}/${input.sessionId}/${randomUUID()}${extname(filename)}`;
  const destination = resolve(root(), storageKey);
  if (!destination.startsWith(`${root()}${sep}`)) throw new Error('Caminho de mídia inválido');
  await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 });
  await writeFile(destination, input.bytes, { mode: 0o600, flag: 'wx' });
  return { storageKey, filename, sizeBytes: input.bytes.byteLength };
}

export async function readWhatsappMedia(storageKey: string): Promise<Buffer> {
  const source = resolve(root(), storageKey);
  if (!source.startsWith(`${root()}${sep}`)) throw new Error('Caminho de mídia inválido');
  return readFile(source);
}
