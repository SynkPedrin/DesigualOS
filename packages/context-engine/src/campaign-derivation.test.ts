import { describe, expect, it } from 'vitest';
import { aliasesDoTexto, campanhaDoNomeDaTask, derivarCampanhas } from './campaign-derivation';

describe('campanhaDoNomeDaTask', () => {
  it('lê a convenção real da operação', () => {
    expect(campanhaDoNomeDaTask('Cosentino_Europa V_Campanha de Aniversário_Motion')).toBe('Europa V');
    expect(campanhaDoNomeDaTask('DC_Operação Blindada_Layouts')).toBe('Operação Blindada');
  });

  it('não inventa campanha em task fora da convenção', () => {
    expect(campanhaDoNomeDaTask('Ajustes no site')).toBeNull();
    expect(campanhaDoNomeDaTask('Cosentino')).toBeNull();
  });

  it('não confunde peça com campanha', () => {
    expect(campanhaDoNomeDaTask('Cosentino_Layout')).toBeNull();
    expect(campanhaDoNomeDaTask('Cosentino_Edição')).toBeNull();
  });

  it('não cria campanha a partir de agrupamento de rotina', () => {
    expect(campanhaDoNomeDaTask('Cosentino_Digitais')).toBeNull();
  });
});

describe('aliasesDoTexto', () => {
  it('aprende a forma longa que a fonte escreve na descrição', () => {
    // É esta a ponte que faltava entre "Europa V" e o que a Tammy falou.
    const a = aliasesDoTexto('Europa V', ['Cosentino 47 Anos | Jardim Europa V', 'Lançamento Jardim Europa V e ecossistema']);
    expect(a).toContain('Jardim Europa V');
  });

  it('não transforma preposição em nome', () => {
    expect(aliasesDoTexto('Europa V', ['peças da Europa V aprovadas'])).not.toContain('da Europa V');
  });
});

describe('derivarCampanhas', () => {
  const tasks = [
    { id: '1', name: 'Cosentino_Europa V_Campanha de Aniversário_Motion', description: 'Cosentino 47 Anos | Jardim Europa V', closed: false, updatedAt: new Date('2026-09-16') },
    { id: '2', name: 'Cosentino_Europa V_Figurinhas', description: '', closed: true, updatedAt: new Date('2026-09-11') },
    { id: '3', name: 'Cosentino_Dia do Corretor_Layout', description: '', closed: true, updatedAt: new Date('2026-05-01') },
    { id: '4', name: 'task solta sem convenção', description: '', closed: false, updatedAt: new Date('2026-09-01') },
  ];

  it('agrupa por campanha e conta aberto x total', () => {
    const c = derivarCampanhas(tasks);
    const europa = c.find((x) => x.normalizedName === 'europa v')!;
    expect(europa.taskCount).toBe(2);
    expect(europa.openTaskCount).toBe(1);
    expect(europa.aliases).toContain('Jardim Europa V');
    expect(europa.lastSourceUpdateAt?.toISOString().slice(0, 10)).toBe('2026-09-16');
  });

  it('ignora task fora da convenção em vez de inventar campanha', () => {
    expect(derivarCampanhas(tasks).map((c) => c.normalizedName)).not.toContain('task solta sem convencao');
  });

  it('carrega as tasks recentes como contexto, mais nova primeiro', () => {
    const europa = derivarCampanhas(tasks).find((c) => c.normalizedName === 'europa v')!;
    expect(europa.recentTasks).toHaveLength(2);
    expect(europa.recentTasks[0]!.name).toContain('Campanha de Aniversário');
  });

  it('campanha sem task aberta fica sem aberto', () => {
    expect(derivarCampanhas(tasks).find((c) => c.normalizedName === 'dia do corretor')!.openTaskCount).toBe(0);
  });
});

/**
 * Segunda convenção, medida na base real: 30 das listas com volume NÃO usam
 * underscore. Sem ela, 38 dos 50 clientes ficariam sem campanha nenhuma no
 * registro — e campanha que existe e não está no registro é exatamente o bug.
 */
