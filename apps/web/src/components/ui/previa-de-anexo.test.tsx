import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AbrirPrevia, temPrevia } from './previa-de-anexo';

/**
 * A prévia existe para resolver um custo invisível: abrir um briefing em PDF
 * tirava a pessoa da conversa — nova aba, ler, voltar, reencontrar o fio.
 * "Ícone com nome do arquivo" nunca foi prévia; era um link disfarçado.
 *
 * O que estes testes travam é a fronteira do que abre e do que não abre. Ela
 * importa porque errar para mais é pior: mostrar uma caixa cinza fingindo que
 * carregou um .docx é menos honesto que dizer "baixe e abra no programa certo".
 */

function montar(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(ui));
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('temPrevia, a fronteira do que o navegador sabe mostrar', () => {
  it('imagem e PDF abrem aqui', () => {
    expect(temPrevia('image/png')).toBe(true);
    expect(temPrevia('image/jpeg')).toBe(true);
    expect(temPrevia('application/pdf')).toBe(true);
  });

  /** Nada de miniatura de Office: exigiria baixar e parsear binário pesado
   *  para mostrar algo que o sistema não tem como garantir fiel. */
  it('documento de Office e tipo desconhecido não prometem prévia', () => {
    expect(temPrevia('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    expect(temPrevia('application/zip')).toBe(false);
    expect(temPrevia(null)).toBe(false);
  });
});

describe('AbrirPrevia', () => {
  it('arquivo com prévia vira botão, não link, o clique fica na página', () => {
    const c = montar(
      <AbrirPrevia anexo={{ url: 'https://x/b.pdf', filename: 'briefing.pdf', contentType: 'application/pdf' }}>
        <span>briefing.pdf</span>
      </AbrirPrevia>,
    );

    expect(c.querySelector('button')).not.toBeNull();
    expect(c.querySelector('a')).toBeNull();
  });

  /** Sem prévia, nada regride: continua sendo o link para a aba nova. */
  it('arquivo sem prévia continua sendo link para aba nova', () => {
    const c = montar(
      <AbrirPrevia anexo={{ url: 'https://x/p.zip', filename: 'pack.zip', contentType: 'application/zip' }}>
        <span>pack.zip</span>
      </AbrirPrevia>,
    );

    const link = c.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://x/p.zip');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(c.querySelector('button')).toBeNull();
  });

  it('clicar abre a prévia do PDF num iframe', () => {
    const c = montar(
      <AbrirPrevia anexo={{ url: 'https://x/b.pdf', filename: 'briefing.pdf', contentType: 'application/pdf' }}>
        <span>briefing.pdf</span>
      </AbrirPrevia>,
    );

    act(() => {
      c.querySelector('button')!.click();
    });

    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.getAttribute('aria-label')).toBe('Prévia de briefing.pdf');
    expect(dialogo?.querySelector('iframe')?.getAttribute('src')).toBe('https://x/b.pdf');
  });

  it('imagem abre em tamanho real, não em iframe', () => {
    const c = montar(
      <AbrirPrevia anexo={{ url: 'https://x/a.png', filename: 'arte.png', contentType: 'image/png' }}>
        <span>arte.png</span>
      </AbrirPrevia>,
    );

    act(() => {
      c.querySelector('button')!.click();
    });

    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.querySelector('img')?.getAttribute('src')).toBe('https://x/a.png');
    expect(dialogo?.querySelector('iframe')).toBeNull();
  });

  /** Baixar continua possível com a prévia aberta — ver não substitui ter. */
  it('a prévia oferece baixar sem fechar', () => {
    const c = montar(
      <AbrirPrevia anexo={{ url: 'https://x/b.pdf', filename: 'briefing.pdf', contentType: 'application/pdf' }}>
        <span>briefing.pdf</span>
      </AbrirPrevia>,
    );
    act(() => {
      c.querySelector('button')!.click();
    });

    const baixar = document.querySelector('[role="dialog"] a[download]');
    expect(baixar?.getAttribute('href')).toBe('https://x/b.pdf');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('Esc fecha', () => {
    const c = montar(
      <AbrirPrevia anexo={{ url: 'https://x/a.png', filename: 'arte.png', contentType: 'image/png' }}>
        <span>arte.png</span>
      </AbrirPrevia>,
    );
    act(() => {
      c.querySelector('button')!.click();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
