import { describe, expect, it } from 'vitest';
import { quebrarEmLinks } from './links-no-texto';

const links = (texto: string) => quebrarEmLinks(texto).filter((p) => p.tipo === 'link').map((p) => (p.tipo === 'link' ? [p.texto, p.href] : []));

describe('links no texto da mensagem', () => {
  it('reconhece https, www, domínio solto e e-mail', () => {
    expect(links('veja https://agenciadesigual.com.br/portfolio?x=1#topo agora')).toEqual([['https://agenciadesigual.com.br/portfolio?x=1#topo', 'https://agenciadesigual.com.br/portfolio?x=1#topo']]);
    expect(links('www.google.com')).toEqual([['www.google.com', 'https://www.google.com/']]);
    expect(links('o perfil é instagram.com/agenciadesigual')).toEqual([['instagram.com/agenciadesigual', 'https://instagram.com/agenciadesigual']]);
    expect(links('site novo: cliente.com.br')).toEqual([['cliente.com.br', 'https://cliente.com.br/']]);
    expect(links('manda pra joao.silva@cliente.com.br')).toEqual([['joao.silva@cliente.com.br', 'mailto:joao.silva@cliente.com.br']]);
  });

  it('pontuação e parêntese em volta não entram no link', () => {
    expect(links('acessa site.com.br.')).toEqual([['site.com.br', 'https://site.com.br/']]);
    expect(links('(ver https://a.com/x)')).toEqual([['https://a.com/x', 'https://a.com/x']]);
    expect(links('https://pt.wikipedia.org/wiki/Teste_(desambiguação), ok')[0]![0]).toBe('https://pt.wikipedia.org/wiki/Teste_(desambiguação)');
  });

  it('não inventa link em valor, versão, arquivo ou @menção', () => {
    expect(links('R$ 1.500,00 na v1.2 do arquivo.pdf para @Bruno Lima')).toEqual([]);
    expect(links('javascript:alert(1)')).toEqual([]);
  });

  it('o texto volta inteiro, na ordem', () => {
    const texto = 'oi, olha https://a.com e www.b.com.br!\nvaleu';
    expect(quebrarEmLinks(texto).map((p) => p.texto).join('')).toBe(texto);
  });
});
