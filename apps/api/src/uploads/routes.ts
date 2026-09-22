import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth/middleware';
import { uploadUserFile } from '../lib/storage';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Anexos do composer do chat: imagens, PDF e texto (.md/.txt). Mesmo recorte
 * do accept do file input no frontend. */
function isAcceptedUpload(mimetype: string, filename: string): boolean {
  return (
    mimetype.startsWith('image/') ||
    mimetype === 'application/pdf' ||
    mimetype.startsWith('text/') ||
    /\.(md|txt)$/i.test(filename)
  );
}

// Nome de arquivo vira parte da storage key: troca tudo que não é seguro pra
// URL por hífen, preservando a extensão.
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * Upload genérico de arquivo do usuário (hoje: anexo do composer do chat).
 * Nasceu separado do POST /messages (que só serve DM) e do POST
 * /studio/references (exige studio:write e não aceita .md/.txt): o chat
 * precisava de um endpoint que só hospeda e devolve a URL, pra referenciar
 * depois no campo `attachment` do POST /chat.
 */
export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/uploads', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: 'No file sent' };
    }
    if (!isAcceptedUpload(file.mimetype, file.filename)) {
      reply.code(400);
      return { error: `Tipo '${file.mimetype}' não aceito. Use imagem, PDF, .md ou .txt.` };
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      reply.code(413);
      return { error: 'Arquivo maior que 25MB.' };
    }

    // P0-02/E21 (release readiness audit, 22/09/2026): bucket público, path
    // precisa de aleatoriedade real — Date.now() é força-bruteável.
    const path = `chat-uploads/${user.id}/${Date.now()}-${randomUUID()}-${sanitizeFilename(file.filename)}`;
    const uploaded = await uploadUserFile(path, buffer, file.mimetype);

    reply.code(201);
    return { filename: file.filename, url: uploaded.url, contentType: file.mimetype };
  });
}
