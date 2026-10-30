import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateTask } from './clickup-client';

afterEach(() => vi.unstubAllGlobals());

function capturar() {
  const corpos: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') corpos.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: 'T1', list: { id: 'L1' } }), { status: 200 });
  }));
  return corpos;
}

describe('descrição enviada ao ClickUp', () => {
  it('vai em markdown_content (o campo que a atualização lê), além de markdown_description', async () => {
    const corpos = capturar();
    await updateTask({ apiKey: 'k', teamId: 't' }, 'T1', { markdownDescription: '**Briefing** novo' });
    expect(corpos.at(-1)).toMatchObject({ markdown_content: '**Briefing** novo', markdown_description: '**Briefing** novo' });
  });

  it('apagar a descrição manda um espaço (o ClickUp ignora vazio)', async () => {
    const corpos = capturar();
    await updateTask({ apiKey: 'k', teamId: 't' }, 'T1', { markdownDescription: '' });
    expect(corpos.at(-1)).toMatchObject({ markdown_content: ' ' });
  });
});
