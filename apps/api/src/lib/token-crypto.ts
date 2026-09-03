import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Cofre dos tokens de integração (ClickUp e futuros). Requisito explícito do
 * Endrigo: "não guardar tokens do ClickUp de forma insegura".
 *
 * AES-256-GCM (autenticado: adulterar o ciphertext falha no decrypt, não
 * devolve lixo silenciosamente). A chave sai de INTEGRATION_ENCRYPTION_KEY
 * quando existir; senão é DERIVADA do NODE_SECRET que já existe no .env
 * (scrypt + salt fixo). Derivar do segredo existente é deliberado: evita
 * exigir um segredo novo pra começar a usar hoje, sem nunca gravar o token
 * em claro. Trocar NODE_SECRET invalida os tokens guardados (o usuário só
 * precisa reconectar em Configurações > Integrações).
 */
const KEY_SALT = 'desigual-os/integration-tokens/v1';
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, 'hex');
    if (key.length !== 32) {
      throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes in hex (64 hex chars)');
    }
    cachedKey = key;
    return key;
  }

  const fallback = process.env.NODE_SECRET;
  if (!fallback) {
    throw new Error('Neither INTEGRATION_ENCRYPTION_KEY nor NODE_SECRET is configured; cannot store integration tokens');
  }
  cachedKey = scryptSync(fallback, KEY_SALT, 32);
  return cachedKey;
}

/** Envelope guardado no banco: iv.authTag.ciphertext, tudo em base64url. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptToken(envelope: string): string {
  const [ivPart, tagPart, dataPart] = envelope.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted token envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}