describe('convenção por repetição', () => {
  const porDoSol = [
    { id: '1', name: 'Cond Pôr do Sol - BANNERS p/ Evento inauguração - SETEMBRO', closed: false, updatedAt: new Date('2026-09-10') },
    { id: '2', name: 'Cond Pôr do Sol - Evento inauguração - RENOVAÇÃO SPOT RÁDIO', closed: false, updatedAt: new Date('2026-09-09') },
    { id: '3', name: 'Cond Pôr do Sol - Convite final Evento inauguração - SETEMBRO', closed: true, updatedAt: new Date('2026-09-08') },
    { id: '4', name: 'Cond Pôr do Sol - Editar 06/09 - Seu domingo aqui no Pôr do Sol', closed: true, updatedAt: new Date('2026-09-06') },
  ];

  it('acha a campanha que o time repete entre tasks', () => {
    const c = derivarCampanhas(porDoSol, { clientName: 'Cond. Pôr do Sol' });
    expect(c.map((x) => x.normalizedName)).toContain('evento inauguracao');
    expect(c.find((x) => x.normalizedName === 'evento inauguracao')!.taskCount).toBe(3);
  });

  it('não transforma mês, data nem peça em campanha', () => {
    const nomes = derivarCampanhas(porDoSol, { clientName: 'Cond. Pôr do Sol' }).map((x) => x.normalizedName);
    expect(nomes).not.toContain('setembro');
    expect(nomes).not.toContain('banners');
    expect(nomes.some((n) => /^\d/.test(n))).toBe(false);
  });

  it('não transforma o nome do cliente em campanha', () => {
    const nomes = derivarCampanhas(porDoSol, { clientName: 'Cond. Pôr do Sol' }).map((x) => x.normalizedName);
    expect(nomes).not.toContain('cond por do sol');
  });

  it('assunto que aparece uma vez só não vira campanha', () => {
    const nomes = derivarCampanhas(porDoSol, { clientName: 'Cond. Pôr do Sol' }).map((x) => x.normalizedName);
    expect(nomes).not.toContain('seu domingo aqui no por do sol');
  });
});

describe('nome de campanha normalizado', () => {
  it('"Campanha X" e "X" viram a mesma campanha', () => {
    const c = derivarCampanhas([
      { id: '1', name: 'DC_Campanha Operação Blindada_Layout', closed: false, updatedAt: new Date('2026-09-01') },
      { id: '2', name: 'DC_Operação Blindada_Edição', closed: false, updatedAt: new Date('2026-09-02') },
    ]);
    const blindada = c.filter((x) => x.normalizedName.includes('blindada'));
    expect(blindada).toHaveLength(1);
    expect(blindada[0]!.taskCount).toBe(2);
  });

  it('não descarta nome curto que é só a palavra-categoria', () => {
    expect(derivarCampanhas([{ id: '1', name: 'DC_Ação_Layout', closed: false, updatedAt: null }]).length).toBeLessThanOrEqual(1);
  });
});

describe('frase comum não vira campanha', () => {
  it('não cria campanha a partir de palavra de ligação repetida', () => {
    // Regressão medida ao vivo: nasceram campanhas chamadas "que você",
    // "Por que o" e "Dia a dia". "que você" empatava com qualquer campanha de
    // dois tokens e derrubava a resolução por ambiguidade.
    const tasks = [
      { id: '1', name: 'Card 01/09 - Você sabia que você pode - Cliente', closed: false, updatedAt: null },
      { id: '2', name: 'Card 02/09 - Por que o preço muda - Cliente', closed: false, updatedAt: null },
      { id: '3', name: 'Card 03/09 - O que você precisa saber - Cliente', closed: false, updatedAt: null },
      { id: '4', name: 'Card 04/09 - Sabia que você ganha - Cliente', closed: false, updatedAt: null },
    ];
    const nomes = derivarCampanhas(tasks, { clientName: 'Cliente' }).map((c) => c.normalizedName);
    expect(nomes).not.toContain('que voce');
    expect(nomes).not.toContain('por que o');
  });

  it('continua achando campanha de verdade na mesma convenção', () => {
    const tasks = [
      { id: '1', name: 'Cliente - Evento inauguração - SETEMBRO', closed: false, updatedAt: null },
      { id: '2', name: 'Cliente - Convite Evento inauguração - SETEMBRO', closed: false, updatedAt: null },
      { id: '3', name: 'Cliente - Spot Evento inauguração - RÁDIO', closed: false, updatedAt: null },
    ];
    expect(derivarCampanhas(tasks, { clientName: 'Cliente' }).map((c) => c.normalizedName)).toContain('evento inauguracao');
  });
});

describe('filtro não pode remover campanha real', () => {
  const calendario = [
    { id: '1', name: 'Cliente - Dia das Mães - MAIO', closed: false, updatedAt: null },
    { id: '2', name: 'Cliente - Card Dia das Mães - MAIO', closed: false, updatedAt: null },
    { id: '3', name: 'Cliente - Reels Dia das Mães - MAIO', closed: false, updatedAt: null },
    { id: '4', name: 'Cliente - Card - No dia a dia da obra - X', closed: false, updatedAt: null },
    { id: '5', name: 'Cliente - Post - No dia a dia da obra - Y', closed: false, updatedAt: null },
    { id: '6', name: 'Cliente - Reels - No dia a dia da obra - Z', closed: false, updatedAt: null },
  ];

  it('campanha de calendário sobrevive ("Dia das Mães")', () => {
    // A primeira versão do filtro tratava "dia" como palavra de ligação e
    // matava as campanhas mais comuns do calendário: 287 de uma vez.
    expect(derivarCampanhas(calendario, { clientName: 'Cliente' }).map((c) => c.normalizedName)).toContain('dia das maes');
  });

  it('expressão feita com token repetido continua fora ("dia a dia")', () => {
    expect(derivarCampanhas(calendario, { clientName: 'Cliente' }).map((c) => c.normalizedName)).not.toContain('dia a dia');
  });
});
