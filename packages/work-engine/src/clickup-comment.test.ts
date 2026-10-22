import { describe, expect, it } from 'vitest';
import { comentarioEmMarkdown } from './clickup-comment';

describe('comentário do ClickUp → markdown', () => {
  it('mantém links, anexos, menções e listas (nada de link perdido)', () => {
    const md = comentarioEmMarkdown({
      comment: [
        { type: 'tag', user: { username: 'Jamile' }, text: '@Jamile' },
        { text: ' veja ', attributes: {} },
        { text: 'a apresentação', attributes: { link: 'https://www.canva.com/design/x?utm=1' } },
        { text: '\n', attributes: {} },
        { text: 'https://exemplo.com/a', attributes: { link: 'https://exemplo.com/a' } },
        { text: '\n', attributes: {} },
        { type: 'attachment', text: 'brief.pdf', attachment: { title: 'brief.pdf', url: 'https://t.clickup-attachments.com/brief.pdf' } },
        { text: '\n', attributes: {} },
        { text: 'item um', attributes: {} }, { text: '\n', attributes: { list: { list: 'bullet' } } },
        { type: 'task_mention', task_mention: { task_id: 'abc123' }, text: 'abc123' },
      ],
    }, (id) => (id === 'abc123' ? { href: '/daily-tasks?task=U1', chave: 'DT-9' } : undefined));
    expect(md).toContain('@Jamile veja [a apresentação](https://www.canva.com/design/x?utm=1)');
    expect(md).toContain('\nhttps://exemplo.com/a\n');
    expect(md).toContain('📎 [brief.pdf](https://t.clickup-attachments.com/brief.pdf)');
    expect(md).toContain('- item um');
    expect(md).toContain('[DT-9](/daily-tasks?task=U1)');
  });
  it('sem blocos usa o texto simples', () => {
    expect(comentarioEmMarkdown({ comment_text: ' olá https://a.com ' })).toBe('olá https://a.com');
  });
});
