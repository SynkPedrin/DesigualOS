import { describe, expect, it } from 'vitest';
import { comNomes, consultaDeMarcacao, filtrarMarcaveis, inserirMarcacao, paraEnvio, type PessoaMarcavel } from './marcacoes';

const ana: PessoaMarcavel = { id: '5518991110000@c.us', token: '5518991110000', nome: 'Ana' };
const anaPaula: PessoaMarcavel = { id: '5518992220000@c.us', token: '5518992220000', nome: 'Ana Paula' };
const joao: PessoaMarcavel = { id: '123456789012345@lid', token: '123456789012345', nome: 'João Silva' };

describe('marcação com @ no WhatsApp', () => {
  it('reconhece o "@termo" sendo digitado só no início ou depois de espaço', () => {
    expect(consultaDeMarcacao('oi @jo', 6)).toEqual({ inicio: 3, termo: 'jo' });
    expect(consultaDeMarcacao('@', 1)).toEqual({ inicio: 0, termo: '' });
    expect(consultaDeMarcacao('mail@jo', 7)).toBeNull(); // e-mail não abre a lista
    expect(consultaDeMarcacao('oi @jo silva', 12)).toBeNull(); // passou do espaço: já não é marcação
  });

  it('filtra sem acento, quem começa com o termo primeiro', () => {
    expect(filtrarMarcaveis([ana, anaPaula, joao], 'jo').map((p) => p.nome)).toEqual(['João Silva']);
    expect(filtrarMarcaveis([joao, ana, anaPaula], 'pau').map((p) => p.nome)).toEqual(['Ana Paula']);
    expect(filtrarMarcaveis([ana, joao], 'silv').map((p) => p.nome)).toEqual(['João Silva']);
  });

  it('insere "@Nome " no lugar do termo e põe o cursor depois', () => {
    expect(inserirMarcacao('oi @jo tudo bem', { inicio: 3, termo: 'jo' }, joao)).toEqual({ texto: 'oi @João Silva  tudo bem', cursor: 15 });
  });

  it('no envio, "@Nome" vira "@número" e o id vai em mentions; nome mais longo não é engolido pelo curto', () => {
    expect(paraEnvio('@Ana Paula e @Ana, vejam', [ana, anaPaula])).toEqual({
      texto: '@5518992220000 e @5518991110000, vejam',
      mentions: [anaPaula.id, ana.id],
    });
    // Apagou a marcação do texto: não marca.
    expect(paraEnvio('só a Ana', [ana])).toEqual({ texto: 'só a Ana', mentions: [] });
    // LID: o texto leva a parte antes do @, como o WhatsApp exige.
    expect(paraEnvio('@João Silva olha', [joao])).toEqual({ texto: '@123456789012345 olha', mentions: [joao.id] });
  });

  it('na bolha, o número marcado aparece com o nome de quem a gente conhece', () => {
    expect(comNomes('@5518991110000 e @5599999999999', [ana])).toBe('@Ana e @5599999999999');
  });
});
