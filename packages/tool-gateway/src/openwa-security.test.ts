import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assinaturaOpenwaValida } from './openwa-signature';
import { readWhatsappMedia, safeWhatsappFilename, saveWhatsappMedia } from './openwa-media-store';

const previousMediaDir = process.env.WHATSAPP_MEDIA_DIR;

afterEach(async () => {
  if (previousMediaDir === undefined) delete process.env.WHATSAPP_MEDIA_DIR;
  else process.env.WHATSAPP_MEDIA_DIR = previousMediaDir;
  if (process.env.OPENWA_TEST_MEDIA_DIR) await rm(process.env.OPENWA_TEST_MEDIA_DIR, { recursive: true, force: true });
  delete process.env.OPENWA_TEST_MEDIA_DIR;
});

describe('assinatura OpenWA', () => {
  it('valida o corpo cru em tempo constante e rejeita alterações', () => {
    const raw = '{"event":"message.received","data":{"body":"olá"}}';
    const secret = 'segredo-com-mais-de-16-caracteres';
    const signature = `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
    expect(assinaturaOpenwaValida(raw, signature, secret)).toBe(true);
    expect(assinaturaOpenwaValida(`${raw} `, signature, secret)).toBe(false);
    expect(assinaturaOpenwaValida(raw, 'sha256=invalid', secret)).toBe(false);
  });
});

describe('storage privado de mídia', () => {
  it('salva fora do banco, lê de volta e sanitiza o nome', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openwa-media-'));
    process.env.OPENWA_TEST_MEDIA_DIR = directory;
    process.env.WHATSAPP_MEDIA_DIR = directory;
    const saved = await saveWhatsappMedia({
      organizationId: 'org-1',
      sessionId: 'session-1',
      bytes: Buffer.from('conteudo'),
      mimetype: 'application/pdf',
      filename: '../../relatório final',
    });
    expect(saved.filename).toBe('relato-rio-final.pdf');
    expect(saved.storageKey).not.toContain('..');
    await expect(readWhatsappMedia(saved.storageKey)).resolves.toEqual(Buffer.from('conteudo'));
    await expect(readWhatsappMedia('../fora')).rejects.toThrow('Caminho');
  });

  it('recusa MIME não permitido e arquivos acima do limite', async () => {
    await expect(saveWhatsappMedia({ organizationId: 'o', sessionId: 's', bytes: Buffer.from('x'), mimetype: 'text/html' })).rejects.toThrow('não permitido');
    await expect(saveWhatsappMedia({ organizationId: 'o', sessionId: 's', bytes: Buffer.alloc(11), mimetype: 'image/png', maxBytes: 10 })).rejects.toThrow('maior');
    expect(safeWhatsappFilename('sem extensao', 'audio/ogg; codecs=opus')).toBe('sem-extensao.ogg');
  });
});
