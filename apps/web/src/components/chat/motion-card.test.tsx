import { describe, expect, it } from 'vitest';
import type { ChatMotionRef } from './motion-card';
import type { ConversationMessageWire } from '@/lib/api/contracts';
import { mapConversationMessage } from '@/lib/api/contracts';

/**
 * O que precisa ser verdade pro player sobreviver a um F5: o bloco `motion`
 * vem da metadata da MENSAGEM persistida, não de estado local do React.
 */
function wire(overrides: Partial<ConversationMessageWire> = {}): ConversationMessageWire {
  return {
    id: 'msg-1',
    role: 'assistant',
    agent: 'otto',
    content: 'Vou fazer.',
    attachment_url: null,
    attachment_type: null,
    attachment_filename: null,
    attachments: [],
    created_at: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

const motion: ChatMotionRef = {
  motion_id: 'motion-1',
  status: 'queued',
  format: '9:16',
  duration_seconds: 15,
  fps: 30,
  width: 1080,
  height: 1920,
};

describe('motion na mensagem persistida', () => {
  it('o bloco atravessa o mapeamento intacto', () => {
    expect(mapConversationMessage(wire({ motion })).motion).toEqual(motion);
  });

  it('mensagem sem motion fica com null, não undefined — a UI testa por truthiness', () => {
    expect(mapConversationMessage(wire()).motion).toBeNull();
  });

  it('mensagem antiga (de antes do Motion Engine) não quebra', () => {
    const antiga = wire();
    delete (antiga as { motion?: unknown }).motion;
    expect(mapConversationMessage(antiga).motion).toBeNull();
  });

  it('motion e anexos convivem no mesmo balão', () => {
    const mapeada = mapConversationMessage(
      wire({ motion, attachments: [{ url: 'https://x/ref.png', filename: 'ref.png', contentType: 'image/png' }] }),
    );
    expect(mapeada.motion).toEqual(motion);
    expect(mapeada.attachments).toHaveLength(1);
  });
});
