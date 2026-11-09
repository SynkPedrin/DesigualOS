import { describe, expect, it } from 'vitest';
import { numeroParaWhatsapp } from './numero';

describe('numeroParaWhatsapp', () => {
  it('DDD e número ganham o 55', () => {
    expect(numeroParaWhatsapp('(18) 99632-6160')).toBe('5518996326160');
    expect(numeroParaWhatsapp('18 3632-6160')).toBe('551836326160');
  });

  it('aceita o 55 já digitado e o 0 de longa distância', () => {
    expect(numeroParaWhatsapp('55 18 99632-6160')).toBe('5518996326160');
    expect(numeroParaWhatsapp('018 99632-6160')).toBe('5518996326160');
  });

  it('número de fora vem com + ou 00 e fica como está', () => {
    expect(numeroParaWhatsapp('+1 (415) 555-0100')).toBe('14155550100');
    expect(numeroParaWhatsapp('00351 912 345 678')).toBe('351912345678');
  });

  it('sem DDD ou curto demais não adivinha', () => {
    expect(numeroParaWhatsapp('99632-6160')).toBeNull();
    expect(numeroParaWhatsapp('abc')).toBeNull();
    expect(numeroParaWhatsapp('+12')).toBeNull();
    expect(numeroParaWhatsapp('1234567890123456')).toBeNull();
  });
});
