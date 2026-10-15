import { describe, expect, it } from 'vitest';
import type { PipelineStage } from '@desigual-os/types';
import {
  ehTarefaDeTeste,
  categoriaDoCliente,
  categoriaDoStatus,
  estagioDaCategoria,
  garantirEstagiosGerais,
  statusDaListaParaCategoria,
} from './quadro-geral';

describe('categoriaDoStatus', () => {
  /** Os status reais das listas da agência (levantados em 15/10/2026). */
  it('traduz o fluxo real da agência', () => {
    expect(categoriaDoStatus('aberto', 'open')).toBe('a_fazer');
    expect(categoriaDoStatus('to do', 'open')).toBe('a_fazer');
    expect(categoriaDoStatus('pendente', 'custom')).toBe('a_fazer');
    expect(categoriaDoStatus('em progresso', 'custom')).toBe('em_andamento');
    expect(categoriaDoStatus('aguardando aprovação', 'custom')).toBe('em_aprovacao');
    expect(categoriaDoStatus('pronto', 'done')).toBe('concluido');
    expect(categoriaDoStatus('encerrado', 'closed')).toBe('concluido');
    expect(categoriaDoStatus('complete', 'done')).toBe('concluido');
    expect(categoriaDoStatus('complete', 'closed')).toBe('concluido');
  });

  it('alteração e reprovado são retrabalho da agência: em andamento, não aprovação', () => {
    expect(categoriaDoStatus('alteração', 'custom')).toBe('em_andamento');
    expect(categoriaDoStatus('reprovado', 'custom')).toBe('em_andamento');
  });

  it('sem o tipo (webhook), decide só pelo nome', () => {
    expect(categoriaDoStatus('aberto', null)).toBe('a_fazer');
    expect(categoriaDoStatus('aguardando aprovação', null)).toBe('em_aprovacao');
    expect(categoriaDoStatus('pronto', null)).toBe('concluido');
    expect(categoriaDoStatus('em produção', null)).toBe('em_andamento');
  });
});

describe('categoriaDoCliente', () => {
  const t = (status: string, statusType: string) => ({ status, statusType });

  it('vai para onde está a maior parte do que está aberto', () => {
    expect(categoriaDoCliente([t('aguardando aprovação', 'custom'), t('aguardando aprovação', 'custom'), t('aberto', 'open')])).toBe('em_aprovacao');
  });

  it('empate fica com a menos avançada', () => {
    expect(categoriaDoCliente([t('aberto', 'open'), t('em progresso', 'custom')])).toBe('a_fazer');
  });

  it('sem nada aberto, o cliente está em dia: Concluído', () => {
    expect(categoriaDoCliente([])).toBe('concluido');
    expect(categoriaDoCliente([t('pronto', 'done')])).toBe('concluido');
  });
});

describe('garantirEstagiosGerais', () => {
  it('quadro de clientes: aproveita colunas de nome inequívoco, acrescenta as que faltam e não toca no funil comercial', () => {
    const stages: PipelineStage[] = [
      { id: 'novo', label: 'Novo', color: 'info' },
      { id: 'proposta', label: 'Proposta', color: 'aviso' },
      { id: 'andamento', label: 'Em andamento', color: 'roxo-eletrico' },
      { id: 'fim', label: 'Concluído', color: 'sinal' },
    ];
    const r = garantirEstagiosGerais(stages);
    expect(r.find((s) => s.id === 'novo')?.categoria).toBe('a_fazer');
    expect(r.find((s) => s.id === 'proposta')?.categoria).toBeUndefined();
    expect(r.find((s) => s.id === 'andamento')?.categoria).toBe('em_andamento');
    expect(r.find((s) => s.id === 'fim')?.categoria).toBe('concluido');
    expect(estagioDaCategoria(r, 'em_aprovacao')?.label).toBe('Em aprovação');
    // A coluna própria continua na posição em que a pessoa a pôs.
    expect(r[1]!.id).toBe('proposta');
  });

  it('quadro geral de tarefas: o legado vira as quatro categorias, mantendo id, e o clickupStatus inventado sai', () => {
    const legado: PipelineStage[] = [
      { id: 'a', label: 'Para fazer', color: 'info', clickupStatus: 'Para fazer' },
      { id: 'b', label: 'Em produção', color: 'roxo-eletrico', clickupStatus: 'Em produção' },
      { id: 'c', label: 'Revisão', color: 'aviso', clickupStatus: 'Revisão' },
      { id: 'd', label: 'Concluído', color: 'sinal', clickupStatus: 'Concluído' },
    ];
    const r = garantirEstagiosGerais(legado, { soCategorias: true });
    expect(r.map((s) => [s.id, s.categoria])).toEqual([
      ['a', 'a_fazer'],
      ['b', 'em_andamento'],
      ['c', 'em_aprovacao'],
      ['d', 'concluido'],
    ]);
    expect(r.every((s) => s.clickupStatus === undefined)).toBe(true);
  });

  it('é estável: aplicar de novo não muda nada', () => {
    const uma = garantirEstagiosGerais([{ id: 'x', label: 'Novo', color: 'info' }]);
    expect(garantirEstagiosGerais(uma)).toEqual(uma);
  });
});

describe('statusDaListaParaCategoria', () => {
  const fluxo = [
    { status: 'aberto', type: 'open' },
    { status: 'aguardando aprovação', type: 'custom' },
    { status: 'alteração', type: 'custom' },
    { status: 'pronto', type: 'done' },
    { status: 'encerrado', type: 'closed' },
  ];

  it('escolhe o primeiro status da lista que cai na categoria de destino', () => {
    expect(statusDaListaParaCategoria(fluxo, 'em_aprovacao')).toBe('aguardando aprovação');
    expect(statusDaListaParaCategoria(fluxo, 'em_andamento')).toBe('alteração');
    expect(statusDaListaParaCategoria(fluxo, 'concluido')).toBe('pronto');
  });

  it('lista sem status daquela categoria: null, e o cartão não se move', () => {
    expect(statusDaListaParaCategoria([{ status: 'to do', type: 'open' }, { status: 'complete', type: 'closed' }], 'em_aprovacao')).toBeNull();
  });
});

describe('ehTarefaDeTeste', () => {
  it('marca os artefatos que os gates de QA despejam na lista interna', () => {
    for (const nome of ['QA Gate Bento 1790342246004', 'Cliente Teste 7 PEDIDO: Bento, crie uma task', 'Clinica Teste Fase 7', 'E2E Claude - pode apagar', 'plug', 'plug2']) {
      expect(ehTarefaDeTeste(nome)).toBe(true);
    }
  });

  it('nunca marca trabalho de verdade', () => {
    for (const nome of ['Cosentino_Site Cosentino Urbano', '[INFRA] Habilitar SSH no servidor', 'DC_Colab JD', '70 ANOS | Peças institucionais (out/2026)', 'Plugin de pagamento do checkout']) {
      expect(ehTarefaDeTeste(nome)).toBe(false);
    }
  });
});
