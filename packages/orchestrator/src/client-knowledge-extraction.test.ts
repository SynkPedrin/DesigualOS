import { describe, expect, it } from 'vitest';
import { clientFactSubject, extractClientFacts } from './client-knowledge-extraction';

describe('extractClientFacts', () => {
  it('captura fato com verbo de registro e cliente citado', () => {
    const [f] = extractClientFacts('Anota no brain da Colormaq que o carro-chefe é tanquinho e lavadora semiautomática.');
    expect(f).toBeDefined();
    expect(f!.clientName).toBe('Colormaq');
    expect(f!.aspect).toBe('produto');
    expect(f!.value).toContain('tanquinho');
  });

  it('classifica o aspecto pra dar supersessão à correção', () => {
    expect(extractClientFacts('Registra que o decisor da Yak Sushibar é o Rogério.')[0]!.aspect).toBe('decisor');
    expect(extractClientFacts('Anota que o público da Yak Sushibar é família com filho pequeno.')[0]!.aspect).toBe('publico');
    expect(extractClientFacts('Corrige: a Yak Sushibar não pode usar imagem de salmão cru.')[0]!.aspect).toBe('restricao');
  });

  it('NÃO captura frase sem verbo de registro', () => {
    // Contar de passagem não é pedir pra gravar. Este é o caso que envenenaria
    // o dossiê em silêncio se a extração fosse esperta demais.
    expect(extractClientFacts('Acho que o público da Colormaq é classe C.')).toEqual([]);
    expect(extractClientFacts('Faz um carrossel pra Colormaq sobre lavadora.')).toEqual([]);
  });

  it('NÃO captura pergunta, mesmo com verbo de registro', () => {
    // "anota quem é o decisor?" está PEDINDO o dado, não entregando.
    expect(extractClientFacts('Anota quem é o decisor da Colormaq?')).toEqual([]);
  });

  it('NÃO captura enunciado sem fato dentro', () => {
    expect(extractClientFacts('Anota aí.')).toEqual([]);
    expect(extractClientFacts('Registra isso pra mim.')).toEqual([]);
  });

  it('limpa o enunciado, guardando o fato e não a ordem', () => {
    const [f] = extractClientFacts('Anota aí que a Engeuni atende em Birigui e Araçatuba.');
    expect(f!.value).not.toMatch(/^anota/i);
    expect(f!.value).toContain('Birigui');
  });

  it('separa fatos distintos na mesma mensagem, sem duplicar o repetido', () => {
    const fs = extractClientFacts(
      'Anota que o decisor da Elite é a Marina. Registra que a praça da Elite é Birigui. Anota que o decisor da Elite é a Marina.',
    );
    expect(fs).toHaveLength(2);
    expect(fs.map((f) => f.aspect).sort()).toEqual(['decisor', 'praca']);
  });

  it('mensagem comum de trabalho não vira conhecimento', () => {
    expect(extractClientFacts('Bento, quantas tarefas vencem hoje?')).toEqual([]);
    expect(extractClientFacts('')).toEqual([]);
  });
});

describe('clientFactSubject', () => {
  it('aspecto nomeado supersede: mesmo subject para o mesmo aspecto', () => {
    const a = clientFactSubject('c1', { clientName: 'X', aspect: 'decisor', value: 'é o João', source: '' });
    const b = clientFactSubject('c1', { clientName: 'X', aspect: 'decisor', value: 'na verdade é a Ana', source: '' });
    expect(a).toBe(b);
    expect(a).toBe('cliente:c1:aprendizado:decisor');
  });

  it('fato geral NÃO apaga outro fato geral', () => {
    const a = clientFactSubject('c1', { clientName: 'X', aspect: 'geral', value: 'a fábrica fecha em janeiro', source: '' });
    const b = clientFactSubject('c1', { clientName: 'X', aspect: 'geral', value: 'o galpão novo abre em março', source: '' });
    expect(a).not.toBe(b);
  });

  it('isola por cliente: o mesmo aspecto em clientes diferentes não colide', () => {
    const a = clientFactSubject('c1', { clientName: 'X', aspect: 'decisor', value: 'v', source: '' });
    const b = clientFactSubject('c2', { clientName: 'Y', aspect: 'decisor', value: 'v', source: '' });
    expect(a).not.toBe(b);
  });
});

describe('cliente citado na forma natural', () => {
  it('pega "da <Cliente>" sem exigir a palavra cliente', () => {
    const [f] = extractClientFacts('Anota que o decisor da Colormaq é a Marina.');
    expect(f!.clientName).toBe('Colormaq');
    expect(f!.aspect).toBe('decisor');
  });

  it('pega nome composto e com número', () => {
    expect(extractClientFacts('Registra que a praça da D. Carvalho é Araçatuba.')[0]!.clientName).toBe('D. Carvalho');
    expect(extractClientFacts('Anota que o público da Clinica Teste Fase 7 é idoso.')[0]!.clientName).toBe(
      'Clinica Teste Fase 7',
    );
  });

  it('NÃO confunde palavra comum com nome de cliente', () => {
    // "da empresa" em minúscula não é nome próprio; o fato fica com o cliente
    // da execução em vez de inventar um dono.
    expect(extractClientFacts('Anota que o decisor da empresa é o dono.')[0]!.clientName).toBeNull();
  });
});

describe('quebra de frase ciente de abreviação', () => {
  it('não parte o nome do cliente no ponto da abreviação', () => {
    // Regressão: "da D. Carvalho" virava duas frases e o fato perdia o dono.
    const [f] = extractClientFacts('Registra que a praça da D. Carvalho é Araçatuba, Andradina e Presidente Prudente.');
    expect(f!.clientName).toBe('D. Carvalho');
    expect(f!.value).toContain('Andradina');
  });

  it('continua separando frases de verdade', () => {
    const fs = extractClientFacts('Anota que o decisor da Elite é a Marina. Registra que a praça da Elite é Birigui.');
    expect(fs).toHaveLength(2);
  });
});

describe('eco do histórico na mensagem', () => {
  it('não grava o mesmo fato duas vezes quando a frase vem também como linha de histórico', () => {
    // Regressão medida ao vivo: a mesma execução gravou o fato limpo E a versão
    // com "- Usuário:" colado no conteúdo, e a suja superseded a limpa.
    const fs = extractClientFacts(
      '- Usuário: Corrige que o decisor da Elite é o Dr. Paulo.\nCorrige que o decisor da Elite é o Dr. Paulo.',
    );
    expect(fs).toHaveLength(1);
    expect(fs[0]!.value).not.toMatch(/usu[áa]rio/i);
    expect(fs[0]!.value.startsWith('o decisor')).toBe(true);
  });

  it('remove o marcador de locutor mas mantém o fato', () => {
    const [f] = extractClientFacts('Assistente: anota que a praça da Elite é Birigui.');
    expect(f!.value).not.toMatch(/assistente/i);
    expect(f!.value).toContain('Birigui');
  });

  it('um aspecto por cliente por mensagem, mas clientes diferentes coexistem', () => {
    const fs = extractClientFacts(
      'Anota que o decisor da Elite é a Marina. Anota que o decisor da Colormaq é o João.',
    );
    expect(fs).toHaveLength(2);
    expect(fs.map((f) => f.clientName).sort()).toEqual(['Colormaq', 'Elite']);
  });
});
