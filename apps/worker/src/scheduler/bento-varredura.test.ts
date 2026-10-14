import { describe, expect, it } from 'vitest';
import {
  avisoLiberado,
  destinatariosDaTarefa,
  janelaDeRisco,
  lerConfigDaProatividade,
  montarAviso,
  type ItemDoAviso,
  type PessoasDaEmpresa,
} from './bento-varredura';

describe('lerConfigDaProatividade — desligado é o padrão', () => {
  it('sem flag nenhuma: monitoramento off, aviso off', () => {
    const c = lerConfigDaProatividade({});
    expect(c.monitoramento).toBe('off');
    expect(c.notificacoes).toBe(false);
    expect(c.empresasLiberadas).toBeNull();
  });
  it('shadow é shadow; valor desconhecido NÃO liga nada', () => {
    expect(lerConfigDaProatividade({ BENTO_PROACTIVE_MONITORING: 'shadow' }).monitoramento).toBe('shadow');
    expect(lerConfigDaProatividade({ BENTO_PROACTIVE_MONITORING: 'talvez' }).monitoramento).toBe('off');
  });
  it('lista de empresas liberadas', () => {
    const c = lerConfigDaProatividade({ BENTO_PROACTIVE_ORGS: ' a , b ,' });
    expect([...c.empresasLiberadas!]).toEqual(['a', 'b']);
  });
});

describe('avisoLiberado — os três estágios', () => {
  const base = { empresasLiberadas: null } as const;
  it('shadow nunca avisa, nem com notificação ligada', () => {
    expect(avisoLiberado({ ...base, monitoramento: 'shadow', notificacoes: true }, 'a')).toBe(false);
  });
  it('on sem notificação não avisa', () => {
    expect(avisoLiberado({ ...base, monitoramento: 'on', notificacoes: false }, 'a')).toBe(false);
  });
  it('on + notificação + empresa fora da lista não avisa (ativação gradual)', () => {
    expect(avisoLiberado({ monitoramento: 'on', notificacoes: true, empresasLiberadas: new Set(['b']) }, 'a')).toBe(false);
    expect(avisoLiberado({ monitoramento: 'on', notificacoes: true, empresasLiberadas: new Set(['a']) }, 'a')).toBe(true);
  });
});

describe('janelaDeRisco — dias no fuso de São Paulo, não no do servidor', () => {
  it('23h30 de 14/10 em SP (02h30 UTC de 15/10) ainda é dia 14', () => {
    const j = janelaDeRisco(new Date('2026-10-15T02:30:00.000Z'));
    expect(new Date(j.startOfToday).toISOString()).toBe('2026-10-14T03:00:00.000Z');
    expect(new Date(j.startOfTomorrow).toISOString()).toBe('2026-10-15T03:00:00.000Z');
    expect(new Date(j.endOfTomorrow).toISOString()).toBe('2026-10-16T02:59:59.999Z');
    expect(new Date(j.endOfDay3).toISOString()).toBe('2026-10-17T02:59:59.999Z');
  });
  it('00h10 de 15/10 em SP já é dia 15', () => {
    const j = janelaDeRisco(new Date('2026-10-15T03:10:00.000Z'));
    expect(new Date(j.startOfToday).toISOString()).toBe('2026-10-15T03:00:00.000Z');
  });
});

describe('destinatariosDaTarefa', () => {
  const pessoas: PessoasDaEmpresa = {
    porEmail: new Map([['ana@x.com', 'u-ana']]),
    porClickupId: new Map([[102, 'u-bruno']]),
    gestores: ['u-gestor'],
  };
  it('o responsável recebe, por e-mail ou por id do ClickUp', () => {
    expect(destinatariosDaTarefa({ assigneeEmails: ['ana@x.com'] }, pessoas)).toEqual(['u-ana']);
    expect(destinatariosDaTarefa({ assigneeIds: [102] }, pessoas)).toEqual(['u-bruno']);
  });
  it('sem responsável no OS, a gestão da empresa recebe', () => {
    expect(destinatariosDaTarefa({ assigneeEmails: [] }, pessoas)).toEqual(['u-gestor']);
    expect(destinatariosDaTarefa({ assigneeEmails: ['de-fora@y.com'] }, pessoas)).toEqual(['u-gestor']);
  });
  it('a mesma pessoa casada por id e por e-mail recebe UMA vez', () => {
    const p = { ...pessoas, porEmail: new Map([['b@x.com', 'u-bruno']]) };
    expect(destinatariosDaTarefa({ assigneeIds: [102], assigneeEmails: ['b@x.com'] }, p)).toEqual(['u-bruno']);
  });
});

describe('montarAviso', () => {
  const item = (over: Partial<ItemDoAviso>): ItemDoAviso => ({
    signalId: 's1',
    severity: 'medium',
    pontuacao: 30,
    titulo: 'Tarefa',
    motivos: 'vence amanhã',
    acao: null,
    ...over,
  });
  it('o mais grave primeiro', () => {
    const a = montarAviso([item({ signalId: 'a', titulo: 'Leve' }), item({ signalId: 'b', titulo: 'Grave', severity: 'critical' })]);
    expect(a.body.indexOf('Grave')).toBeLessThan(a.body.indexOf('Leve'));
    expect(a.title).toBe('Bento: 2 tarefas precisam da sua atenção');
  });
  it('mesmo conjunto de sinais, em qualquer ordem = mesma chave (retry não duplica)', () => {
    const x = montarAviso([item({ signalId: 'a' }), item({ signalId: 'b' })]);
    const y = montarAviso([item({ signalId: 'b' }), item({ signalId: 'a' })]);
    expect(x.dedupeKey).toBe(y.dedupeKey);
    expect(montarAviso([item({ signalId: 'a' })]).dedupeKey).not.toBe(x.dedupeKey);
  });
  it('não despeja lista sem fim', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => item({ signalId: `s${i}`, titulo: `T${i}` }));
    expect(montarAviso(muitos).body).toContain('e mais 4.');
  });
});
