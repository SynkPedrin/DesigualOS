import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/hooks/use-internal-chat';
import { Mensagem } from './mensagem';

const EU = { id: 'u-alicia', name: 'Alicia' };
const base: ChatMessage = {
  id: 'm1', conversation_id: 'c1', sender_id: 'u-tecnico', sender_name: 'ClickUp', sender_avatar_url: null, content: null,
  client_message_id: 'clickup:1', reply_to: null, mentions: [], created_at: '2026-10-01T12:00:00Z', edited_at: null, deleted: false,
  attachments: [], reactions: [],
};
const acoes = { onRetry: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onReact: vi.fn(), onSave: vi.fn(), onJump: vi.fn() };

function montar(m: ChatMessage) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(<Mensagem m={m} agrupada={false} me={EU} membros={new Map()} destacada={false} podeEscrever acoes={acoes} />));
  return el;
}
afterEach(() => { document.body.innerHTML = ''; });

describe('mensagem trazida do chat do ClickUp', () => {
  it('de quem não tem conta: mostra o nome real do autor, só o texto, e a marca ClickUp', () => {
    const el = montar({ ...base, kind: 'clickup_externo', content: '**Gui**: Alicia, a arte saiu?' });
    expect(el.textContent).toContain('Gui');
    expect(el.textContent).toContain('Alicia, a arte saiu?');
    expect(el.textContent).not.toContain('**Gui**');
    expect(el.textContent).not.toContain('ClickUp' + 'Gui'); // o remetente técnico não aparece como autor
    expect(el.querySelector('[title="Mensagem trazida do chat do ClickUp"]')).not.toBeNull();
  });

  it('minha, importada: aparece como "Você" mas sem editar nem apagar (o servidor recusaria)', () => {
    const el = montar({ ...base, kind: 'clickup', sender_id: EU.id, sender_name: 'Alicia', content: 'saiu sim' });
    expect(el.textContent).toContain('Você');
    act(() => (el.querySelector('[aria-label="Mais ações"]') as HTMLButtonElement).click());
    expect(el.textContent).not.toContain('Editar');
    expect(el.textContent).not.toContain('Apagar');
  });

  it('minha, escrita aqui: continua editável', () => {
    const el = montar({ ...base, kind: 'user', sender_id: EU.id, sender_name: 'Alicia', content: 'oi' });
    act(() => (el.querySelector('[aria-label="Mais ações"]') as HTMLButtonElement).click());
    expect(el.textContent).toContain('Editar');
  });
});
