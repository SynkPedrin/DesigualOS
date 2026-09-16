import { describe, expect, it } from 'vitest';
import { assembleContext, ORCAMENTO_PADRAO, type BlocoDeContexto } from './context-assembler';

const bloco = (fonte: BlocoDeContexto['fonte'], n: number): BlocoDeContexto => ({ fonte, texto: fonte[0]!.repeat(n) });

describe('assembleContext', () => {
  it('context_assembler_prioritizes_specific_recent_sources', () => {
    const p = assembleContext([
      { fonte: 'preferencias', texto: 'PREF' },
      { fonte: 'campanha', texto: 'CAMP' },
      { fonte: 'frescor', texto: 'FRESCOR' },
      { fonte: 'cliente', texto: 'CLIENTE' },
    ]);
    // Frescor muda como tudo abaixo deve ser lido: vem primeiro.
    expect(p.fontes).toEqual(['frescor', 'cliente', 'campanha', 'preferencias']);
    expect(p.texto.indexOf('FRESCOR')).toBeLessThan(p.texto.indexOf('CLIENTE'));
    expect(p.texto.indexOf('CAMP')).toBeLessThan(p.texto.indexOf('PREF'));
  });

  it('bloco gordo não zera os outros: o piso é respeitado', () => {
    // Sem piso, o dossiê de um cliente grande engolia campanha e pessoas.
    const p = assembleContext([bloco('cliente', 50_000), bloco('campanha', 50_000), bloco('pessoas', 50_000)], 6_000);
    expect(p.fontes).toEqual(['cliente', 'campanha', 'pessoas']);
    expect(p.tamanhoPorFonte.campanha!).toBeGreaterThanOrEqual(1_500);
    expect(p.tamanhoPorFonte.pessoas!).toBeGreaterThanOrEqual(600);
    expect(p.truncou).toBe(true);
  });

  it('fonte única usa o orçamento inteiro, sem reservar pra quem não existe', () => {
    const p = assembleContext([bloco('cliente', 50_000)], 5_000);
    expect(p.tamanhoPorFonte.cliente).toBe(5_000);
  });

  it('não gera pacote fantasma quando não há bloco útil', () => {
    expect(assembleContext([]).texto).toBe('');
    expect(assembleContext([{ fonte: 'cliente', texto: '   ' }]).texto).toBe('');
  });

  it('turno normal cabe inteiro, sem truncar', () => {
    const p = assembleContext([bloco('cliente', 3_000), bloco('campanha', 1_200), bloco('episodios', 500)], ORCAMENTO_PADRAO);
    expect(p.truncou).toBe(false);
    expect(p.totalChars).toBeLessThan(ORCAMENTO_PADRAO);
  });
});
