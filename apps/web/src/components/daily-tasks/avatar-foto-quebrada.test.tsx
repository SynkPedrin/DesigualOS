import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Avatar } from './primitivas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Avatar', () => {
  it('foto que não carrega vira iniciais, não imagem quebrada', () => {
    const div = document.createElement('div');
    act(() => createRoot(div).render(<Avatar nome="Pedro Gabriel" url="https://x.supabase.co/storage/v1/object/public/user-uploads/avatars/u.jpeg" />));
    const img = div.querySelector('img')!;
    expect(img).not.toBeNull();
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toBe('PG');
  });
});
