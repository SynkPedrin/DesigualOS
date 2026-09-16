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
