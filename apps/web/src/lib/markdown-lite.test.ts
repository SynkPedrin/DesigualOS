import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownLite } from './markdown-lite';

/**
 * Regressão da FORMA da legenda (16/09/2026).
 *
 * Legenda de Instagram é escrita em blocos curtos com respiro entre eles,
 * emoji com função, CTA e hashtags na última linha. O HTML colapsa `\n` dentro
 * de <p>, então ela chegava na tela como parágrafo corrido: o clipboard
 * entregava o texto certo e a tela mostrava a forma errada, e quem revisava
 * decidia no escuro.
 *
 * Sem JSX e sem @testing-library de propósito: o pacote não tem nenhum dos
 * dois configurados, e este teste não justifica adicionar dependência.
 */
const render = (texto: string) => renderToStaticMarkup(createElement(MarkdownLite, { text: texto }));

const LEGENDA_REAL = `Ousadia tem. Histórico também. Quando você cuida de gente de verdade há anos, a confiança fala antes de qualquer palavra.

Se você ainda não conhece a Fácil, talvez esse seja o sinal. 😉

📲 Link na bio.

#FácilSeguros #CorretoraDaRegião #Birigui`;

describe('MarkdownLite preserva a forma da legenda', () => {
  it('a quebra de linha simples sobrevive dentro do parágrafo', () => {
    const html = render('Primeira linha.\nSegunda linha.\nTerceira.');
    // A classe é o que instrui o navegador a respeitar a quebra.
    expect(html).toContain('whitespace-pre-line');
    expect(html).toContain('Primeira linha.\nSegunda linha.');
  });

  it('legenda real mantém blocos, emoji, CTA e hashtags', () => {
    const html = render(LEGENDA_REAL);
    expect(html).toContain('😉');
    expect(html).toContain('📲');
    expect(html).toContain('#FácilSeguros');
    // Quatro blocos separados por linha em branco viram quatro parágrafos.
    expect(html.match(/<p /g) ?? []).toHaveLength(4);
  });

  it('lista continua sendo lista', () => {
    expect((render('- primeiro\n- segundo').match(/<li>/g) ?? [])).toHaveLength(2);
  });
});
