import { describe, expect, it } from 'vitest';
import { extractLockedFacts, extractScreenText, findLockedFactViolations, normalizeMoney, renderLockedFactsBlock } from './locked-facts.js';
import { briefHasDirection, campaignBriefSchema, resolveBriefFormat } from './schema.js';

const BRIEF = campaignBriefSchema.parse({
  campaignName: 'Captação Setembro',
  objective: 'Gerar leads',
  offer: { name: 'Avaliação gratuita', price: 'R$ 375,00', installments: '12x', installmentValue: 'R$ 29,70' },
  cta: 'Agende agora',
  aspectRatio: '9:16',
  duration: 15,
});

const FACTS = extractLockedFacts(BRIEF);

function src(code: string) {
  return [{ path: 'src/Motion.tsx', content: code }];
}

describe('normalizeMoney — a conta que decide se o preço mudou', () => {
  it.each([
    ['R$ 375,00', '37500'],
    ['375', '37500'],
    ['R$ 375', '37500'],
    ['R$ 1.250,90', '125090'],
    ['R$ 29,70', '2970'],
  ])('%s vale %s centavos', (raw, esperado) => {
    expect(normalizeMoney(raw)).toBe(esperado);
  });

  it('375 e 3750 NÃO são o mesmo valor — é exatamente o erro que o §16 cita', () => {
    expect(normalizeMoney('R$ 375')).not.toBe(normalizeMoney('R$ 3.750'));
  });
});

describe('extração', () => {
  it('pega os valores que a pessoa escreveu', () => {
    const rotulos = FACTS.map((f) => f.label);
    expect(rotulos).toEqual(expect.arrayContaining(['Preço', 'Valor da parcela', 'Parcelamento', 'CTA']));
  });

  it('NÃO calcula parcela a partir do preço — isso seria inventar fato comercial', () => {
    const semParcela = extractLockedFacts(campaignBriefSchema.parse({ offer: { price: 'R$ 356,40' } }));
    expect(semParcela.find((f) => f.label === 'Valor da parcela')).toBeUndefined();
  });

  it('briefing vazio não produz fato nenhum', () => {
    expect(extractLockedFacts(null)).toEqual([]);
  });
});

describe('bloco do prompt', () => {
  it('lista os valores e proíbe a reescrita', () => {
    const bloco = renderLockedFactsBlock(FACTS);
    expect(bloco).toContain('R$ 375,00');
    expect(bloco).toContain('Agende agora');
    expect(bloco).toMatch(/não arredonde/i);
  });

  it('sem fato nenhum, o bloco proíbe INVENTAR — não fica em branco (§22)', () => {
    const bloco = renderLockedFactsBlock([]);
    expect(bloco).toMatch(/não invente/i);
    expect(bloco).toMatch(/sem preço/i);
  });
});

describe('varredura do código gerado (§16)', () => {
  const ok = src(`
    const PRECO = 'R$ 375,00';
    const PARCELA = 'R$ 29,70';
    export const Motion = () => <div>{PRECO} · 12x de {PARCELA} · Agende agora</div>;
  `);

  it('código que respeita o briefing passa limpo', () => {
    expect(findLockedFactViolations(ok, FACTS)).toEqual([]);
  });

  it('pega o caso exato do §16: R$ 375 virou R$ 3.750', () => {
    const violacoes = findLockedFactViolations(
      src(`const PRECO = 'R$ 3.750,00'; const CTA = 'Agende agora';`),
      FACTS,
    );
    expect(violacoes.some((v) => v.kind === 'valor_alterado' && v.detail.includes('3.750'))).toBe(true);
  });

  it('pega o arredondamento silencioso (375 -> 379)', () => {
    const violacoes = findLockedFactViolations(src(`const P = 'R$ 379,00'; const c='Agende agora';`), FACTS);
    expect(violacoes.some((v) => v.detail.includes('379'))).toBe(true);
  });

  it('pega porcentagem DIFERENTE da travada', () => {
    const comDesconto = extractLockedFacts(
      campaignBriefSchema.parse({ cta: 'Agende agora', offer: { price: 'R$ 375,00', discount: '30%' } }),
    );
    const violacoes = findLockedFactViolations(
      src(`const D = '50% OFF'; const P='R$ 375,00'; const c='Agende agora';`),
      comDesconto,
    );
    expect(violacoes.some((v) => v.detail.includes('50%'))).toBe(true);
  });

  it('NÃO confunde porcentagem de CSS com desconto', () => {
    const comDesconto = extractLockedFacts(
      campaignBriefSchema.parse({ cta: 'Agende agora', offer: { discount: '30%' } }),
    );
    const violacoes = findLockedFactViolations(
      src(`const bg = 'linear-gradient(180deg, hsl(220, 10%, 50%), transparent)'; const c='Agende agora';`),
      comDesconto,
    );
    expect(violacoes).toEqual([]);
  });

  it('acusa CTA travado que não chegou à tela', () => {
    const violacoes = findLockedFactViolations(src(`const P = 'R$ 375,00';`), FACTS);
    expect(violacoes.some((v) => v.kind === 'cta_ausente')).toBe(true);
  });

  it('aceita o CTA com acento e caixa diferentes', () => {
    const comAcento = extractLockedFacts(campaignBriefSchema.parse({ cta: 'Saiba mais' }));
    expect(findLockedFactViolations(src(`<div>SAIBA MAIS</div>`), comAcento)).toEqual([]);
  });

  it('NÃO confunde tamanho de fonte com preço', () => {
    const violacoes = findLockedFactViolations(
      src(`const s = { fontSize: 3750, letterSpacing: '1.250px' }; const P='R$ 375,00'; const c='Agende agora';`),
      FACTS,
    );
    expect(violacoes).toEqual([]);
  });

  it('pega o preço escrito como texto JSX, que é onde ele costuma estar', () => {
    const violacoes = findLockedFactViolations(src(`<div>R$ 3.750,00</div><span>Agende agora</span>`), FACTS);
    expect(violacoes.some((v) => v.kind === 'valor_alterado')).toBe(true);
  });

  it('sem briefing comercial, qualquer valor no código é invenção (§22)', () => {
    const violacoes = findLockedFactViolations(src(`const P = 'R$ 199,90';`), []);
    expect(violacoes[0]?.kind).toBe('valor_inventado');
  });

  it('peça sem número nenhum e sem briefing passa limpo', () => {
    expect(findLockedFactViolations(src(`<div>Conheça a nossa história</div>`), [])).toEqual([]);
  });
});

describe('formato efetivo e direção mínima', () => {
  it('o briefing manda mais que a frase do turno', () => {
    expect(resolveBriefFormat(BRIEF, { format: '1:1', durationSeconds: 30 })).toEqual({
      aspectRatio: '9:16',
      duration: 15,
      fps: 30,
    });
  });

  it('sem briefing, vale o que veio da frase', () => {
    expect(resolveBriefFormat(null, { format: '16:9', durationSeconds: 6, fps: 60 })).toEqual({
      aspectRatio: '16:9',
      duration: 6,
      fps: 60,
    });
  });

  it('briefing vazio não tem direção; um objetivo já tem', () => {
    expect(briefHasDirection({})).toBe(false);
    expect(briefHasDirection({ objective: 'Gerar leads' })).toBe(true);
  });
});
