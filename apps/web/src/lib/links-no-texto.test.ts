import { describe, expect, it } from 'vitest';
import { quebrarEmLinks, servicoDoLink } from './links-no-texto';

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
  it('markdown do ClickUp: [nome](url), <url> e escape com barra', () => {
    expect(links('[Pasta](https://x.sharepoint.com/:f:/s/D/E?e=1)')).toEqual([['Pasta', 'https://x.sharepoint.com/:f:/s/D/E?e=1']]);
    expect(links('<https://a.com/b>')).toEqual([['https://a.com/b', 'https://a.com/b']]);
    expect(links('https://x.sharepoint.com/s/Agencia\\_Desigual/a\\_b')).toEqual([['https://x.sharepoint.com/s/Agencia_Desigual/a_b', 'https://x.sharepoint.com/s/Agencia_Desigual/a_b']]);
    expect(links('[pro João](mailto:joao@cliente.com.br)')).toEqual([['pro João', 'mailto:joao@cliente.com.br']]);
    expect(links('[perigo](javascript:alert(1))')).toEqual([]);
  });

  it('reconhece o serviço e o tipo do arquivo pelo endereço', () => {
    expect(servicoDoLink('https://agencia.sharepoint.com/:x:/s/D/E?e=1')).toEqual({ servico: 'SharePoint', tipo: 'Planilha' });
    expect(servicoDoLink('https://agencia-my.sharepoint.com/:w:/g/personal/p/E')).toEqual({ servico: 'OneDrive', tipo: 'Documento' });
    expect(servicoDoLink('https://agencia.sharepoint.com/sites/C/Shared%20Documents/Forms/AllItems.aspx')).toEqual({ servico: 'SharePoint', tipo: 'Pasta' });
    expect(servicoDoLink('https://docs.google.com/spreadsheets/d/1')).toEqual({ servico: 'Google', tipo: 'Planilha' });
    expect(servicoDoLink('https://cliente.com.br/')).toBeNull();
  });
});
