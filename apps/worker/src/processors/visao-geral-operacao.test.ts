import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
vi.mock('@desigual-os/orchestrator', () => ({ recallMemoriesSemantic: vi.fn() }));

import type { FotoOperacao } from './visao-geral-operacao';

const BASE: FotoOperacao = {
  clientes: { total: 12, nomes: ['3Net', 'Colpar', 'Elite'] },
  inbox: {
    abertas: 4,
    aguardandoResposta: 2,
    ultimas: [{ cliente: 'Elite', remetente: null, trecho: 'pode mandar o relatório?', quando: new Date('2026-11-09T13:00:00Z') }],
  },
  dailyTasks: { hoje: 7, atrasadas: 3, bloqueadas: 1, semResponsavel: 2, clientesAtivos: 5 },
  aprovacoesPendentes: 2,
  demandasAbertas: 6,
};

describe('visaoGeralEmTexto', () => {
  it('cobre clientes, inbox com últimas mensagens, daily tasks, aprovações e demandas — cada linha com a fonte', async () => {
    const { visaoGeralEmTexto } = await import('./visao-geral-operacao');
    const t = visaoGeralEmTexto(BASE);
    expect(t).toContain('VISÃO GERAL DA OPERAÇÃO');
    expect(t).toContain('Clientes (cadastro do OS): 12 ativo(s) — 3Net, Colpar, Elite, e mais 9.');
    expect(t).toContain('Inbox (WhatsApp/mensagens, Desigual OS): 4 conversa(s) aberta(s), 2 com a última mensagem do cliente sem resposta há mais de 24h.');
    expect(t).toContain('Elite: "pode mandar o relatório?"');
    expect(t).toContain('Daily Tasks (Desigual OS): 7 com prazo hoje, 3 atrasada(s), 1 bloqueada(s), 2 sem responsável, em 5 cliente(s).');
    expect(t).toContain('Aprovações (Desigual OS): 2 pendente(s) na organização.');
    expect(t).toContain('Demandas (Desigual OS): 6 aberta(s) na organização.');
  });

  it('zero é "nenhum registrado", nunca silêncio — e a nota de honestidade fecha o bloco', async () => {
    const { visaoGeralEmTexto } = await import('./visao-geral-operacao');
    const t = visaoGeralEmTexto({
      clientes: { total: 0, nomes: [] },
      inbox: { abertas: 0, aguardandoResposta: 0, ultimas: [] },
      dailyTasks: { hoje: 0, atrasadas: 0, bloqueadas: 0, semResponsavel: 0, clientesAtivos: 0 },
      aprovacoesPendentes: 0,
      demandasAbertas: 0,
    });
    expect(t).toContain('nenhum cliente ativo registrado');
    expect(t).toContain('nenhuma conversa aberta registrada');
    expect(t).toContain('nenhuma pendente registrada');
    expect(t).toContain('nenhuma aberta registrada');
    expect(t).toContain('NÃO que não existe trabalho');
  });

  it('daily tasks indisponível é declarado, não convertido em zero', async () => {
    const { visaoGeralEmTexto } = await import('./visao-geral-operacao');
    const t = visaoGeralEmTexto({ ...BASE, dailyTasks: null });
    expect(t).toContain('Daily Tasks (Desigual OS): leitura indisponível agora — não conclua que não há tarefas.');
  });
});

describe('blocoMemoriaSemantica', () => {
  it('sem organização não consulta nada', async () => {
    const { blocoMemoriaSemantica } = await import('./visao-geral-operacao');
    const { recallMemoriesSemantic } = await import('@desigual-os/orchestrator');
    const r = await blocoMemoriaSemantica({ pergunta: 'o que a Elite pediu?', environment: 'production', organizationId: null, clientId: null });
    expect(r).toBeNull();
    expect(recallMemoriesSemantic).not.toHaveBeenCalled();
  });

  it('com memórias, cada item leva a origem; sem memória, null', async () => {
    const { blocoMemoriaSemantica } = await import('./visao-geral-operacao');
    const { recallMemoriesSemantic } = await import('@desigual-os/orchestrator');
    vi.mocked(recallMemoriesSemantic).mockResolvedValueOnce([
      { kind: 'cliente:vault', subject: 'cliente:elite:vault', content: 'A Elite pediu relatório semanal toda segunda.' },
    ] as never);
    const r = await blocoMemoriaSemantica({ pergunta: 'o que a Elite pediu?', environment: 'production', organizationId: 'org-1', clientId: null });
    expect(r).toContain('MEMÓRIAS RELEVANTES');
    expect(r).toContain('[cliente:vault · cliente:elite:vault] A Elite pediu relatório semanal toda segunda.');

    vi.mocked(recallMemoriesSemantic).mockResolvedValueOnce([]);
    await expect(blocoMemoriaSemantica({ pergunta: 'x', environment: 'production', organizationId: 'org-1', clientId: null })).resolves.toBeNull();
  });

  it('falha do recall degrada pra null, nunca pra erro', async () => {
    const { blocoMemoriaSemantica } = await import('./visao-geral-operacao');
    const { recallMemoriesSemantic } = await import('@desigual-os/orchestrator');
    vi.mocked(recallMemoriesSemantic).mockRejectedValueOnce(new Error('openai fora'));
    await expect(blocoMemoriaSemantica({ pergunta: 'x', environment: 'production', organizationId: 'org-1', clientId: null })).resolves.toBeNull();
  });
});
