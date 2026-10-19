import { describe, expect, it } from 'vitest';
import { LIMITE_PADRAO_HISTORICO, telefoneDoChat } from './sync';

/**
 * SINCRONIZAÇÃO OPENWA (16/10/2026) — a parte pura desta fronteira é o
 * reconhecimento do `chatId` de um chat individual: um chat individual tem o
 * próprio id (`<telefone>@c.us`) e é ele que aponta ao contato. Os testes de
 * ingestão contra o banco existem na suíte de `communications` (mesmo modelo
 * de dados, mesma idempotência); aqui travamos apenas a regra de mapeamento.
 */

describe('telefoneDoChat', () => {
  it('converte o chatId individual do OpenWA em telefone', () => {
    expect(telefoneDoChat('5511999999999@c.us')).toBe('5511999999999');
    expect(telefoneDoChat('6281234567890@s.whatsapp.net')).toBe('6281234567890');
  });

  it('rejeita ids de grupo e de outros domínios', () => {
    expect(telefoneDoChat('1234567890-123@g.us')).toBeNull();
    expect(telefoneDoChat('status@broadcast')).toBeNull();
    expect(telefoneDoChat('5511999999999')).toBeNull();
  });
});

describe('limite de histórico', () => {
  it('busca os últimos 10 mensagens por chat, como a missão exige', () => {
    expect(LIMITE_PADRAO_HISTORICO).toBe(10);
  });
});
